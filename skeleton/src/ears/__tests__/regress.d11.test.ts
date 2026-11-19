// Regression test for defect 11: horizons ignored the requirement's own window and the delay
// before a phase-timed push starts.
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import type { Trace } from '../types.js';
import { G1_STRIDE, g1Lexicon, push } from './g1Lexicon.js';

const lex = g1Lexicon({ features: ['the payload kit is fitted'] });
// The same push, declaring that it may start up to one stride after the trigger.
const timed = g1Lexicon({ perturbations: [{ ...push, maxOnset: G1_STRIDE }] });
const PUSH = 'the pelvis is pushed with up to 200 N for 0.2 s from behind at any point in its stride';

/** pelvis_z at 100 Hz from t = 2 s; the robot falls at `fallAt` (seconds after 2 s). */
function trace(seconds: number, fallAt: number): Trace {
  const n = Math.round(seconds * 100) + 1;
  const t = new Float64Array(n);
  const z = new Float64Array(n);
  const tilt = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = 2 + i / 100;
    const down = i / 100 >= fallAt;
    z[i] = down ? 0.2 : 0.78;
    tilt[i] = down ? 80 : 0;
  }
  return { t, signals: { pelvis_z: z, tilt_deg: tilt }, events: [{ name: 'trigger', t: 2 }] };
}

describe('defect 11: horizons follow the requirement', () => {
  it.each([
    ['THE golem SHALL stay upright for 3 s', 3],
    ['WHERE the payload kit is fitted, THE golem SHALL stay upright for 3 s', 3],
    ['WHILE walking on a slope of up to 10 deg, THE golem SHALL stay upright for 3 s', 3],
    ['THE golem SHALL stay upright', 10],
    ['THE golem SHALL stay upright within 8 s', 16],
    ['WHILE keep its pelvis above 0.4 m, THE golem SHALL stay upright for 3 s', 10],
  ])('%s has horizon %d s', (line, horizon) => {
    const r = compileRequirement(line, lex);
    expect(r.diagnostics).toEqual([]);
    expect(r.requirement!.horizon).toBeCloseTo(horizon, 12);
  });

  it('adds a declared onset to the event window and horizon', () => {
    const plain = compileRequirement(`WHEN ${PUSH}, THE golem SHALL stay upright for 3 s`, lex).requirement!;
    const late = compileRequirement(`WHEN ${PUSH}, THE golem SHALL stay upright for 3 s`, timed).requirement!;
    expect(plain.horizon).toBeCloseTo(3.2, 12);
    expect(late.horizon).toBeCloseTo(G1_STRIDE + 0.2 + 3, 12);
    // A fall 3.5 s after the trigger is outside the plain window but inside the onset-extended one.
    expect(plain.monitor(trace(4, 3.5)).robustness).toBeGreaterThan(0);
    expect(late.monitor(trace(4, 3.5)).robustness).toBeCloseTo(-0.3, 12);
  });

  it('adds a declared onset to the within deadline and horizon', () => {
    const q = compileRequirement(`WHEN ${PUSH}, THE golem SHALL keep its pelvis above 0.5 m within 2 s`, timed).requirement!;
    expect(q.horizon).toBeCloseTo(G1_STRIDE + 0.2 + 4, 12);
    // Down from 0.5 s to 2.7 s after the trigger: up again before the 2.8 s deadline.
    const t = trace(5, 0.5);
    const z = t.signals['pelvis_z']!;
    for (let i = 0; i < z.length; i++) if (t.t[i]! - 2 >= 2.7) z[i] = 0.78;
    expect(q.monitor(t).robustness).toBeCloseTo(0.28, 12);
  });
});
