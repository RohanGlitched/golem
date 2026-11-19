// Regression test for defect 7: WHILE accepted only predicate states.
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import type { Lexicon, Trace } from '../types.js';
import { g1Lexicon, SLOPE_PHRASE, upright } from './g1Lexicon.js';

const lex = g1Lexicon();
const DEG = Math.PI / 180;

function walk(speedError: number, fallAt?: number): Trace {
  const n = 301;
  const t = new Float64Array(n);
  const z = new Float64Array(n);
  const tilt = new Float64Array(n);
  const fs = new Float64Array(n);
  const cs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = 2 + i * 0.01;
    cs[i] = 0.5;
    fs[i] = 0.5 + speedError;
    const down = fallAt !== undefined && t[i]! >= fallAt;
    z[i] = down ? 0.2 : 0.78;
    tilt[i] = down ? 80 : 2;
  }
  return { t, signals: { pelvis_z: z, tilt_deg: tilt, forward_speed: fs, commanded_speed: cs }, events: [{ name: 'trigger', t: 2 }] };
}

describe('defect 7: WHILE with a perturbation state', () => {
  it('compiles a slope state into a searched dimension and a perturbation applied throughout', () => {
    const r = compileRequirement('WHILE walking on a slope of up to 10 deg, THE golem SHALL track the commanded speed within 0.15 m/s', lex);
    expect(r.diagnostics).toEqual([]);
    const q = r.requirement!;
    expect(q.pattern).toBe('state');
    expect(q.space.dims).toEqual([{ name: 'slope.angle', kind: 'angle', min: 0, max: 10 * DEG, severity: 'up' }]);
    expect(q.perturbations).toEqual([{ template: SLOPE_PHRASE, params: { angle: 'slope.angle' } }]);
    expect(q.monitor(walk(0.05)).robustness).toBeCloseTo(0.1, 12);
    expect(q.monitor(walk(0.25)).robustness).toBeCloseTo(-0.1, 12);
  });

  it('monitors the response over the whole trace, with no trigger needed', () => {
    const q = compileRequirement('WHILE walking on a slope of up to 10 deg, THE golem SHALL stay upright', lex).requirement!;
    const noTrigger = { ...walk(0), events: [] };
    expect(q.monitor(noTrigger).robustness).toBeCloseTo(0.28, 12);
    expect(q.monitor(walk(0, 4)).robustness).toBeCloseTo(-0.3, 12);
    expect(q.monitor(walk(0, 4)).worstAt).toBeCloseTo(4, 12);
  });

  it('reports a state that matches both a predicate and a perturbation as ambiguous', () => {
    const both: Lexicon = g1Lexicon({ predicates: [upright, { ...upright, phrase: SLOPE_PHRASE }] });
    const r = compileRequirement('WHILE walking on a slope of up to 10 deg, THE golem SHALL stay upright', both);
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      `Ambiguous state 'walking on a slope of up to 10 deg' matches the predicate "${SLOPE_PHRASE}" and the perturbation "${SLOPE_PHRASE}".`,
    ]);
  });

  it('reports the class that matched further when neither matches', () => {
    const r = compileRequirement('WHILE walking on a hill, THE golem SHALL stay upright', lex);
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      `'hill' does not continue any perturbation phrase. Did you mean "${SLOPE_PHRASE}"?`,
    ]);
  });

  it('still compiles a predicate state as a predicate state', () => {
    const r = compileRequirement('WHILE keep its pelvis above 0.4 m, THE golem SHALL stay upright', lex);
    expect(r.diagnostics).toEqual([]);
    expect(r.requirement!.perturbations).toEqual([]);
    expect(r.requirement!.space.dims).toEqual([]);
  });
});
