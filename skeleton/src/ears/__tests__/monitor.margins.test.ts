import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildMonitor } from '../monitor.js';
import type { MonitorSpec, PredicateTemplate, Trace } from '../types.js';
import { arbTrace } from './generators.trace.js';
import { propConfig } from './support.js';

const above: PredicateTemplate = {
  phrase: 'keep z above {length}', signals: ['z'], unit: 'm', margin: (s, k) => s.z! - k.threshold!,
};
const wBelow: PredicateTemplate = {
  phrase: 'keep w below {length}', signals: ['w'], unit: 'm', margin: (s, k) => k.limit! - s.w!,
};
/** Reads two signals: the height and (1 - tilt). The tighter one decides. */
const upright: PredicateTemplate = {
  phrase: 'stay upright', signals: ['z', 'tilt'], unit: 'm', margin: (s) => Math.min(s.z!, 1 - s.tilt!),
};

function trace(t: number[], sig: Record<string, number[]>, events: Trace['events'] = []): Trace {
  const signals: Record<string, Float64Array> = {};
  for (const k of Object.keys(sig)) signals[k] = Float64Array.from(sig[k]!);
  return { t: Float64Array.from(t), signals, events };
}
const ts = [0, 1, 2, 3, 4, 5];
const trig = [{ name: 'trigger', t: 1 }];

describe('monitor margin breakdown', () => {
  it('names the signal that came closest to breaking, and when', () => {
    // Window [1, 4]. Joint margin min(z, 1 - tilt) is 0.9, 0.2, 0.8, 0.7: lowest 0.2 at t = 2, set by the tilt.
    const tr = trace(ts, { z: [9, 5, 3, 4, 2, 7], tilt: [0, 0.1, 0.8, 0.2, 0.3, 0] }, trig);
    const m = buildMonitor({ pattern: 'event', predicate: upright, slots: {}, wrapper: { kind: 'always', duration: 3 } });
    const r = m(tr, { margins: true });
    expect(r.robustness).toBeCloseTo(0.2, 12);
    expect([r.worstAt, r.unit]).toEqual([2, 'm']);
    expect(r.margins).toEqual({ z: expect.closeTo(0.9, 12), tilt: expect.closeTo(0.2, 12) });
    expect(r.marginsAt).toEqual({ z: 1, tilt: 2 });
  });

  it('adds nothing without the option, and the default result has the same three numbers', () => {
    const tr = trace(ts, { z: [9, 5, 3, 4, 2, 7], tilt: [0, 0.1, 0.8, 0.2, 0.3, 0] }, trig);
    const m = buildMonitor({ pattern: 'event', predicate: upright, slots: {}, wrapper: { kind: 'always', duration: 3 } });
    const plain = m(tr);
    expect(Object.keys(plain).sort()).toEqual(['robustness', 'unit', 'worstAt']);
    expect(m(tr, { margins: false })).toEqual(plain);
    const { robustness, worstAt, unit } = m(tr, { margins: true });
    expect({ robustness, worstAt, unit }).toEqual(plain);
  });

  it('for within, counts only the hold after the deadline', () => {
    // F[1,3] G: z is bad at t = 1 and 2 (before the deadline t = 3), then 0.5, 7, 8. The hold starts at t = 3.
    const tr = trace(ts, { z: [9, -1, -2, 0.5, 7, 8] }, trig);
    const m = buildMonitor({ pattern: 'event', predicate: above, slots: { threshold: 0 }, wrapper: { kind: 'eventually', duration: 2 } });
    const r = m(tr, { margins: true });
    expect(r.margins).toEqual({ z: 0.5 });
    expect(r.marginsAt).toEqual({ z: 3 });
  });

  it('gates a WHILE requirement by the state margin', () => {
    // The state holds (w below 0) only at t = 2, 3, 4: elsewhere the implication is vacuous and the margin is -(state margin).
    const tr = trace(ts, { z: [5, 5, 1, 2, 3, 5], w: [1, 1, -1, -1, -1, 1] });
    const m = buildMonitor({
      pattern: 'state', predicate: above, slots: { threshold: 0 }, wrapper: { kind: 'always' },
      stateMargin: { predicate: wBelow, slots: { limit: 0 } },
    });
    const r = m(tr, { margins: true });
    expect(r.robustness).toBe(1);
    expect(r.margins).toEqual({ z: 1 });
    expect(r.marginsAt).toEqual({ z: 2 });
  });

  it('has no breakdown when the monitor gives no verdict', () => {
    const m = buildMonitor({ pattern: 'event', predicate: above, slots: { threshold: 0 }, wrapper: { kind: 'always', duration: 3 } });
    const r = m(trace(ts, { z: [1, 1, 1, 1, 1, 1] }, [{ name: 'trigger', t: 9 }]), { margins: true });
    expect(r.robustness).toBeNaN();
    expect(r.margins).toBeUndefined();
  });

  it('does not change the trace', () => {
    const tr = trace(ts, { z: [9, 5, 3, 4, 2, 7], tilt: [0, 0.1, 0.8, 0.2, 0.3, 0] }, trig);
    const before = JSON.stringify([...tr.t, ...tr.signals.z!, ...tr.signals.tilt!]);
    buildMonitor({ pattern: 'event', predicate: upright, slots: {}, wrapper: { kind: 'always', duration: 3 } })(tr, { margins: true });
    expect(JSON.stringify([...tr.t, ...tr.signals.z!, ...tr.signals.tilt!])).toBe(before);
  });
});

