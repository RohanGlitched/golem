// Trace_Trial: re-runs one counterexample on the page's own MuJoCo instance (the hero's module and model) to get its
// signal trace, which pool results do not carry. golem-sim's runner restores the model after the trial, so the hero
// keeps running on the same model. One trial, run once per counterexample.
import { runTrial } from '../../sim/index.js';
import type { ModelCache } from '../../sim/index.js';
import type { CompiledRequirement, RobotApp, Scenario, TrialResult } from '../types.js';
import type { Trace } from '../../ears/index.js';

export interface TraceTrialResult {
  trace: Trace;
  result: TrialResult;
  /** The monitor's per-signal breakdown (golem-ears `margins: true`), when the requirement gives one. */
  margins?: Record<string, number>;
  marginsAt?: Record<string, number>;
}

type Monitor = (t: Trace, o?: { margins?: boolean }) => { robustness: number; margins?: Record<string, number>; marginsAt?: Record<string, number> };

export async function traceTrial(
  mj: unknown, model: unknown, app: RobotApp, req: CompiledRequirement, ce: { scenario: Scenario; seed: number },
): Promise<TraceTrialResult> {
  let last: Trace | undefined;
  let n = 0;
  const cache = { getModel: () => Promise.resolve({ mj, model }) } as unknown as ModelCache;
  const result = await runTrial(app, req, { app: app.id, reqId: req.id, scenario: ce.scenario, seed: ce.seed }, {
    cache,
    earlyStop: (trace, k) => { last = trace; n = k; return undefined; },
  });
  const src = last;
  const signals: Record<string, Float64Array> = {};
  let trace: Trace;
  if (src) {
    for (const k of Object.keys(src.signals)) signals[k] = (src.signals[k] as Float64Array).slice(0, n);
    trace = { t: src.t.slice(0, n), signals, events: src.events.map((e) => ({ ...e })) };
  } else trace = { t: new Float64Array(0), signals, events: [] };
  let out: TraceTrialResult = { trace, result };
  try {
    const m = (req.monitor as Monitor)(trace, { margins: true });
    if (m.margins) out = { ...out, margins: m.margins, ...(m.marginsAt ? { marginsAt: m.marginsAt } : {}) };
  } catch { /* a monitor without the breakdown */ }
  return out;
}

/**
 * The instantaneous margin at each sample: the monitor applied to a one-sample trace anchored at that sample.
 * Samples whose margin is not a number keep the previous value. Runs once per trace, never per frame.
 */
export function instantMargins(req: Pick<CompiledRequirement, 'monitor'>, trace: Trace): Float64Array {
  const n = trace.t.length;
  const out = new Float64Array(n);
  const names = Object.keys(trace.signals);
  const t1 = new Float64Array(1);
  const sig: Record<string, Float64Array> = {};
  for (const k of names) sig[k] = new Float64Array(1);
  const ev = [{ name: 'trigger', t: 0 }];
  const one: Trace = { t: t1, signals: sig, events: ev };
  let prev = Number.NaN;
  for (let i = 0; i < n; i++) {
    t1[0] = trace.t[i] as number;
    (ev[0] as { t: number }).t = t1[0];
    for (const k of names) (sig[k] as Float64Array)[0] = (trace.signals[k] as Float64Array)[i] as number;
    let m = Number.NaN;
    try { m = req.monitor(one).robustness; } catch { m = Number.NaN; }
    if (m === m && Number.isFinite(m)) prev = m;
    out[i] = prev;
  }
  // Leading samples before the first number take the first number.
  let first = Number.NaN;
  for (let i = 0; i < n; i++) if (out[i] === out[i]) { first = out[i] as number; break; }
  for (let i = 0; i < n && !(out[i] === out[i]); i++) out[i] = first;
  return out;
}

/** Index of the last sample at or before time t (binary search), clamped to the trace. */
export function sampleAt(t: Float64Array, time: number): number {
  let lo = 0, hi = t.length - 1;
  if (hi < 0) return -1;
  if (!(time > (t[0] as number))) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if ((t[mid] as number) <= time) lo = mid; else hi = mid - 1;
  }
  return lo;
}
