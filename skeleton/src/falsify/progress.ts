// Progress events: deep-frozen copies, callbacks that can never affect the run.
import type { Scenario } from './contract.js';
import type { CemDimInfo, ProgressEvent } from './types.js';

function deepFreeze<T>(x: T): T {
  if (typeof x === 'object' && x !== null && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

export interface ProgressInput {
  phase: 0 | 1 | 2 | 3;
  generation: number;
  scenarios: readonly Scenario[];
  seeds: readonly number[];
  robustness: readonly number[];
  lowestRobustness: number;
  trialsUsed: number;
  /** Null when the budget has no trial limit. */
  trialsRemaining: number | null;
  elapsedMs: number;
  timeFraction: number | null;
  cem?: readonly CemDimInfo[];
}

/** A deep-frozen copy: later changes to the source cannot alter a delivered event. */
export function buildProgressEvent(i: ProgressInput): ProgressEvent {
  return deepFreeze({
    phase: i.phase,
    generation: i.generation,
    scenarios: i.scenarios.map((s) => ({ ...s })),
    seeds: [...i.seeds],
    robustness: [...i.robustness],
    lowestRobustness: i.lowestRobustness,
    trialsUsed: i.trialsUsed,
    trialsRemaining: i.trialsRemaining,
    elapsedMs: i.elapsedMs,
    timeFraction: i.timeFraction,
    ...(i.cem !== undefined ? { cem: i.cem.map((d) => ({ ...d })) } : {}),
  });
}

/** Calls `cb(arg)`, swallowing a throw or a rejected promise. A returned promise is never awaited. */
export function safeInvoke<T>(cb: ((a: T) => unknown) | undefined, arg: T): void {
  if (cb === undefined) return;
  try {
    const r = cb(arg);
    if (r !== null && typeof r === 'object' && typeof (r as Promise<unknown>).then === 'function') {
      (r as Promise<unknown>).then(undefined, () => undefined);
    }
  } catch {
    /* a callback must never change a verdict */
  }
}

/** Emits events one at a time; after `stop()` (an observed abort) nothing more is emitted. */
export class ProgressEmitter {
  private stopped = false;
  constructor(private readonly cb: ((e: ProgressEvent) => void | Promise<void>) | undefined) {}
  stop(): void { this.stopped = true; }
  emit(input: ProgressInput): void {
    if (this.stopped) return;
    safeInvoke(this.cb, buildProgressEvent(input));
  }
}
