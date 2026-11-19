// Per-signal margins for explain_margin, and the replay summary.
import type { CompiledRequirement, MonitorResult, PredicateBinding, Trace } from '../cli/sibling-types.js';

export type { PredicateBinding };

export interface SignalMargin { signal: string; margin: number; at: number; unit: string }

export class MarginsUnavailableError extends Error {
  override name = 'MarginsUnavailableError';
  constructor() { super('per-signal margins unavailable: the compiled requirement carries no predicate bindings'); }
}

type WithBindings = Pick<CompiledRequirement, 'predicates'>;

/**
 * For each signal a predicate reads, the margin series with that signal at its value at sample i and every other
 * signal at its first-window value. Margin = minimum over the window, time = earliest sample of that minimum.
 * Signals appear in order of first appearance over the bindings. `undefined` without bindings.
 */
export function signalMargins(req: WithBindings, trace: Trace, bindings: PredicateBinding[] | undefined = req.predicates): SignalMargin[] | undefined {
  if (bindings === undefined || bindings.length === 0) return undefined;
  const out = new Map<string, SignalMargin>();
  const n = trace.t.length;
  for (const b of bindings) {
    const t0 = b.window?.t0 ?? -Infinity;
    const t1 = b.window?.t1 ?? Infinity;
    let first = -1;
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = trace.t[i] as number;
      if (t >= t0 && t <= t1) { if (first < 0) first = i; idx.push(i); }
    }
    if (first < 0) continue;
    const scratch: Record<string, number> = {};
    for (const k of b.predicate.signals) scratch[k] = (trace.signals[k] as Float64Array | undefined)?.[first] ?? NaN;
    for (const k of b.predicate.signals) {
      const series = trace.signals[k] as Float64Array | undefined;
      if (series === undefined) continue;
      let best = Infinity;
      let at = trace.t[first] as number;
      for (const i of idx) {
        for (const o of b.predicate.signals) scratch[o] = o === k ? (series[i] as number) : ((trace.signals[o] as Float64Array | undefined)?.[first] ?? NaN);
        const m = b.predicate.margin(scratch, b.slots);
        if (m < best) { best = m; at = trace.t[i] as number; }
      }
      const prev = out.get(k);
      if (prev === undefined) out.set(k, { signal: k, margin: best, at, unit: b.predicate.unit });
      else if (best < prev.margin) out.set(k, { signal: k, margin: best, at, unit: b.predicate.unit });
    }
  }
  return out.size === 0 ? undefined : [...out.values()];
}

/** Strict `<` scan: the first signal in list order wins a tie. */
export function pickLowest(ms: readonly SignalMargin[]): SignalMargin {
  let best = ms[0] as SignalMargin;
  for (const m of ms) if (m.margin < best.margin) best = m;
  return best;
}

/**
 * Uses the `margins` map of the monitor result when present, otherwise recomputes from the predicate bindings.
 * Throws MarginsUnavailableError when neither exists.
 */
export function explain(
  req: WithBindings, trace: Trace, monitor: MonitorResult, bindings: PredicateBinding[] | undefined = req.predicates,
): { lowest: SignalMargin; others: SignalMargin[]; source: 'monitor' | 'recomputed' } {
  let list: SignalMargin[];
  let source: 'monitor' | 'recomputed';
  const recomputed = signalMargins(req, trace, bindings);
  if (monitor.margins !== undefined && Object.keys(monitor.margins).length > 0) {
    source = 'monitor';
    list = Object.keys(monitor.margins).map((signal) => {
      const r = recomputed?.find((x) => x.signal === signal);
      return { signal, margin: (monitor.margins as Record<string, number>)[signal] as number, at: r?.at ?? monitor.worstAt, unit: r?.unit ?? monitor.unit };
    });
  } else {
    if (recomputed === undefined) throw new MarginsUnavailableError();
    source = 'recomputed';
    list = recomputed;
  }
  const lowest = pickLowest(list);
  return { lowest, others: list.filter((m) => m !== lowest), source };
}

// ---------------------------------------------------------------- replay summary

export const SUMMARY_INTERVAL_S = 0.1;
export const SUMMARY_MAX_SAMPLES = 200;

export interface ReplaySummary {
  intervalS: number;
  samples: ({ t: number } & Record<string, number>)[];
  truncated: boolean;
  totalSamples: number;
}

/** 10 Hz, at most 200 samples, the earliest kept. `truncated` is true exactly when samples were dropped by the limit. */
export function summariseTrace(trace: Trace): ReplaySummary {
  const n = trace.t.length;
  const picks: number[] = [];
  if (n > 0) {
    const t0 = trace.t[0] as number;
    let i = 0;
    for (let k = 0; ; k++) {
      const target = t0 + k * SUMMARY_INTERVAL_S;
      while (i < n && (trace.t[i] as number) < target - 1e-9) i++;
      if (i >= n) break;
      if (picks[picks.length - 1] !== i) picks.push(i);
    }
  }
  const kept = picks.slice(0, SUMMARY_MAX_SAMPLES);
  const names = Object.keys(trace.signals);
  return {
    intervalS: SUMMARY_INTERVAL_S,
    samples: kept.map((i) => {
      const row: Record<string, number> = { t: trace.t[i] as number };
      for (const k of names) row[k] = (trace.signals[k] as Float64Array)[i] as number;
      return row as { t: number } & Record<string, number>;
    }),
    truncated: picks.length > SUMMARY_MAX_SAMPLES,
    totalSamples: n,
  };
}

export interface SignalStat { signal: string; min: number; max: number; atWorst: number }

/** Minimum, maximum and the value at the sample nearest the worst moment, per signal. */
export function signalStats(trace: Trace, worstAt: number): SignalStat[] {
  let w = 0;
  for (let i = 0; i < trace.t.length; i++) if (Math.abs((trace.t[i] as number) - worstAt) < Math.abs((trace.t[w] as number) - worstAt)) w = i;
  return Object.keys(trace.signals).map((signal) => {
    const a = trace.signals[signal] as Float64Array;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < a.length; i++) { const v = a[i] as number; if (v < min) min = v; if (v > max) max = v; }
    return { signal, min, max, atWorst: a[w] as number };
  });
}
