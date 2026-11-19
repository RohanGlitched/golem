// The worker side of the protocol, independent of the transport (worker_threads, Web Worker, fake).
// Loads the trial function once, runs trials one at a time, and deletes every tracked handle after each.
import { errorMessage } from '../falsify/errors.js';
import type { TrialSpec } from '../falsify/contract.js';
import { transferList, type HostMessage, type WorkerConfig, type WorkerMessage } from './protocol.js';
import type { TrialFn } from './types.js';

export interface Deletable { delete(): void }

/** Tracks handles a trial creates; `releaseAll` deletes each exactly once, last created first. */
export class HandleTracker {
  private readonly handles: Deletable[] = [];
  private cancelledFlag = false;
  track<T extends Deletable>(h: T): T { this.handles.push(h); return h; }
  get live(): number { return this.handles.length; }
  /** True after the host asked to cancel this trial (cooperative trial functions may stop early). */
  isCancelled(): boolean { return this.cancelledFlag; }
  cancel(): void { this.cancelledFlag = true; }
  releaseAll(): void {
    let firstError: unknown;
    let failed = false;
    while (this.handles.length > 0) {
      const h = this.handles.pop() as Deletable;
      try { h.delete(); } catch (e) { if (!failed) { failed = true; firstError = e; } }
    }
    if (failed) throw firstError;
  }
}

/** What a loaded app gives the runner. */
export interface LoadedTrial {
  trial: TrialFn;
  /** Live MuJoCo handles outside the per-trial tracker (for `probe`). */
  liveHandles?: () => number;
  dispose?: () => void;
}
export type TrialLoader = (appId: string, config: WorkerConfig) => Promise<LoadedTrial>;

export type Post = (msg: WorkerMessage, transfer?: ArrayBuffer[]) => void;

export class WorkerRunner {
  private loaded: LoadedTrial | undefined;
  private current: { id: number; tracker: HandleTracker } | undefined;

  constructor(private readonly loader: TrialLoader) {}

  async handle(msg: HostMessage, post: Post): Promise<void> {
    switch (msg.type) {
      case 'init': {
        try {
          this.loaded ??= await this.loader(msg.appId, msg.config);
          post({ type: 'ready', slot: msg.slot });
        } catch (e) {
          const stack = e instanceof Error ? e.stack : undefined;
          post({ type: 'loadError', slot: msg.slot, message: errorMessage(e), ...(stack !== undefined ? { stack } : {}) });
        }
        return;
      }
      case 'run':
        return this.run(msg.id, msg.spec, post);
      case 'cancel':
        if (this.current?.id === msg.id) this.current.tracker.cancel();
        return;
      case 'probe':
        post({ type: 'probeReply', id: msg.id, liveHandles: this.liveHandles() });
        return;
      case 'shutdown':
        this.loaded?.dispose?.();
        this.loaded = undefined;
        return;
    }
  }

  liveHandles(): number {
    return (this.loaded?.liveHandles?.() ?? 0) + (this.current?.tracker.live ?? 0);
  }

  private async run(id: number, spec: TrialSpec, post: Post): Promise<void> {
    const tracker = new HandleTracker();
    this.current = { id, tracker };
    let outcome: { ok: true; msg: WorkerMessage } | { ok: false; error: unknown };
    try {
      if (this.loaded === undefined) throw new Error('worker received a trial before it finished loading');
      const result = await this.loaded.trial(spec, tracker);
      outcome = { ok: true, msg: { type: 'result', id, result } };
    } catch (e) {
      outcome = { ok: false, error: e };
    } finally {
      this.current = undefined;
    }
    let releaseError: unknown;
    let releaseFailed = false;
    try { tracker.releaseAll(); } catch (e) { releaseFailed = true; releaseError = e; }
    if (outcome.ok && !releaseFailed) {
      post(outcome.msg, transferList(outcome.msg));
      return;
    }
    const e = outcome.ok ? releaseError : outcome.error;
    const stack = e instanceof Error ? e.stack : undefined;
    post({ type: 'trialError', id, message: errorMessage(e), ...(stack !== undefined ? { stack } : {}) });
  }
}
