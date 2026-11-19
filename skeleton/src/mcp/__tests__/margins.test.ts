import { describe, expect, it } from 'vitest';
import { MarginsUnavailableError, explain, pickLowest, signalMargins, signalStats, summariseTrace } from '../margins.js';
import type { CompiledRequirement, PredicateBinding, Trace } from '../../cli/sibling-types.js';
import { tinyLexicon, tinyTrace, tinyTrial } from '../../../test/support/tiny-app.js';
import { tinyReq } from '../../../test/support/outcomes.js';

const height = tinyLexicon.predicates[0] as PredicateBinding['predicate'];
const tilt = tinyLexicon.predicates[1] as PredicateBinding['predicate'];
const bindings: PredicateBinding[] = [
  { predicate: height, slots: { length: 0.4 } },
  { predicate: tilt, slots: { angle: 0.5 } },
];
const spec = { app: 'tiny', reqId: '1.2', scenario: { 'push.force': 200 }, seed: 4 };

describe('signalMargins', () => {
  it('gives one margin per signal in first-appearance order; a single-signal predicate equals the monitor', () => {
    const trace = tinyTrace(spec);
    const ms = signalMargins({ predicates: bindings }, trace) as NonNullable<ReturnType<typeof signalMargins>>;
    expect(ms.map((m) => m.signal)).toEqual(['height', 'tilt']);
    const monitor = tinyReq('1.2').monitor(trace);
    expect(ms[0]?.margin).toBeCloseTo(monitor.robustness, 12);
    expect(ms[0]?.at).toBeCloseTo(monitor.worstAt, 12);
    expect(ms[0]?.unit).toBe('m');
  });

  it('returns undefined without bindings', () => {
    expect(signalMargins({}, tinyTrace(spec))).toBeUndefined();
    expect(signalMargins({ predicates: [] }, tinyTrace(spec))).toBeUndefined();
  });

  it('respects a binding window', () => {
    const trace = tinyTrace(spec);
    const [m] = signalMargins({ predicates: [{ ...bindings[0] as PredicateBinding, window: { t0: 0, t1: 0.21 } }] }, trace) as NonNullable<ReturnType<typeof signalMargins>>;
    expect(m?.at).toBeLessThanOrEqual(0.21);
  });
});

describe('pickLowest', () => {
  it('breaks ties by list order', () => {
    const m = (signal: string, margin: number) => ({ signal, margin, at: 0, unit: 'm' });
    expect(pickLowest([m('a', 1), m('b', -1), m('c', -1)]).signal).toBe('b');
  });
});

describe('explain', () => {
  const req = { predicates: bindings } as Pick<CompiledRequirement, 'predicates'>;
  const trace = tinyTrace(spec);
  const mon = tinyReq('1.2').monitor(trace);

  it('recomputes from predicate bindings when the monitor has no margins map', () => {
    const e = explain(req, trace, mon);
    expect(e.source).toBe('recomputed');
    expect(e.lowest.signal).toBe('height');
    expect(e.others.map((o) => o.signal)).toEqual(['tilt']);
  });

  it('uses the margins map of the monitor result when present', () => {
    const e = explain(req, trace, { ...mon, margins: { tilt: -3, height: 5 } });
    expect(e.source).toBe('monitor');
    expect(e.lowest).toMatchObject({ signal: 'tilt', margin: -3 });
  });

  it('throws a named error when neither exists', () => {
    expect(() => explain({}, trace, mon)).toThrow(MarginsUnavailableError);
    expect(() => explain({}, trace, mon)).toThrow('per-signal margins unavailable: the compiled requirement carries no predicate bindings');
  });
});

describe('summariseTrace and signalStats', () => {
  it('samples at 10 Hz with intervalS 0.1', () => {
    const s = summariseTrace(tinyTrace(spec, 1));
    expect(s.intervalS).toBe(0.1);
    expect(s.samples.length).toBe(11);
    expect(s.truncated).toBe(false);
    expect(s.samples[1]?.t).toBeCloseTo(0.3, 9);
  });

  it('keeps the earliest 200 samples of a long trace and flags truncation', () => {
    const s = summariseTrace(tinyTrace(spec, 40));
    expect(s.samples).toHaveLength(200);
    expect(s.truncated).toBe(true);
  });

  it('reports min, max and the value at the worst moment per signal', () => {
    const { result, trace } = tinyTrial(tinyReq('1.2'), spec);
    const st = signalStats(trace, result.worstAt);
    const h = st.find((x) => x.signal === 'height') as NonNullable<(typeof st)[number]>;
    expect(h.min).toBeCloseTo(result.robustness + 0.4, 12);
    expect(h.atWorst).toBeCloseTo(h.min, 12);
    expect(h.max).toBeGreaterThan(h.min);
  });

  it('handles an empty trace', () => {
    const empty: Trace = { t: new Float64Array(0), signals: {}, events: [] };
    expect(summariseTrace(empty)).toMatchObject({ samples: [], truncated: false });
  });
});
