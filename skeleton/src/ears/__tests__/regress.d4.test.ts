// Regression test for defect 4: "within T" passed a robot that was upright at the trigger and
// then fell, and worstAt reported the best sample.
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import type { Trace } from '../types.js';
import { g1Lexicon } from './g1Lexicon.js';

const lex = g1Lexicon();
const LINE = 'IF the pelvis is pushed with up to 300 N for 0.1 s from behind at any point in its stride, THEN THE robot SHALL keep its pelvis above 50 cm within 6 s';

/** pelvis_z sampled at 50 Hz from t = 2 s (the trigger) for `seconds`, from a height profile (at most 1000 samples). */
function trace(seconds: number, z: (t: number) => number): Trace {
  const n = Math.round(seconds * 50) + 1;
  const t = new Float64Array(n);
  const pz = new Float64Array(n);
  for (let i = 0; i < n; i++) { t[i] = 2 + i / 50; pz[i] = z(t[i]!); }
  return { t, signals: { pelvis_z: pz }, events: [{ name: 'trigger', t: 2 }] };
}

describe('defect 4: within T means reach by T, then hold to the end', () => {
  const q = compileRequirement(LINE, lex).requirement!;

  it('fails a robot that is up at the trigger and falls for good', () => {
    const r = q.monitor(trace(12.1, (t) => (t < 2.5 ? 0.78 : 0.1)));
    expect(r.robustness).toBeCloseTo(-0.4, 12);
    expect(r.worstAt).toBeCloseTo(14.1, 9); // the last violation is the last sample
    expect(r.unit).toBe('m');
  });

  it('passes a robot that falls, gets up within 6 s and stays up', () => {
    const r = q.monitor(trace(12.1, (t) => (t >= 2.5 && t < 5 ? 0.1 : 0.78)));
    expect(r.robustness).toBeCloseTo(0.28, 12);
    expect(r.worstAt).toBeCloseTo(4.98, 9); // recovered after its last violation at 4.98 s
  });

  it('fails a robot that gets up too late', () => {
    const r = q.monitor(trace(12.1, (t) => (t >= 2.5 && t < 9 ? 0.1 : 0.78)));
    expect(r.robustness).toBeCloseTo(-0.4, 12);
    expect(r.worstAt).toBeCloseTo(8.98, 9);
  });

  it('fails a robot that recovers and falls again after the deadline', () => {
    const r = q.monitor(trace(12.1, (t) => (t >= 3 && t < 4 ? 0.1 : t >= 11 ? 0.3 : 0.78)));
    expect(r.robustness).toBeCloseTo(-0.2, 12);
    expect(r.worstAt).toBeCloseTo(14.1, 9);
  });

  it('reports the closest approach after the deadline when nothing was violated', () => {
    const r = q.monitor(trace(12.1, (t) => (Math.abs(t - 10) < 0.005 ? 0.6 : 0.78)));
    expect(r.robustness).toBeCloseTo(0.1, 12);
    expect(r.worstAt).toBeCloseTo(10, 9);
  });

  it('gives the trace room to show the hold: horizon is trigger duration plus 2T', () => {
    expect(q.horizon).toBeCloseTo(12.1, 12);
  });

  it('still returns NaN for a trace without a trigger', () => {
    expect(q.monitor({ ...trace(1, () => 1), events: [] })).toEqual({ robustness: NaN, worstAt: 0, unit: 'trace' });
  });
});
