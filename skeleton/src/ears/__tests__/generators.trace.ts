import fc from 'fast-check';
import type { Trace } from '../types.js';

export interface ArbTraceOptions {
  /** Signal names to generate. Default ['z']. */
  signals?: readonly string[];
  minSamples?: number;
  maxSamples?: number;
  /** Allow zero or more 'trigger' events. Default true. */
  events?: boolean;
}

/**
 * Traces with strictly increasing t, 1 to 1000 samples, signal values drawn from a small
 * pool so ties are common, and optional trigger events inside [t[0], t[n-1]].
 */
export function arbTrace(opts: ArbTraceOptions = {}): fc.Arbitrary<Trace> {
  const names = opts.signals ?? ['z'];
  const minN = opts.minSamples ?? 1;
  const maxN = opts.maxSamples ?? 1000;
  const withEvents = opts.events ?? true;

  return fc
    .record({
      n: fc.integer({ min: minN, max: maxN }),
      t0: fc.integer({ min: 0, max: 20 }).map((k) => k * 0.25),
    })
    .chain(({ n, t0 }) =>
      fc.record({
        steps: fc.array(fc.integer({ min: 1, max: 8 }), { minLength: n, maxLength: n }),
        pool: fc.array(fc.integer({ min: -20, max: 20 }).map((k) => k / 4), { minLength: 1, maxLength: 5 }),
        picks: fc.tuple(
          ...names.map(() => fc.array(fc.nat(1000), { minLength: n, maxLength: n })),
        ),
        events: withEvents
          ? fc.array(fc.record({ name: fc.constantFrom('trigger', 'trigger', 'other'), u: fc.double({ min: 0, max: 1, noNaN: true }) }), { maxLength: 3 })
          : fc.constant([] as { name: string; u: number }[]),
        t0: fc.constant(t0),
      }),
    )
    .map(({ steps, pool, picks, events, t0 }) => {
      const n = steps.length;
      const t = new Float64Array(n);
      let cur = t0;
      for (let i = 0; i < n; i++) {
        cur += steps[i]! * 0.01;
        t[i] = cur;
      }
      const signals: Record<string, Float64Array> = {};
      names.forEach((name, k) => {
        const arr = new Float64Array(n);
        for (let i = 0; i < n; i++) arr[i] = pool[picks[k]![i]! % pool.length]!;
        signals[name] = arr;
      });
      const lo = t[0]!;
      const hi = t[n - 1]!;
      const evs = events
        .map((e) => ({ name: e.name, t: lo + e.u * (hi - lo) }))
        .sort((x, y) => x.t - y.t);
      return { t, signals, events: evs };
    });
}
