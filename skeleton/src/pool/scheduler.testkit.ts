// Shared helpers for scheduler tests (not exported from any entry).
import type { TrialResult, TrialSpec } from '../falsify/contract.js';
import type { WorkerMessage } from './protocol.js';
import { TrialScheduler, type SchedulerOptions } from './scheduler.js';
import { fakeWorkerFactory, FakeTimers, tick, type FakeScript, type FakeWorkerFactory } from './testing.js';
import type { TrialFn } from './types.js';
import type { WorkerFactory, WorkerLike } from './worker-like.js';

export const spec = (seed: number, opts: { reqId?: string; record?: 'poses'; x?: number } = {}): TrialSpec => ({
  app: 'a', reqId: opts.reqId ?? 'R1', scenario: { x: opts.x ?? seed }, seed,
  ...(opts.record ? { record: opts.record } : {}),
});

/** A pure synthetic trial: robustness and worstAt depend only on the spec. */
export const pureTrial: TrialFn = (s) => ({
  spec: s,
  robustness: 10 - (s.scenario['x'] as number) + (s.seed % 7) / 100,
  worstAt: (s.seed % 13) / 4,
  unit: 'm',
  wallMs: 0,
  ...(s.record === 'poses' ? { poses: { fps: 50, nbody: 1, frames: new Float32Array(14).fill(s.seed % 1000) } } : {}),
});

export interface Rig {
  pool: TrialScheduler;
  f: FakeWorkerFactory;
  timers: FakeTimers;
  /** Fires every timer and lets messages settle. */
  drain(): Promise<void>;
  /** Run ids posted to workers, in dispatch order, with their spec seeds. */
  dispatched(): { id: number; seed: number; reqId: string; slot: number; generation: number }[];
}

export function rig(opts: {
  size: number;
  script?: FakeScript;
  trialFn?: TrialFn;
  sched?: Partial<Omit<SchedulerOptions, 'size' | 'factory' | 'timers'>>;
  /** Wrap the fake factory, e.g. with `instrument`. */
  wrap?: (f: WorkerFactory) => WorkerFactory;
}): Rig {
  const timers = new FakeTimers();
  const f = fakeWorkerFactory({ trialFn: opts.trialFn ?? pureTrial, timers, ...(opts.script ? { script: opts.script } : {}) });
  const factory = opts.wrap ? opts.wrap(f.factory) : f.factory;
  const pool = new TrialScheduler({ appId: 'a', config: {}, ...opts.sched, size: opts.size, factory, timers });
  return {
    pool, f, timers,
    drain: async () => { await timers.settle(); await tick(); await timers.settle(); },
    dispatched: () => {
      const out: { id: number; seed: number; reqId: string; slot: number; generation: number }[] = [];
      for (const w of f.workers) {
        for (const m of w.received) {
          if (m.type === 'run') out.push({ id: m.id, seed: m.spec.seed, reqId: m.spec.reqId, slot: w.slot, generation: w.generation });
        }
      }
      return out.sort((a, b) => a.id - b.id);
    },
  };
}

/** Records how a promise settled without letting it reject unhandled. */
export function track<T>(p: Promise<T>): { settled: () => boolean; value: () => T | undefined; error: () => unknown } {
  let done = false;
  let value: T | undefined;
  let error: unknown;
  p.then((v) => { done = true; value = v; }, (e) => { done = true; error = e; });
  return { settled: () => done, value: () => value, error: () => error };
}

export const essentials = (r: TrialResult) => ({ spec: r.spec, robustness: r.robustness, worstAt: r.worstAt, unit: r.unit });

export interface Probe {
  factory: WorkerFactory;
  /** Jobs posted and not yet answered, per worker and in total. */
  inflight(): number;
  maxInflight(): number;
  maxPerWorker(): number;
  dispatches(): number;
}

/** Wraps a factory to count in-flight jobs from the scheduler's side of the wire. */
export function instrument(inner: WorkerFactory): Probe {
  let total = 0;
  let maxTotal = 0;
  let maxPer = 0;
  let dispatches = 0;
  const factory: WorkerFactory = (slot, generation) => {
    const w = inner(slot, generation);
    const open = new Set<number>();
    const close = (id: number): void => { if (open.delete(id)) total--; };
    const wrapped: WorkerLike = {
      post(msg, transfer) {
        if (msg.type === 'run') {
          dispatches++;
          open.add(msg.id);
          total++;
          maxTotal = Math.max(maxTotal, total);
          maxPer = Math.max(maxPer, open.size);
        }
        w.post(msg, transfer);
      },
      onMessage(cb) {
        w.onMessage((m: WorkerMessage) => {
          if (m.type === 'result' || m.type === 'trialError') close(m.id);
          cb(m);
        });
      },
      onCrash(cb) {
        w.onCrash((r) => { for (const id of [...open]) close(id); cb(r); });
      },
      terminate() { for (const id of [...open]) close(id); return w.terminate(); },
    };
    return wrapped;
  };
  return { factory, inflight: () => total, maxInflight: () => maxTotal, maxPerWorker: () => maxPer, dispatches: () => dispatches };
}
