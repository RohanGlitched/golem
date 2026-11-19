// Monitor builder: robustness semantics for always / eventually / state.
// The sample loop uses indices and scalar locals only; the scratch record and
// the signal-array list are allocated once per buildMonitor call. Trace is never written.

import type { MonitorSpec, Trace } from './types.js';

export type MonitorResult = { robustness: number; worstAt: number; unit: string };
export type MonitorFn = (trace: Trace) => MonitorResult;

export function buildMonitor(spec: MonitorSpec): MonitorFn {
  const { predicate, slots, wrapper, pattern } = spec;
  const state = pattern === 'state' ? spec.stateMargin : undefined;
  const unit = predicate.unit;

  if (spec.disabledFeature) {
    return () => ({ robustness: Infinity, worstAt: 0, unit });
  }

  // Union of signal names, in a fixed order.
  const names: string[] = [];
  for (const n of predicate.signals) if (!names.includes(n)) names.push(n);
  if (state) for (const n of state.predicate.signals) if (!names.includes(n)) names.push(n);
  const count = names.length;

  const scratch: Record<string, number> = {};
  for (const n of names) scratch[n] = 0;
  const arrays: Float64Array[] = new Array(count);
  const stateSlots = state ? state.predicate : undefined;
  const stateSlotValues = state ? state.slots : undefined;
  const useAnchor = pattern === 'event' || pattern === 'unwanted';
  const isEventually = wrapper.kind === 'eventually';
  const duration = wrapper.duration;
  const windowed = pattern !== 'state' && duration !== undefined;

  return (trace: Trace): MonitorResult => {
    const signals = trace.signals;
    for (let k = 0; k < count; k++) {
      const arr = signals[names[k]!];
      if (arr === undefined) return { robustness: NaN, worstAt: 0, unit: 'signal' };
      arrays[k] = arr;
    }
    const t = trace.t;
    const n = t.length;
    if (n === 0) return { robustness: NaN, worstAt: 0, unit: 'trace' };

    let a = t[0]!;
    if (useAnchor) {
      const events = trace.events;
      let found = false;
      for (let e = 0; e < events.length; e++) {
        if (events[e]!.name === 'trigger') { a = events[e]!.t; found = true; break; }
      }
      if (!found) return { robustness: NaN, worstAt: 0, unit: 'trace' };
    }
    const b = windowed ? a + (duration as number) : t[n - 1]!;

    // First index with t[i] >= a.
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (t[mid]! < a) lo = mid + 1; else hi = mid;
    }
    if (lo >= n || t[lo]! > b) return { robustness: NaN, worstAt: 0, unit: 'trace' };

    let best = isEventually ? -Infinity : Infinity;
    let bestAt = t[lo]!;
    for (let i = lo; i < n; i++) {
      const ti = t[i]!;
      if (ti > b) break;
      for (let k = 0; k < count; k++) scratch[names[k]!] = arrays[k]![i]!;
      let m = predicate.margin(scratch, slots);
      if (m !== m) return { robustness: NaN, worstAt: ti, unit };
      if (stateSlots) {
        const sm = stateSlots.margin(scratch, stateSlotValues as Record<string, number>);
        if (sm !== sm) return { robustness: NaN, worstAt: ti, unit: stateSlots.unit };
        const ns = -sm;
        if (ns > m) m = ns;
      }
      if (isEventually ? m > best : m < best) { best = m; bestAt = ti; }
    }
    return { robustness: best, worstAt: bestAt, unit };
  };
}
