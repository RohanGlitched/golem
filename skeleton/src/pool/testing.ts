// Test-only helpers for pools (separate entry): fake timers and FakeWorker over the real WorkerRunner.
import type { TrialSpec } from '../falsify/contract.js';
import { mulberry32 } from '../falsify/prng.js';
import type { HostMessage, WorkerConfig, WorkerMessage } from './protocol.js';
import type { SchedulerTimers, WorkerFactory, WorkerLike } from './worker-like.js';
import type { TrialFn } from './types.js';
import { WorkerRunner } from './worker-runner.js';

/** Deterministic timers: nothing fires until `advance` or `settle`. */
export class FakeTimers implements SchedulerTimers {
  now = 0;
  private nextId = 1;
  private readonly pending = new Map<number, { at: number; fn: () => void; seq: number }>();
  private seq = 0;

  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.pending.set(id, { at: this.now + Math.max(0, ms), fn, seq: this.seq++ });
    return id;
  }
  clearTimeout(h: unknown): void { this.pending.delete(h as number); }
  get pendingCount(): number { return this.pending.size; }

  private nextDue(limit: number): [number, { at: number; fn: () => void; seq: number }] | undefined {
    let best: [number, { at: number; fn: () => void; seq: number }] | undefined;
    for (const e of this.pending.entries()) {
      if (e[1].at > limit) continue;
      if (best === undefined || e[1].at < best[1].at || (e[1].at === best[1].at && e[1].seq < best[1].seq)) best = e;
    }
    return best;
  }

  /** Moves time forward, firing due timers in order, letting promises settle between them. */
  async advance(ms: number): Promise<void> {
    const limit = this.now + ms;
    await tick();
    for (let e = this.nextDue(limit); e !== undefined; e = this.nextDue(limit)) {
      this.pending.delete(e[0]);
      this.now = Math.max(this.now, e[1].at);
      e[1].fn();
      await tick();
    }
    this.now = limit;
  }

  /** Fires every pending timer (including ones added meanwhile) in time order. */
  async settle(maxSteps = 100000): Promise<void> {
    await tick();
    for (let i = 0; i < maxSteps; i++) {
      let first: [number, { at: number; fn: () => void; seq: number }] | undefined;
      first = this.nextDue(Infinity);
      if (first === undefined) return;
      this.pending.delete(first[0]);
      this.now = Math.max(this.now, first[1].at);
      first[1].fn();
      await tick();
    }
    throw new Error('FakeTimers.settle: too many steps');
  }
}

/** A real macrotask turn: lets every pending microtask chain finish. */
export const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

export type JobAction =
  | { kind: 'ok'; delay?: number }
  | { kind: 'crash'; delay?: number; reason?: string }
  | { kind: 'trialError'; delay?: number; message?: string }
  | { kind: 'hang' };

export interface JobInfo { slot: number; generation: number; id: number; spec: TrialSpec; runIndex: number }

export interface FakeScript {
  /** A message makes the load of this worker fail. */
  loadFail?: (slot: number, generation: number) => string | undefined;
  /** Delay (fake ms) before `ready`. */
  loadDelay?: (slot: number, generation: number) => number;
  job?: (info: JobInfo) => JobAction | undefined;
  /** Seed for per-job completion delays in [1, maxDelay]. */
  shuffleSeed?: number;
  maxDelay?: number;
}

export interface FakeWorker extends WorkerLike {
  readonly slot: number;
  readonly generation: number;
  readonly terminated: boolean;
  /** Host messages received, in order. */
  readonly received: HostMessage[];
  readonly runner: WorkerRunner;
}

export interface FakeWorkerFactory {
  readonly factory: WorkerFactory;
  readonly workers: FakeWorker[];
  readonly timers: FakeTimers;
  /** Number of workers not terminated. */
  alive(): number;
}

export function fakeWorkerFactory(opts: { trialFn: TrialFn; timers?: FakeTimers; script?: FakeScript; liveHandles?: () => number }): FakeWorkerFactory {
  const timers = opts.timers ?? new FakeTimers();
  const script = opts.script ?? {};
  const workers: FakeWorker[] = [];
  let runCounter = 0;

  const factory: WorkerFactory = (slot, generation) => {
    let msgCbs: ((m: WorkerMessage) => void)[] = [];
    let crashCbs: ((r: string) => void)[] = [];
    let dead = false;
    const received: HostMessage[] = [];

    const toHost = (m: WorkerMessage, transfer: ArrayBuffer[] = []): void => {
      if (dead) return;
      const copy = structuredClone(m, { transfer }); // detaches the transferred buffers, like a real worker
      queueMicrotask(() => { if (!dead) for (const cb of msgCbs) cb(copy); });
    };

    const runner = new WorkerRunner(async (appId, config: WorkerConfig) => {
      const fail = script.loadFail?.(slot, generation);
      if (fail !== undefined) throw new Error(fail);
      void appId; void config;
      return { trial: opts.trialFn, ...(opts.liveHandles ? { liveHandles: opts.liveHandles } : {}) };
    });

    const later = (delay: number, fn: () => void): void => {
      if (delay <= 0) queueMicrotask(() => { if (!dead) fn(); });
      else timers.setTimeout(() => { if (!dead) fn(); }, delay);
    };

    const delayFor = (id: number): number => {
      if (script.shuffleSeed === undefined || !script.maxDelay) return 0;
      return 1 + Math.floor(mulberry32((script.shuffleSeed + id * 7919) >>> 0)() * script.maxDelay);
    };

    const worker: FakeWorker = {
      slot, generation, received, runner,
      get terminated() { return dead; },
      post(msg, transfer = []) {
        if (dead) return;
        const copy = structuredClone(msg, { transfer });
        received.push(copy);
        if (copy.type === 'init') {
          later(script.loadDelay?.(slot, generation) ?? 0, () => { void runner.handle(copy, toHost); });
        } else if (copy.type === 'run') {
          const info: JobInfo = { slot, generation, id: copy.id, spec: copy.spec, runIndex: runCounter++ };
          const action: JobAction = script.job?.(info) ?? { kind: 'ok' };
          if (action.kind === 'hang') return;
          const delay = (action.kind === 'ok' || action.kind === 'crash' || action.kind === 'trialError') && action.delay !== undefined
            ? action.delay : delayFor(copy.id);
          later(delay, () => {
            if (action.kind === 'crash') {
              const reason = action.reason ?? `worker ${slot} crashed`;
              dead = true;
              for (const cb of crashCbs) cb(reason);
            } else if (action.kind === 'trialError') {
              toHost({ type: 'trialError', id: copy.id, message: action.message ?? 'injected trial error' });
            } else {
              void runner.handle(copy, toHost);
            }
          });
        } else {
          void runner.handle(copy, toHost);
        }
      },
      onMessage(cb) { msgCbs.push(cb); },
      onCrash(cb) { crashCbs.push(cb); },
      async terminate() {
        dead = true;
        msgCbs = []; crashCbs = [];
      },
    };
    workers.push(worker);
    return worker;
  };

  return { factory, workers, timers, alive: () => workers.filter((w) => !w.terminated).length };
}
