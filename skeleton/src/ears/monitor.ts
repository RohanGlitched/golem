// Monitor builder: robustness semantics for always (G), within (F then G) and state.
// The sample loop uses indices and scalar locals only; the scratch record and
// the signal-array list are allocated once per buildMonitor call. Trace is never written.

import type { MonitorSpec, Trace } from './types.js';

export type MonitorResult = {
  robustness: number; worstAt: number; unit: string;
  /**
   * Only with { margins: true }. For each signal the requirement's response predicate reads: the lowest margin over the
   * window the requirement checks, with that signal live and the others held at their first-window value. Same unit as
   * obustness. For a response predicate that reads one signal it equals obustness.
   */
  margins?: Record<string, number>;
  /** Only with { margins: true }. The earliest time, in seconds, of each signal's lowest margin. */
  marginsAt?: Record<string, number>;
};
export interface MonitorOptions { margins?: boolean }
export type MonitorFn = (trace: Trace, opts?: MonitorOptions) => MonitorResult;

/**
 * WHILE I^ ... for d: G(I^ -> G[t, t+d] I+). For each instant i from lo: max(-s[i], min of p over [i, i+hold]).
 * dq is a scratch index deque of length n. A violation points at the response sample, a held implication at the state instant.
 */
function slideHold(p: Float64Array, s: Float64Array, dq: Int32Array, t: Float64Array, lo: number, n: number, hold: number): { worst: number; worstAt: number } {
  let worst = Infinity;
  let worstAt = t[lo]!;
  let r = lo - 1;
  let head = 0;
  let tail = 0;
  for (let i = lo; i < n; i++) {
    const end = t[i]! + hold;
    while (r + 1 < n && t[r + 1]! <= end) {
      r++;
      // Pop strictly larger values only, so the front is the earliest minimum.
      while (tail > head && p[dq[tail - 1]!]! > p[r]!) tail--;
      dq[tail++] = r;
    }
    while (dq[head]! < i) head++;
    const j = dq[head]!;
    const minP = p[j]!;
    const ns = -s[i]!;
    const term = ns > minP ? ns : minP;
    if (term < worst) {
      worst = term;
      worstAt = ns > minP && term > 0 ? t[i]! : t[j]!;
    }
  }
  return { worst, worstAt };
}

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

  // Signal names of each predicate, and frozen copies of the slot values, so a margin
  // function that writes to its arguments cannot change a later sample or call.
  const respNames = [...new Set(predicate.signals)];
  const stateNames = state ? [...new Set(state.predicate.signals)] : [];
  const respIdx = respNames.map((n) => names.indexOf(n));
  const stateIdx = stateNames.map((n) => names.indexOf(n));
  const respSlots: Record<string, number> = Object.freeze({ ...slots });
  const arrays: Float64Array[] = new Array(count);
  const stateSlots = state ? state.predicate : undefined;
  const stateSlotValues: Record<string, number> | undefined = state ? Object.freeze({ ...state.slots }) : undefined;
  const useAnchor = pattern === 'event' || pattern === 'unwanted';
  // A WHILE state is checked at every instant; the compiler rejects `within` on it.
  const isEventually = wrapper.kind === 'eventually' && pattern !== 'state';
  const duration = wrapper.duration;
  const onset = spec.onset !== undefined && spec.onset > 0 ? spec.onset : 0;
  const windowed = pattern !== 'state' && duration !== undefined;
  // WHILE ψ ... for d: G(ψ → G[t, t+d] φ). Margins go into buffers that grow with the longest
  // trace seen; a monotone deque gives the sliding minimum of φ in O(n).
  const holdFor = state && wrapper.kind === 'always' && duration !== undefined && duration > 0 ? duration : 0;
  let pBuf = new Float64Array(0);
  let sBuf = new Float64Array(0);
  let dq = new Int32Array(0);

  return (trace: Trace, opts?: MonitorOptions): MonitorResult => {
    const signals = trace.signals;
    const t = trace.t;
    const n = t.length;
    for (let k = 0; k < count; k++) {
      const arr = signals[names[k]!];
      if (arr === undefined || arr.length !== n) return { robustness: NaN, worstAt: 0, unit: 'signal' };
      arrays[k] = arr;
    }
    if (n === 0) return { robustness: NaN, worstAt: 0, unit: 'trace' };
    // One record per predicate per call (not per sample).
    const rs: Record<string, number> = {};
    for (const nm of respNames) rs[nm] = 0;
    const ss: Record<string, number> = {};
    for (const nm of stateNames) ss[nm] = 0;

    let a = t[0]!;
    if (useAnchor) {
      const events = trace.events;
      let found = false;
      for (let e = 0; e < events.length; e++) {
        if (events[e]!.name === 'trigger') { a = events[e]!.t; found = true; break; }
      }
      if (!found) return { robustness: NaN, worstAt: 0, unit: 'trace' };
    }
    // F-then-G (`within T`): reach by the deadline, then hold to the last sample.
    const deadline = isEventually ? a + onset + (duration as number) : 0;
    const b = windowed && !isEventually ? a + onset + (duration as number) : t[n - 1]!;

    // First index with t[i] >= a.
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (t[mid]! < a) lo = mid + 1; else hi = mid;
    }
    if (lo >= n || t[lo]! > b) return { robustness: NaN, worstAt: 0, unit: 'trace' };
    if (isEventually && t[lo]! > deadline) return { robustness: NaN, worstAt: 0, unit: 'trace' };

    // The samples the requirement checks: `within` holds from the last sample at or before the deadline.
    const finish = (res: MonitorResult): MonitorResult => {
      if (opts?.margins !== true || res.robustness !== res.robustness) return res;
      let first = lo;
      if (isEventually) while (first + 1 < n && t[first + 1]! <= deadline) first++;
      let last = first;
      while (last + 1 < n && t[last + 1]! <= b) last++;
      const margins: Record<string, number> = {};
      const marginsAt: Record<string, number> = {};
      // The state margin, live, gates every signal's term. Computed once.
      const sm = stateSlots ? new Float64Array(n) : undefined;
      if (sm && stateSlots) {
        for (let i = first; i <= last || (holdFor > 0 && i < n); i++) {
          for (let k = 0; k < stateNames.length; k++) ss[stateNames[k]!] = arrays[stateIdx[k]!]![i]!;
          sm[i] = stateSlots.margin(ss, stateSlotValues as Record<string, number>);
        }
      }
      const frozen: Record<string, number> = {};
      const p = holdFor > 0 ? new Float64Array(n) : undefined;
      const dqk = holdFor > 0 ? new Int32Array(n) : undefined;
      for (let k = 0; k < respNames.length; k++) {
        const name = respNames[k]!;
        for (let j = 0; j < respNames.length; j++) frozen[respNames[j]!] = arrays[respIdx[j]!]![lo]!;
        const live = arrays[respIdx[k]!]!;
        let best = Infinity;
        let at = t[first]!;
        let bad = false;
        const end = holdFor > 0 ? n - 1 : last;
        for (let i = first; i <= end; i++) {
          frozen[name] = live[i]!;
          const m = predicate.margin(frozen, respSlots);
          if (m !== m) { bad = true; break; }
          if (p) p[i] = m;
          else {
            const term = sm && -sm[i]! > m ? -sm[i]! : m;
            if (term < best) { best = term; at = t[i]!; }
          }
        }
        if (bad) continue;
        if (p && sm && dqk) {
          const w = slideHold(p, sm, dqk, t, lo, n, holdFor);
          best = w.worst;
          at = w.worstAt;
        }
        margins[name] = best;
        marginsAt[name] = at;
      }
      return { ...res, margins, marginsAt };
    };
    if (stateSlots && holdFor > 0) {
      if (pBuf.length < n) { pBuf = new Float64Array(n); sBuf = new Float64Array(n); dq = new Int32Array(n); }
      for (let i = lo; i < n; i++) {
        for (let k = 0; k < respNames.length; k++) rs[respNames[k]!] = arrays[respIdx[k]!]![i]!;
        const m = predicate.margin(rs, respSlots);
        if (m !== m) return { robustness: NaN, worstAt: t[i]!, unit };
        for (let k = 0; k < stateNames.length; k++) ss[stateNames[k]!] = arrays[stateIdx[k]!]![i]!;
        const sm = stateSlots.margin(ss, stateSlotValues as Record<string, number>);
        if (sm !== sm) return { robustness: NaN, worstAt: t[i]!, unit: stateSlots.unit };
        pBuf[i] = m;
        sBuf[i] = sm;
      }
      const { worst, worstAt } = slideHold(pBuf, sBuf, dq, t, lo, n, holdFor);
      return finish({ robustness: worst, worstAt, unit });
    }

    // Always: the minimum and its first time. F-then-G: the minimum from the last sample at or
    // before the deadline to the end, and the time of the last sample with a margin <= 0.
    let best = Infinity;
    let bestAt = t[lo]!;
    let lastViolation = -Infinity;
    for (let i = lo; i < n; i++) {
      const ti = t[i]!;
      if (ti > b) break;
      for (let k = 0; k < respNames.length; k++) rs[respNames[k]!] = arrays[respIdx[k]!]![i]!;
      let m = predicate.margin(rs, respSlots);
      if (m !== m) return { robustness: NaN, worstAt: ti, unit };
      if (stateSlots) {
        for (let k = 0; k < stateNames.length; k++) ss[stateNames[k]!] = arrays[stateIdx[k]!]![i]!;
        const sm = stateSlots.margin(ss, stateSlotValues as Record<string, number>);
        if (sm !== sm) return { robustness: NaN, worstAt: ti, unit: stateSlots.unit };
        const ns = -sm;
        if (ns > m) m = ns;
      }
      if (isEventually) {
        if (m <= 0) lastViolation = ti;
        // Until the deadline, each sample restarts the hold window.
        if (ti <= deadline || m < best) { best = m; bestAt = ti; }
      } else if (m < best) { best = m; bestAt = ti; }
    }
    if (isEventually && lastViolation !== -Infinity) bestAt = lastViolation;
    return finish({ robustness: best, worstAt: bestAt, unit });
  };
}
