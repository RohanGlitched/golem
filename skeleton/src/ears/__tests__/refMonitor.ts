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
  const b = windowed ? a + (spec.wrapper.duration as number) : trace.t[trace.t.length - 1]!;

  const indices: number[] = [];
  for (let i = 0; i < trace.t.length; i++) {
    if (a <= trace.t[i]! && trace.t[i]! <= b) indices.push(i);
  }
  if (indices.length === 0) return { robustness: NaN, worstAt: 0, unit: 'trace' };

  const eventually = spec.wrapper.kind === 'eventually';
  let best = eventually ? -Infinity : Infinity;
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
    if (eventually ? m > best : m < best) {
      best = m;
      bestAt = ti;
    }
  }
  return { robustness: best, worstAt: bestAt, unit };
}
