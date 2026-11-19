// InlinePool: a TrialPool that runs golem-sim trials in this thread, one at a time, yielding to the
// event loop between trials. It is the stand-in until golem-pool's workers are wired in: the studio
// registers each compiled requirement with it (duck-typed `register`), so `TrialSpec.reqId` resolves.
import { ModelCache, runTrial } from '../../sim/index.js';
import { abortError } from './falsify-adapter.js';
import type { CompiledRequirement, RobotApp, TrialPool, TrialResult, TrialSpec } from '../types.js';

export interface RegisteringPool extends TrialPool { register(req: CompiledRequirement): void }

export const canRegister = (p: TrialPool): p is RegisteringPool => typeof (p as Partial<RegisteringPool>).register === 'function';

function yieldTask(): Promise<void> {
  const MC = (globalThis as { MessageChannel?: typeof MessageChannel }).MessageChannel;
  if (MC) {
    return new Promise((resolve) => {
      const ch = new MC();
      ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
      ch.port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export class InlinePool implements RegisteringPool {
  readonly size = 1;
  private readonly reqs = new Map<string, CompiledRequirement>();
  private readonly cache: ModelCache;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(private readonly app: RobotApp, cache?: ModelCache) { this.cache = cache ?? new ModelCache(); }

  register(req: CompiledRequirement): void { this.reqs.set(req.id, req); }

  run(specs: TrialSpec[], onResult?: (r: TrialResult) => void, opts?: { signal?: AbortSignal }): Promise<TrialResult[]> {
    // Runs are serialised: one MuJoCo instance in this thread.
    const p = this.queue.then(() => this.runNow(specs, onResult, opts?.signal));
    this.queue = p.catch(() => {});
    return p;
  }

  private async runNow(specs: TrialSpec[], onResult?: (r: TrialResult) => void, signal?: AbortSignal): Promise<TrialResult[]> {
    const out: TrialResult[] = [];
    for (const spec of specs) {
      if (this.closed) throw new Error('The trial pool is closed');
      if (signal?.aborted) throw abortError();
      const req = this.reqs.get(spec.reqId);
      if (!req) throw new Error(`No compiled requirement ${spec.reqId} is registered with the trial pool`);
      const r = await runTrial(this.app, req, { ...spec, app: spec.app || this.app.id }, { cache: this.cache });
      out.push(r);
      onResult?.(r);
      await yieldTask();
    }
    return out;
  }

  async close(): Promise<void> {
    this.closed = true;
    try { this.cache.dispose(); } catch { /* already gone */ }
  }
}
