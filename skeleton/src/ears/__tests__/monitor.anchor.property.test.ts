import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildMonitor } from '../monitor.js';
import type { MonitorSpec, PredicateTemplate, Trace } from '../types.js';
import { arbTrace } from './generators.trace.js';
import { propConfig } from './support.js';

const above: PredicateTemplate = {
  phrase: 'keep z above {length}',
  signals: ['z'],
  unit: 'm',
  margin: (s, k) => s.z! - k.threshold!,
};

const arbPattern = fc.constantFrom<'event' | 'unwanted'>('event', 'unwanted');
const arbWrapper = fc.record({
  kind: fc.constantFrom<'always' | 'eventually'>('always', 'eventually'),
  duration: fc.integer({ min: 1, max: 300 }).map((k) => k * 0.01),
});

const mkSpec = (
  pattern: 'event' | 'unwanted',
  wrapper: { kind: 'always' | 'eventually'; duration: number },
): MonitorSpec => ({ pattern, predicate: above, slots: { threshold: 0 }, wrapper }) as MonitorSpec;

const same = (a: { robustness: number; worstAt: number; unit: string }, b: typeof a): void => {
  expect(Object.is(a.robustness, b.robustness) || a.robustness === b.robustness).toBe(true);
  expect(a.worstAt).toBe(b.worstAt);
  expect(a.unit).toBe(b.unit);
};

describe('Feature: golem-ears, Property 19: First trigger anchors the window', () => {
  it('ignores later trigger events and unrelated events', () => {
    // **Validates: Requirements 6.6, 6.13**
    fc.assert(
      fc.property(
        arbTrace({ events: false }),
        arbPattern,
        arbWrapper,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.array(fc.record({ name: fc.constantFrom('trigger', 'other'), u: fc.double({ min: 0, max: 1, noNaN: true }) }), { maxLength: 4 }),
        (tr, pattern, wrapper, u0, extra) => {
          const lo = tr.t[0]!;
          const hi = tr.t[tr.t.length - 1]!;
          const t0 = lo + u0 * (hi - lo);
          const later = extra
            .map((e) => ({ name: e.name, t: Math.min(hi, t0 + e.u * (hi - t0)) }))
            .filter((e) => e.t >= t0)
            .sort((a, b) => a.t - b.t);
          const single: Trace = { ...tr, events: [{ name: 'trigger', t: t0 }] };
          const multi: Trace = { ...tr, events: [{ name: 'trigger', t: t0 }, ...later] };
          const m = buildMonitor(mkSpec(pattern, wrapper));
          same(m(multi), m(single));
        },
      ),
      propConfig,
    );
  });

  it('does not depend on samples before the first trigger for an always window', () => {
    // **Validates: Requirements 6.6, 6.13**
    fc.assert(
      fc.property(
        arbTrace({ events: false }),
        arbPattern,
        fc.integer({ min: 1, max: 300 }).map((k) => k * 0.01),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.array(fc.integer({ min: -100, max: 100 }), { minLength: 1, maxLength: 8 }),
        (tr, pattern, duration, u0, junk) => {
          const lo = tr.t[0]!;
          const hi = tr.t[tr.t.length - 1]!;
          const t0 = lo + u0 * (hi - lo);
          const z = Float64Array.from(tr.signals.z!);
          for (let i = 0; i < z.length; i++) if (tr.t[i]! < t0) z[i] = junk[i % junk.length]! / 3;
          const base: Trace = { ...tr, events: [{ name: 'trigger', t: t0 }] };
          const altered: Trace = { ...base, signals: { z } };
          const m = buildMonitor(mkSpec(pattern, { kind: 'always', duration }));
          same(m(altered), m(base));
        },
      ),
      propConfig,
    );
  });

  it('moves the window when the first trigger moves', () => {
    // **Validates: Requirements 6.6, 6.13**
    fc.assert(
      fc.property(
        arbPattern,
        fc.integer({ min: 5, max: 60 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        (pattern, n, i, gap) => {
          const j = i + gap;
          fc.pre(j < n + 20);
          const len = n + 20;
          const t = Float64Array.from({ length: len }, (_, k) => k);
          const z = Float64Array.from({ length: len }, (_, k) => k); // strictly increasing
          const mk = (at: number): Trace => ({ t, signals: { z }, events: [{ name: 'trigger', t: at }] });
          const m = buildMonitor(mkSpec(pattern, { kind: 'always', duration: 3 }));
          const a = m(mk(i));
          const b = m(mk(j));
          expect(a.robustness).toBe(i);
          expect(b.robustness).toBe(j);
          expect(a.robustness).not.toBe(b.robustness);
        },
      ),
      propConfig,
    );
  });
});
