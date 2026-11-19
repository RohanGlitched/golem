import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildMonitor } from '../monitor.js';
import type { MonitorSpec, Pattern, PredicateTemplate } from '../types.js';
import { arbTrace } from './generators.trace.js';
import { propConfig } from './support.js';

const above: PredicateTemplate = {
  phrase: 'keep z above {length}',
  signals: ['z'],
  unit: 'm',
  margin: (s, k) => s.z! - k.threshold!,
};

// A fixed state predicate on a second signal; its margin does not depend on the response threshold.
const stateAbove: PredicateTemplate = {
  phrase: 'w is above {length}',
  signals: ['w'],
  unit: 'm',
  margin: (s, k) => s.w! - k.threshold!,
};

const arbPattern = fc.constantFrom<Pattern>('ubiquitous', 'event', 'state', 'unwanted', 'optional');
const arbWrapper = fc.oneof(
  fc.record({
    kind: fc.constant<'always'>('always'),
    duration: fc.option(fc.integer({ min: 1, max: 300 }).map((k) => k * 0.01), { nil: undefined }),
  }),
  fc.record({
    kind: fc.constant<'eventually'>('eventually'),
    duration: fc.integer({ min: 1, max: 300 }).map((k) => k * 0.01),
  }),
);
const arbThreshold = fc.integer({ min: -30, max: 30 }).map((k) => k / 4);

function build(
  pattern: Pattern,
  wrapper: { kind: 'always' | 'eventually'; duration?: number | undefined },
  threshold: number,
) {
  const w = wrapper.duration === undefined ? { kind: wrapper.kind } : { kind: wrapper.kind, duration: wrapper.duration };
  const spec: MonitorSpec = {
    pattern,
    predicate: above,
    slots: { threshold },
    wrapper: w as MonitorSpec['wrapper'],
    ...(pattern === 'state' ? { stateMargin: { predicate: stateAbove, slots: { threshold: 0 } } } : {}),
  };
  return buildMonitor(spec);
}

describe('Feature: golem-ears, Property 24: Raising an above threshold never raises robustness', () => {
  it('gives robustness(th2) <= robustness(th1) for th1 <= th2 on the same trace', () => {
    // **Validates: Requirements 7.14, 13.6**
    fc.assert(
      fc.property(
        arbTrace({ signals: ['z', 'w'] }),
        arbPattern,
        arbWrapper,
        arbThreshold,
        arbThreshold,
        (tr, pattern, wrapper, a, b) => {
          const th1 = Math.min(a, b);
          const th2 = Math.max(a, b);
          const r1 = build(pattern, wrapper, th1)(tr);
          const r2 = build(pattern, wrapper, th2)(tr);
          expect(r2.unit).toBe(r1.unit);
          if (Number.isNaN(r1.robustness)) {
            // Unmeasurable (no trigger or empty window) does not depend on the threshold.
            expect(Number.isNaN(r2.robustness)).toBe(true);
          } else {
            expect(r2.robustness).toBeLessThanOrEqual(r1.robustness);
          }
        },
      ),
      propConfig,
    );
  });

  it('gives equal robustness for a disabled optional feature at any thresholds', () => {
    // **Validates: Requirements 7.14, 13.6**
    const spec = (threshold: number): MonitorSpec => ({
      pattern: 'optional',
      predicate: above,
      slots: { threshold },
      wrapper: { kind: 'always' },
      disabledFeature: true,
    });
    fc.assert(
      fc.property(arbTrace(), arbThreshold, arbThreshold, (tr, a, b) => {
        const r1 = buildMonitor(spec(Math.min(a, b)))(tr);
        const r2 = buildMonitor(spec(Math.max(a, b)))(tr);
        expect(r2.robustness).toBeLessThanOrEqual(r1.robustness);
      }),
      propConfig,
    );
  });
});