const specs = (th: number, dur: number): MonitorSpec[] => [
  { pattern: 'ubiquitous', predicate: above, slots: { threshold: th }, wrapper: { kind: 'always' } },
  { pattern: 'ubiquitous', predicate: above, slots: { threshold: th }, wrapper: { kind: 'eventually', duration: dur } },
  { pattern: 'event', predicate: above, slots: { threshold: th }, wrapper: { kind: 'always', duration: dur } },
  { pattern: 'event', predicate: above, slots: { threshold: th }, wrapper: { kind: 'eventually', duration: dur } },
  { pattern: 'unwanted', predicate: above, slots: { threshold: th }, wrapper: { kind: 'eventually', duration: dur } },
  { pattern: 'state', predicate: above, slots: { threshold: th }, wrapper: { kind: 'always' }, stateMargin: { predicate: wBelow, slots: { limit: 0 } } },
  { pattern: 'state', predicate: above, slots: { threshold: th }, wrapper: { kind: 'always', duration: dur }, stateMargin: { predicate: wBelow, slots: { limit: 0 } } },
];

const arbTr = arbTrace({ signals: ['z', 'w'], maxSamples: 200 });
const arbTh = fc.integer({ min: -20, max: 20 }).map((k) => k / 4);
const arbDur = fc.integer({ min: 1, max: 200 }).map((k) => k / 50);

describe('Property: the margin breakdown agrees with the robustness', () => {
  it('for a response predicate that reads one signal, that signal\'s margin is the robustness', () => {
    fc.assert(fc.property(arbTr, arbTh, arbDur, (tr, th, dur) => {
      for (const spec of specs(th, dur)) {
        const m = buildMonitor(spec);
        const plain = m(tr);
        const r = m(tr, { margins: true });
        expect(Object.is(r.robustness, plain.robustness) && Object.is(r.worstAt, plain.worstAt) && r.unit === plain.unit).toBe(true);
        if (Number.isNaN(plain.robustness)) { expect(r.margins).toBeUndefined(); continue; }
        expect(Object.keys(r.margins ?? {})).toEqual(['z']);
        expect(r.margins!.z).toBe(plain.robustness);
        expect(Number.isFinite(r.marginsAt!.z)).toBe(true);
      }
    }), propConfig);
  });

  it('for a two-signal predicate, reports exactly the response signals, each with a finite margin and a time inside the trace', () => {
    const arbTr2 = arbTrace({ signals: ['z', 'tilt'], maxSamples: 200 });
    fc.assert(fc.property(arbTr2, arbDur, (tr, dur) => {
      for (const wrapper of [{ kind: 'always' as const }, { kind: 'always' as const, duration: dur }, { kind: 'eventually' as const, duration: dur }]) {
        const r = buildMonitor({ pattern: 'ubiquitous', predicate: upright, slots: {}, wrapper })(tr, { margins: true });
        if (Number.isNaN(r.robustness)) { expect(r.margins).toBeUndefined(); continue; }
        expect(Object.keys(r.margins!).sort()).toEqual(['tilt', 'z']);
        for (const k of ['tilt', 'z']) {
          expect(Number.isNaN(r.margins![k]!)).toBe(false);
          expect(r.marginsAt![k]!).toBeGreaterThanOrEqual(tr.t[0]!);
          expect(r.marginsAt![k]!).toBeLessThanOrEqual(tr.t[tr.t.length - 1]!);
        }
      }
    }), propConfig);
  });
});