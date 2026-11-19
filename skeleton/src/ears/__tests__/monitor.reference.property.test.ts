import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildMonitor } from '../monitor.js';
import type { MonitorSpec, Pattern, PredicateTemplate, TemporalWrapper, Trace } from '../types.js';
import { arbTrace } from './generators.trace.js';
import { refMonitor } from './refMonitor.js';
import { propConfig } from './support.js';

const above: PredicateTemplate = {
  phrase: 'keep z above {length}',
  signals: ['z'],
  unit: 'm',
  margin: (s, k) => s.z! - k.threshold!,
};

// Reads two signals; yields NaN when the sum is exactly 0.5 so NaN handling is exercised.
const mixed: PredicateTemplate = {
  phrase: 'keep z plus w off {length}',
  signals: ['z', 'w'],
  unit: 'm',
  margin: (s, k) => (s.z! + s.w! === 0.5 ? NaN : s.z! - s.w! - k.threshold!),
};

const stateCond: PredicateTemplate = {
  phrase: 'w is above {length}',
  signals: ['w'],
  unit: 's',
  margin: (s, k) => s.w! - k.threshold!,
};

const arbThreshold = fc.integer({ min: -20, max: 20 }).map((k) => k / 4);
const arbDuration = fc.integer({ min: 1, max: 1200 }).map((k) => k * 0.01);

const arbSpec: fc.Arbitrary<MonitorSpec> = fc
  .record({
    pattern: fc.constantFrom<Pattern>('ubiquitous', 'event', 'state', 'unwanted', 'optional'),
    kind: fc.constantFrom<'always' | 'eventually'>('always', 'eventually'),
    duration: fc.option(arbDuration, { nil: undefined }),
    predicate: fc.constantFrom(above, mixed),
    threshold: arbThreshold,
    stateThreshold: arbThreshold,
    disabled: fc.boolean(),
  })
  .map(({ pattern, kind, duration, predicate, threshold, stateThreshold, disabled }) => {
    const wrapper: TemporalWrapper =
      kind === 'eventually' ? { kind, duration: duration ?? 0.5 } : { kind, duration };
    const spec: MonitorSpec = { pattern, predicate, slots: { threshold }, wrapper };
    if (pattern === 'state') {
      spec.stateMargin = { predicate: stateCond, slots: { threshold: stateThreshold } };
    }
    if (pattern === 'optional') spec.disabledFeature = disabled;
    return spec;
  });

// Traces with signals z and w, and a trigger sometimes moved onto an exact sample time.
const arbCase = fc
  .tuple(arbTrace({ signals: ['z', 'w'] }), fc.option(fc.nat(10000), { nil: undefined }), arbSpec)
  .map(([tr, snap, spec]): [Trace, MonitorSpec] => {
    if (snap === undefined || tr.events.length === 0) return [tr, spec];
    const events = tr.events.map((e) => ({ ...e }));
    const first = events.find((e) => e.name === 'trigger');
    if (first) first.t = tr.t[snap % tr.t.length]!;
    return [{ ...tr, events }, spec];
  });

describe('Feature: golem-ears, Property 21: The monitor equals a naive reference over the closed window', () => {
  it('matches the naive reference bit for bit for every pattern and wrapper', () => {
    // **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.10, 6.12, 7.2, 7.3, 7.4, 7.6, 7.7**
    fc.assert(
      fc.property(arbCase, ([tr, spec]) => {
        const got = buildMonitor(spec)(tr);
        const want = refMonitor(spec, tr);
        expect(Object.is(got.robustness, want.robustness)).toBe(true);
        expect(Object.is(got.worstAt, want.worstAt)).toBe(true);
        expect(got.unit).toBe(want.unit);
      }),
      propConfig,
    );
  });

  it('reuses one monitor across traces with the same answers as a fresh reference', () => {
    // **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.10, 6.12, 7.2, 7.3, 7.4, 7.6, 7.7**
    fc.assert(
      fc.property(arbCase, arbCase, ([t1, spec], [t2]) => {
        const m = buildMonitor(spec);
        m(t1);
        const got = m(t2);
        const want = refMonitor(spec, t2);
        expect(Object.is(got.robustness, want.robustness)).toBe(true);
        expect(Object.is(got.worstAt, want.worstAt)).toBe(true);
        expect(got.unit).toBe(want.unit);
      }),
      propConfig,
    );
  });
});
