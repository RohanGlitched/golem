// Single-thread pool: runs trials one after another on the calling thread (Requirement 13).
import type { RunOptions, TrialPool, TrialResult, TrialSpec } from '../falsify/contract.js';
import { AbortError, PoolClosedError, TrialError, errorMessage } from '../falsify/errors.js';
import type { TrialFn } from './types.js';

export interface InProcessPoolOptions {
  /** Yield to the macrotask queue after this many trials (default 1), so a timer-fired abort is seen. */
  yieldEvery?: number;
}

/**
 * One macrotask turn, so timers that are due (an abort fired from `setTimeout`) run first.
 * `setImmediate` where it exists (Node), else a MessageChannel (browsers); `setTimeout(0)` is clamped
 * to 1 ms or more and would slow long sequential runs.
 */
const macrotask: () => Promise<void> = (() => {
  const g = globalThis as { setImmediate?: (fn: () => void) => unknown; MessageChannel?: typeof MessageChannel };
  if (typeof g.setImmediate === 'function') {
    const si = g.setImmediate;
    return () => new Promise<void>((resolve) => { si(resolve); });
  }
  if (typeof g.MessageChannel === 'function') {
    const ch = new g.MessageChannel();
    const waiting: (() => void)[] = [];
    ch.port1.onmessage = () => { waiting.shift()?.(); };
    return () => new Promise<void>((resolve) => { waiting.push(resolve); ch.port2.postMessage(0); });
  }
  return () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });
})();

/** Reads the live flag; a plain property read would be narrowed away by TypeScript after the first check. */
const isAborted = (s: AbortSignal | undefined): boolean => s !== undefined && s.aborted;

export class InProcessPool implements TrialPool {
  readonly size = 1;
  private closed = false;
  private readonly yieldEvery: number;

  constructor(private readonly trialFn: TrialFn, opts: InProcessPoolOptions = {}) {
    const y = opts.yieldEvery ?? 1;
    if (!Number.isInteger(y) || y < 1) throw new RangeError(`yieldEvery must be an integer of at least 1, got ${String(opts.yieldEvery)}`);
    this.yieldEvery = y;
  }

  async run(
    specs: TrialSpec[],
    onResult?: (r: TrialResult) => void | Promise<void>,
    opts?: RunOptions,
  ): Promise<TrialResult[]> {
    if (this.closed) throw new PoolClosedError('pool is closed');
    const signal = opts?.signal;
    if (signal?.aborted === true) throw new AbortError('run aborted before it started');
    const results: TrialResult[] = [];
    for (let i = 0; i < specs.length; i++) {
      if (i > 0 && i % this.yieldEvery === 0) await macrotask();
      if (isAborted(signal)) throw new AbortError('run aborted');
      if (this.closed) throw new PoolClosedError('pool is closed');
      const spec = specs[i] as TrialSpec;
      let r: TrialResult;
      try {
        r = await this.trialFn(spec);
      } catch (e) {
        throw new TrialError(
          `trial ${spec.reqId} seed ${spec.seed} (app ${spec.app}, scenario ${JSON.stringify(spec.scenario)}) failed: ${errorMessage(e)}`,
          { cause: e },
        );
      }
      // The trial in progress at the abort is not reported (13.5).
      if (isAborted(signal)) throw new AbortError('run aborted');
      const out: TrialResult = { ...r, spec };
      results.push(out);
      if (onResult !== undefined) {
        try {
          await onResult(out);
        } catch (e) {
          throw new Error(`onResult threw: ${errorMessage(e)}`, { cause: e });
        }
      }
    }
    return results;
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}
