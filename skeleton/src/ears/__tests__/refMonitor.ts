// Naive reference monitor for property tests. Deliberately independent of monitor.ts:
// no binary search, no scratch reuse, a plain filter over a <= t <= b.

import type { MonitorSpec, Trace } from '../types.js';

export type RefResult = { robustness: number; worstAt: number; unit: string };

export function refMonitor(spec: MonitorSpec, trace: Trace): RefResult {
  const unit = spec.predicate.unit;
  if (spec.disabledFeature) return { robustness: Infinity, worstAt: 0, unit };

  const state = spec.pattern === 'state' ? spec.stateMargin : undefined;
  const needed = [...spec.predicate.signals, ...(state ? state.predicate.signals : [])];
  for (const name of needed) {
    if (trace.signals[name] === undefined) return { robustness: NaN, worstAt: 0, unit: 'signal' };
  }
  if (trace.t.length === 0) return { robustness: NaN, worstAt: 0, unit: 'trace' };

  let a = trace.t[0]!;
  if (spec.pattern === 'event' || spec.pattern === 'unwanted') {
    const trigger = trace.events.find((e) => e.name === 'trigger');
    if (trigger === undefined) return { robustness: NaN, worstAt: 0, unit: 'trace' };
    a = trigger.t;
  }
  const windowed = spec.pattern !== 'state' && spec.wrapper.duration !== undefined;
  const eventually = spec.wrapper.kind === 'eventually';
  if (eventually && spec.pattern !== 'state') return refWithin(spec, trace, a, needed);
  const holdFor = state && spec.wrapper.kind === 'always' ? (spec.wrapper.duration ?? 0) : 0;
  if (state && holdFor > 0) return refStateFor(spec, trace, needed, holdFor);
  const b = windowed ? a + (spec.wrapper.duration as number) : trace.t[trace.t.length - 1]!;

  const indices: number[] = [];
  for (let i = 0; i < trace.t.length; i++) {
    if (a <= trace.t[i]! && trace.t[i]! <= b) indices.push(i);
  }
  if (indices.length === 0) return { robustness: NaN, worstAt: 0, unit: 'trace' };

  let best = Infinity;
  let bestAt = trace.t[indices[0]!]!;
  for (const i of indices) {
    const ti = trace.t[i]!;
    const at: Record<string, number> = {};
    for (const name of needed) at[name] = trace.signals[name]![i]!;
    let m = spec.predicate.margin(at, spec.slots);
    if (Number.isNaN(m)) return { robustness: NaN, worstAt: ti, unit };
    if (state) {
      const sm = state.predicate.margin(at, state.slots);
      if (Number.isNaN(sm)) return { robustness: NaN, worstAt: ti, unit: state.predicate.unit };
      m = Math.max(m, -sm);
    }
    // Strict comparison keeps the earliest sample on ties.
    if (m < best) {
      best = m;
      bestAt = ti;
    }
  }
  return { robustness: best, worstAt: bestAt, unit };
}

/**
 * WHILE ψ ... for d as G(ψ → G[t, t+d] φ), by brute force: for every sample i, the worst φ over
 * t_i <= t_j <= t_i + d, against -ψ_i. worstAt: the earliest worst φ sample of the critical i, or
 * t_i when a positive -ψ_i decides it.
 */
function refStateFor(spec: MonitorSpec, trace: Trace, needed: string[], d: number): RefResult {
  const unit = spec.predicate.unit;
  const st = spec.stateMargin!;
  const n = trace.t.length;
  const p: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < n; i++) {
    const at: Record<string, number> = {};
    for (const name of needed) at[name] = trace.signals[name]![i]!;
    const m = spec.predicate.margin(at, spec.slots);
    if (Number.isNaN(m)) return { robustness: NaN, worstAt: trace.t[i]!, unit };
    const sm = st.predicate.margin(at, st.slots);
    if (Number.isNaN(sm)) return { robustness: NaN, worstAt: trace.t[i]!, unit: st.predicate.unit };
    p.push(m);
    s.push(sm);
  }
  let best = Infinity;
  let bestAt = trace.t[0]!;
  for (let i = 0; i < n; i++) {
    let minP = Infinity;
    let jAt = i;
    for (let j = i; j < n && trace.t[j]! <= trace.t[i]! + d; j++) if (p[j]! < minP) { minP = p[j]!; jAt = j; }
    const term = Math.max(-s[i]!, minP);
    if (term < best) {
      best = term;
      bestAt = -s[i]! > minP && term > 0 ? trace.t[i]! : trace.t[jAt]!;
    }
  }
  return { robustness: best, worstAt: bestAt, unit };
}

/**
 * `within T` as F[a, a+T] G[., t_end], by brute force: the best over start samples i <= a+T of the
 * worst margin from i to the end. worstAt: the last sample with margin <= 0, or else the earliest
 * minimum of the hold window of the last start sample.
 */
function refWithin(spec: MonitorSpec, trace: Trace, a: number, needed: string[]): RefResult {
  const unit = spec.predicate.unit;
  const idx: number[] = [];
  for (let i = 0; i < trace.t.length; i++) if (trace.t[i]! >= a) idx.push(i);
  const deadline = a + (spec.wrapper.duration as number);
  const starts = idx.filter((i) => trace.t[i]! <= deadline);
  if (idx.length === 0 || starts.length === 0) return { robustness: NaN, worstAt: 0, unit: 'trace' };
  const margins = new Map<number, number>();
  for (const i of idx) {
    const at: Record<string, number> = {};
    for (const name of needed) at[name] = trace.signals[name]![i]!;
    const m = spec.predicate.margin(at, spec.slots);
    if (Number.isNaN(m)) return { robustness: NaN, worstAt: trace.t[i]!, unit };
    margins.set(i, m);
  }
  let best = -Infinity;
  for (const i of starts) {
    let worst = Infinity;
    for (const j of idx) if (j >= i) worst = Math.min(worst, margins.get(j)!);
    best = Math.max(best, worst);
  }
  const violations = idx.filter((j) => margins.get(j)! <= 0);
  let worstAt: number;
  if (violations.length > 0) {
    worstAt = trace.t[violations[violations.length - 1]!]!;
  } else {
    const hold = idx.filter((j) => j >= starts[starts.length - 1]!);
    const min = Math.min(...hold.map((j) => margins.get(j)!));
    worstAt = trace.t[hold.find((j) => margins.get(j) === min)!]!;
  }
  return { robustness: best, worstAt, unit };
}
