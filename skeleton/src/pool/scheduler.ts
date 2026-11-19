// One scheduler for every worker pool (design D5). All dispatch, backpressure, cancellation, crash,
// restart and close logic lives here. Adapters only create WorkerLike objects.
import type { TrialPool, TrialResult, TrialSpec } from '../falsify/contract.js';
import {
  AbortError, CancelledError, LoadError, PoolClosedError, RestartLimitError, TrialCrashError, TrialError,
  errorMessage,
} from '../falsify/errors.js';
import type { WorkerConfig, WorkerMessage } from './protocol.js';
import type { SchedulerTimers, WorkerFactory, WorkerLike } from './worker-like.js';
import type { RunOptions } from './types.js';

export type { SchedulerTimers, WorkerFactory, WorkerLike } from './worker-like.js';

export interface SchedulerOptions {
  size: number;
  factory: WorkerFactory;
  appId: string;
  config: WorkerConfig;
  /** Per worker slot, default 5. */
  maxRestarts?: number;
  /** 100..60000 ms, default 2000. */
  abortGraceMs?: number;
  /** Integer >= 1, default 2 * size. */
  deliveryBound?: number;
  timers?: SchedulerTimers;
}

type OnResult = (r: TrialResult) => void | Promise<void>;
type SlotState = 'loading' | 'idle' | 'busy' | 'cancelling' | 'gone';
type LoadKind = 'initial' | 'crash' | 'abort';

interface Run {
  specs: TrialSpec[];
  results: (TrialResult | undefined)[];
  delivered: number;
  onResult: OnResult | undefined;
  status: 'active' | 'settled';
  resolve(v: TrialResult[]): void;
  reject(e: unknown): void;
  cleanup?: () => void;
}
interface Job { run: Run; index: number; attempts: number; jobId: number }
interface Slot {
  index: number;
  worker: WorkerLike;
  state: SlotState;
  generation: number;
  restarts: number;
  job: Job | undefined;
  loadKind: LoadKind;
  graceTimer: unknown;
  lastMessage: string;
}

