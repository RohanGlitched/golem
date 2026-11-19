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

const arbWrapper = fc.record({
  kind: fc.constantFrom('always' as const, 'eventually' as const),
  duration: fc.double({ min: 0.001, max: 5, noNaN: true }),
});

const mk = (over: Partial<MonitorSpec>): MonitorSpec =>
  ({
    pattern: 'optional',
    predicate: above,
    slots: { threshold: 0 },
    wrapper: { kind: 'always', duration: 1 },
    ...over,
  }) as MonitorSpec;

describe('Feature: golem-ears, Property 25: A disabled optional feature is vacuously satisfied', () => {
  /** **Validates: Requirements 6.8** */
  it('returns +Infinity, worstAt 0 and the response unit for any trace', () => {
    fc.assert(
      fc.property(arbTrace(), arbWrapper, (tr, wrapper) => {
        const r = buildMonitor(mk({ disabledFeature: true, wrapper }))(tr);
        expect(r.robustness).toBe(Infinity);
        expect(r.worstAt).toBe(0);
        expect(r.unit).toBe('m');
      }),
      propConfig,
    );
  });

  /** **Validates: Requirements 6.8** */
  it('returns +Infinity for traces with no trigger event, missing signals or no samples', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          arbTrace({ events: false }),
          arbTrace({ signals: ['y'] }),
          fc.constant<Trace>({ t: new Float64Array(0), signals: {}, events: [] }),
          fc.constant<Trace>({ t: new Float64Array(0), signals: { z: new Float64Array(0) }, events: [] }),
        ),
        arbWrapper,
        (tr, wrapper) => {
          const r = buildMonitor(mk({ disabledFeature: true, wrapper }))(tr);
          expect(r.robustness).toBe(Infinity);
          expect(r.worstAt).toBe(0);
          expect(r.unit).toBe('m');
        },
      ),
      propConfig,
    );
  });

  /** **Validates: Requirements 6.8** */
  it('monitors an enabled feature normally (matches the same spec without the flag, finite on a populated trace)', () => {
    fc.assert(
      fc.property(arbTrace(), arbWrapper, fc.boolean(), (tr, wrapper, explicitFalse) => {
        const enabled = buildMonitor(mk(explicitFalse ? { disabledFeature: false, wrapper } : { wrapper }))(tr);
        const ubiquitous = buildMonitor(mk({ pattern: 'ubiquitous', wrapper }))(tr);
        expect(Number.isFinite(enabled.robustness)).toBe(true);
        expect(Object.is(enabled.robustness, ubiquitous.robustness)).toBe(true);
        expect(enabled.worstAt).toBe(ubiquitous.worstAt);
        expect(enabled.unit).toBe('m');
      }),
      propConfig,
    );
  });

  /** **Validates: Requirements 6.8** */
  it('does not vacuously satisfy an enabled feature whose signal is missing', () => {
    fc.assert(
      fc.property(arbTrace({ signals: ['y'] }), arbWrapper, (tr, wrapper) => {
        const r = buildMonitor(mk({ wrapper }))(tr);
        expect(r.robustness).toBeNaN();
        expect(r.unit).toBe('signal');
      }),
      propConfig,
    );
  });
});
