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

const arbAnchored = fc.constantFrom('event' as const, 'unwanted' as const);

const mk = (over: Partial<MonitorSpec>): MonitorSpec =>
  ({
    pattern: 'event',
    predicate: above,
    slots: { threshold: 0 },
    wrapper: { kind: 'always', duration: 1 },
    ...over,
  }) as MonitorSpec;

describe('Feature: golem-ears, Property 20: A trace with no trigger, no window sample or a missing signal is never reported as satisfied', () => {
  /** **Validates: Requirements 6.7, 7.9** */
  it('returns NaN with unit trace when an anchored pattern has no trigger event', () => {
    fc.assert(
      fc.property(arbTrace({ events: false }), arbAnchored, arbWrapper, (tr, pattern, wrapper) => {
        const r = buildMonitor(mk({ pattern, wrapper }))(tr);
        expect(r.robustness).toBeNaN();
        expect(r.robustness > 0).toBe(false);
        expect(r.unit).toBe('trace');
        expect(r.worstAt).toBe(0);
      }),
      propConfig,
    );
  });

  /** **Validates: Requirements 6.11, 7.5** */
  it('returns NaN with unit trace when the window holds no sample', () => {
    fc.assert(
      fc.property(
        arbTrace({ events: false }),
        arbAnchored,
        arbWrapper,
        fc.double({ min: 0.001, max: 10, noNaN: true }),
        (tr, pattern, wrapper, past) => {
          const last = tr.t[tr.t.length - 1]!;
          const withTrigger: Trace = { ...tr, events: [{ name: 'trigger', t: last + past }] };
          const r = buildMonitor(mk({ pattern, wrapper }))(withTrigger);
          expect(r.robustness).toBeNaN();
          expect(r.unit).toBe('trace');
          expect(r.worstAt).toBe(0);
        },
      ),
      propConfig,
    );
  });

  /** **Validates: Requirements 6.11, 7.5** */
  it('returns NaN with unit trace when the window falls in a gap between samples', () => {
    fc.assert(
      fc.property(arbTrace({ events: false, minSamples: 2 }), fc.nat(), (tr, k) => {
        const i = k % (tr.t.length - 1);
        const a = tr.t[i]! + 0.002;
        const withTrigger: Trace = { ...tr, events: [{ name: 'trigger', t: a }] };
        const r = buildMonitor(mk({ wrapper: { kind: 'always', duration: 0.003 } }))(withTrigger);
        expect(r.robustness).toBeNaN();
        expect(r.unit).toBe('trace');
        expect(r.worstAt).toBe(0);
      }),
      propConfig,
    );
  });

  /** **Validates: Requirements 7.10** */
  it('returns NaN with unit trace for an empty trace', () => {
    fc.assert(
      fc.property(arbWrapper, fc.constantFrom('event' as const, 'unwanted' as const, 'ubiquitous' as const), (wrapper, pattern) => {
        const empty: Trace = { t: new Float64Array(0), signals: { z: new Float64Array(0) }, events: [{ name: 'trigger', t: 0 }] };
        const r = buildMonitor(mk({ pattern, wrapper }))(empty);
        expect(r.robustness).toBeNaN();
        expect(r.unit).toBe('trace');
        expect(r.worstAt).toBe(0);
      }),
      propConfig,
    );
  });

  /** **Validates: Requirements 7.9, 7.10** */
  it('returns NaN with unit signal when the predicate signal is missing', () => {
    fc.assert(
      fc.property(arbTrace({ signals: ['y'] }), arbAnchored, arbWrapper, (tr, pattern, wrapper) => {
        const withTrigger: Trace = { ...tr, events: [{ name: 'trigger', t: tr.t[0]! }] };
        const r = buildMonitor(mk({ pattern, wrapper }))(withTrigger);
        expect(r.robustness).toBeNaN();
        expect(r.robustness > 0).toBe(false);
        expect(r.unit).toBe('signal');
        expect(r.worstAt).toBe(0);
      }),
      propConfig,
    );
  });

  /** **Validates: Requirements 7.10** */
  it('returns NaN with the predicate unit at the first sample where margin is NaN', () => {
    fc.assert(
      fc.property(arbTrace({ events: false }), fc.nat(), arbWrapper.map((w) => w.kind), (tr, pick, kind) => {
        const z = tr.signals.z!;
        const bad = z[pick % z.length]!;
        const predicate: PredicateTemplate = {
          ...above,
          unit: 'bad-unit',
          margin: (s, k) => (s.z === bad ? NaN : s.z! - k.threshold!),
        };
        const r = buildMonitor(mk({ pattern: 'ubiquitous', predicate, wrapper: { kind } as MonitorSpec['wrapper'] }))(tr);
        const first = z.findIndex((v) => v === bad);
        expect(r.robustness).toBeNaN();
        expect(r.unit).toBe('bad-unit');
        expect(r.worstAt).toBe(tr.t[first]);
      }),
      propConfig,
    );
  });
});