const DEFAULT_TIMERS: SchedulerTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class TrialScheduler implements TrialPool {
  readonly size: number;
  readonly ready: Promise<void>;
  private readonly opts: Required<Omit<SchedulerOptions, 'timers'>> & { timers: SchedulerTimers };
  private readonly slots: Slot[] = [];
  private queue: Job[] = [];
  private nextJobId = 1;
  private waiting = 0;
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private failure: Error | undefined;
  private readyCount = 0;
  private resolveReady!: () => void;
  private rejectReady!: (e: unknown) => void;
  private readyDone = false;
  private readonly probes = new Map<number, (n: number) => void>();
  private readonly activeRuns = new Set<Run>();

  constructor(o: SchedulerOptions) {
    if (!Number.isInteger(o.size) || o.size < 1) throw new RangeError(`pool size must be an integer of at least 1, got ${String(o.size)}`);
    const deliveryBound = o.deliveryBound ?? 2 * o.size;
    if (!Number.isInteger(deliveryBound) || deliveryBound < 1) {
      throw new RangeError(`deliveryBound must be an integer of at least 1, got ${String(o.deliveryBound)}`);
    }
    const maxRestarts = o.maxRestarts ?? 5;
    if (!Number.isInteger(maxRestarts) || maxRestarts < 0) throw new RangeError(`maxRestarts must be a non-negative integer, got ${String(o.maxRestarts)}`);
    const abortGraceMs = o.abortGraceMs ?? 2000;
    if (!(abortGraceMs >= 100 && abortGraceMs <= 60000)) throw new RangeError(`abortGraceMs must be between 100 and 60000, got ${String(o.abortGraceMs)}`);
    this.size = o.size;
    this.opts = {
      size: o.size, factory: o.factory, appId: o.appId, config: o.config, maxRestarts, abortGraceMs, deliveryBound,
      timers: o.timers ?? DEFAULT_TIMERS,
    };
    this.ready = new Promise<void>((res, rej) => { this.resolveReady = res; this.rejectReady = rej; });
    this.ready.catch(() => undefined);
    for (let i = 0; i < o.size; i++) this.startWorker(this.makeSlot(i), 'initial');
  }

  // ------------------------------------------------------------------ public API

  run(specs: TrialSpec[], onResult?: OnResult, opts?: RunOptions): Promise<TrialResult[]> {
    if (this.closed) return Promise.reject(new PoolClosedError('pool is closed'));
    if (this.failure !== undefined) return Promise.reject(this.failure);
    const signal = opts?.signal;
    if (signal?.aborted === true) return Promise.reject(new AbortError('run aborted before it started'));
    if (specs.length === 0) return Promise.resolve([]);
    return new Promise<TrialResult[]>((resolve, reject) => {
      const run: Run = {
        specs, results: specs.map(() => undefined), delivered: 0, onResult, status: 'active', resolve, reject,
      };
      this.activeRuns.add(run);
      if (signal !== undefined) {
        const onAbort = (): void => this.abortRun(run);
        signal.addEventListener('abort', onAbort, { once: true });
        run.cleanup = () => signal.removeEventListener('abort', onAbort);
      }
      specs.forEach((_, index) => this.queue.push({ run, index, attempts: 0, jobId: 0 }));
      this.dispatch();
    });
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closed = true;
    this.closePromise = (async () => {
      for (const run of [...this.activeRuns]) this.settle(run, 'reject', new CancelledError('run cancelled because the pool was closed'));
      this.queue = [];
      this.waiting = 0;
      const stops: Promise<void>[] = [];
      for (const slot of this.slots) {
        if (slot.graceTimer !== undefined) { this.opts.timers.clearTimeout(slot.graceTimer); slot.graceTimer = undefined; }
        slot.state = 'gone';
        slot.job = undefined;
        try { slot.worker.post({ type: 'shutdown' }); } catch { /* worker may already be gone */ }
        stops.push(slot.worker.terminate().catch(() => undefined));
      }
      await Promise.all(stops);
      if (!this.readyDone) { this.readyDone = true; this.rejectReady(new CancelledError('pool closed before all workers were ready')); }
    })();
    return this.closePromise;
  }

  /** Debug: live MuJoCo handles reported by one worker (design 20.8). */
  probe(slot: number): Promise<number> {
    const s = this.slots[slot];
    if (s === undefined) return Promise.reject(new RangeError(`no worker slot ${slot}`));
    return new Promise<number>((resolve) => {
      const id = this.nextJobId++;
      this.probes.set(id, resolve);
      s.worker.post({ type: 'probe', id });
    });
  }

  // ------------------------------------------------------------------ slots and workers

  private makeSlot(index: number): Slot {
    const slot: Slot = {
      index, worker: undefined as unknown as WorkerLike, state: 'loading', generation: -1, restarts: 0,
      job: undefined, loadKind: 'initial', graceTimer: undefined, lastMessage: '',
    };
    this.slots.push(slot);
    return slot;
  }

  private startWorker(slot: Slot, kind: LoadKind): void {
    slot.generation += 1;
    slot.loadKind = kind;
    slot.state = 'loading';
    slot.job = undefined;
    const w = this.opts.factory(slot.index, slot.generation);
    slot.worker = w;
    w.onMessage((m) => { if (slot.worker === w) this.onMessage(slot, m); });
    w.onCrash((reason) => { if (slot.worker === w) this.onCrash(slot, reason); });
    w.post({ type: 'init', slot: slot.index, appId: this.opts.appId, config: this.opts.config });
  }

  private replaceWorker(slot: Slot, kind: LoadKind): void {
    const old = slot.worker;
    if (slot.graceTimer !== undefined) { this.opts.timers.clearTimeout(slot.graceTimer); slot.graceTimer = undefined; }
    void old.terminate().catch(() => undefined);
    if (this.closed || this.failure !== undefined) { slot.state = 'gone'; return; }
    this.startWorker(slot, kind);
  }

  private onMessage(slot: Slot, m: WorkerMessage): void {
    switch (m.type) {
      case 'ready':
        if (slot.state !== 'loading') return;
        slot.state = 'idle';
        if (slot.loadKind === 'initial') {
          if (++this.readyCount === this.slots.length && this.slots.length === this.size && !this.readyDone) {
            this.readyDone = true;
            this.resolveReady();
          }
        }
        this.dispatch();
        return;
      case 'loadError':
        if (slot.state !== 'loading') return;
        slot.lastMessage = m.message;
        if (slot.loadKind === 'crash') this.restart(slot, m.message, 'crash');
        else {
          const cause = new Error(m.message);
          if (m.stack !== undefined) cause.stack = m.stack;
          this.fail(new LoadError(`worker ${slot.index} failed to load: ${m.message}`, { cause }));
        }
        return;
      case 'result':
        this.onResultMessage(slot, m.id, m.result);
        return;
      case 'trialError':
        this.onTrialError(slot, m.id, m.message, m.stack);
        return;
      case 'probeReply': {
        const cb = this.probes.get(m.id);
        if (cb !== undefined) { this.probes.delete(m.id); cb(m.liveHandles); }
        return;
      }
      case 'log':
        return;
    }
  }

  private onCrash(slot: Slot, reason: string): void {
    slot.lastMessage = reason;
    if (slot.state === 'gone') return;
    const job = slot.job;
    const wasLoading = slot.state === 'loading';
    const kind = slot.loadKind;
    slot.job = undefined;
    if (wasLoading && kind !== 'crash') {
      void slot.worker.terminate().catch(() => undefined);
      this.fail(new LoadError(`worker ${slot.index} failed to load: ${reason}`, { cause: new Error(reason) }));
      return;
    }
    if (job !== undefined && slot.state === 'busy' && job.run.status === 'active') {
      job.attempts += 1;
      if (job.attempts >= 2) {
        const s = job.run.specs[job.index] as TrialSpec;
        this.settle(job.run, 'reject', new TrialCrashError(
          `trial ${s.reqId} seed ${s.seed} (app ${s.app}) crashed two workers: ${reason}`,
        ));
      } else {
        this.queue.unshift(job);
      }
    }
    this.restart(slot, reason, 'crash');
  }

  /** Counts one restart of the slot and starts a replacement, or fails the scheduler at the limit. */
  private restart(slot: Slot, reason: string, kind: LoadKind): void {
    slot.restarts += 1;
    if (slot.restarts > this.opts.maxRestarts) {
      void slot.worker.terminate().catch(() => undefined);
      slot.state = 'gone';
      this.fail(new RestartLimitError(
        `worker slot ${slot.index} restarted ${slot.restarts} times in a row (limit ${this.opts.maxRestarts}); last failure: ${reason}`,
      ));
      return;
    }
    this.replaceWorker(slot, kind);
    this.dispatch();
  }

  private fail(err: Error): void {
    if (this.failure !== undefined) return;
    this.failure = err;
    for (const run of [...this.activeRuns]) this.settle(run, 'reject', err);
    this.queue = [];
    if (!this.readyDone) { this.readyDone = true; this.rejectReady(err); }
  }

  // ------------------------------------------------------------------ dispatch and results

  private dispatch(): void {
    if (this.closed || this.failure !== undefined) return;
    for (const slot of this.slots) {
      if (slot.state !== 'idle') continue;
      let job: Job | undefined;
      while ((job = this.queue[0]) !== undefined && job.run.status !== 'active') this.queue.shift();
      if (job === undefined) return;
      const spec = job.run.specs[job.index] as TrialSpec;
      // Results waiting for delivery plus pose trials still running may never exceed the bound.
      if (spec.record === 'poses' && this.waiting + this.inflightPoses() >= this.opts.deliveryBound) return;
      this.queue.shift();
      job.jobId = this.nextJobId++;
      slot.job = job;
      slot.state = 'busy';
      slot.worker.post({ type: 'run', id: job.jobId, spec });
    }
  }

  private inflightPoses(): number {
    let n = 0;
    for (const s of this.slots) {
      if (s.state === 'busy' && s.job !== undefined && s.job.run.specs[s.job.index]?.record === 'poses') n++;
    }
    return n;
  }

  private onResultMessage(slot: Slot, id: number, result: TrialResult): void {
    const job = slot.job;
    if (job === undefined || job.jobId !== id) return;
    slot.job = undefined;
    if (slot.graceTimer !== undefined) { this.opts.timers.clearTimeout(slot.graceTimer); slot.graceTimer = undefined; }
    slot.state = 'idle';
    slot.restarts = 0;
    const run = job.run;
    if (run.status === 'active') {
      const r: TrialResult = { ...result, spec: run.specs[job.index] as TrialSpec };
      run.results[job.index] = r;
      this.deliver(run, r);
    }
    this.dispatch();
  }

  private deliver(run: Run, r: TrialResult): void {
    let out: void | Promise<void>;
    try {
      out = run.onResult?.(r);
    } catch (e) {
      run.delivered += 1;
      this.settle(run, 'reject', new Error(`onResult threw: ${errorMessage(e)}`, { cause: e }));
      return;
    }
    if (out !== undefined && out !== null && typeof (out as Promise<void>).then === 'function') {
      this.waiting += 1;
      (out as Promise<void>).then(
        () => this.deliveredLater(run, undefined),
        (e: unknown) => this.deliveredLater(run, e),
      );
      return;
    }
    this.afterDelivery(run);
  }

  private deliveredLater(run: Run, err: unknown): void {
    if (this.closed) return;
    this.waiting = Math.max(0, this.waiting - 1);
    if (err !== undefined) {
      run.delivered += 1;
      this.settle(run, 'reject', new Error(`onResult threw: ${errorMessage(err)}`, { cause: err }));
    } else {
      this.afterDelivery(run);
    }
    this.dispatch();
  }

  private afterDelivery(run: Run): void {
    run.delivered += 1;
    if (run.status === 'active' && run.delivered === run.specs.length) {
      this.settle(run, 'resolve', run.results as TrialResult[]);
    }
  }

  private onTrialError(slot: Slot, id: number, message: string, stack?: string): void {
    const job = slot.job;
    if (job === undefined || job.jobId !== id) return;
    slot.job = undefined;
    if (slot.graceTimer !== undefined) { this.opts.timers.clearTimeout(slot.graceTimer); slot.graceTimer = undefined; }
    slot.state = 'idle';
    slot.restarts = 0;
    if (job.run.status === 'active') {
      const s = job.run.specs[job.index] as TrialSpec;
      const cause = new Error(message);
      if (stack !== undefined) cause.stack = stack;
      this.settle(job.run, 'reject', new TrialError(`trial ${s.reqId} seed ${s.seed} (app ${s.app}) failed: ${message}`, { cause }));
    }
    this.dispatch();
  }

  /** Ends a run exactly once and drops its undispatched jobs. */
  private settle(run: Run, how: 'resolve' | 'reject', value: unknown): void {
    if (run.status !== 'active') return;
    run.status = 'settled';
    run.cleanup?.();
    this.activeRuns.delete(run);
    this.queue = this.queue.filter((j) => j.run !== run);
    if (how === 'resolve') run.resolve(value as TrialResult[]); else run.reject(value);
  }

  // ------------------------------------------------------------------ cancellation

  private abortRun(run: Run): void {
    if (run.status !== 'active') return;
    this.settle(run, 'reject', new AbortError('run aborted'));
    for (const slot of this.slots) {
      const job = slot.job;
      if (job === undefined || job.run !== run || slot.state !== 'busy') continue;
      slot.state = 'cancelling';
      slot.worker.post({ type: 'cancel', id: job.jobId });
      slot.graceTimer = this.opts.timers.setTimeout(() => this.graceExpired(slot, job), this.opts.abortGraceMs);
    }
    this.dispatch();
  }

  private graceExpired(slot: Slot, job: Job): void {
    if (slot.state !== 'cancelling' || slot.job !== job) return;
    slot.graceTimer = undefined;
    slot.job = undefined;
    this.replaceWorker(slot, 'abort'); // not a crash: the restart count is untouched
  }
}
