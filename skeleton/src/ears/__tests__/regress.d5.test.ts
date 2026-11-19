// Regression test for defect 5: a WHILE requirement silently dropped its "for T" window.
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import type { Trace } from '../types.js';
import { g1Lexicon } from './g1Lexicon.js';

const lex = g1Lexicon();
const STATE = 'WHILE keep its pelvis above 0.4 m, THE golem SHALL track the commanded speed within 0.15 m/s';

/** 0 to 6 s at 100 Hz. The pelvis is high until 2 s; the speed error jumps to 1.5 m/s at 4.5 s. */
function trace(): Trace {
  const n = 601;
  const t = new Float64Array(n);
  const z = new Float64Array(n);
  const v = new Float64Array(n);
  const c = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = i / 100;
    z[i] = t[i]! <= 2 ? 0.78 : 0.3;
    c[i] = 0.5;
    v[i] = t[i]! >= 4.5 ? 2 : 0.5;
  }
  return { t, signals: { pelvis_z: z, forward_speed: v, commanded_speed: c }, events: [] };
}

describe('defect 5: WHILE ... for T', () => {
  it('without a wrapper checks the response only at instants where the state holds', () => {
    const r = compileRequirement(STATE, lex).requirement!.monitor(trace());
    expect(r.robustness).toBeCloseTo(0.1, 12);
  });

  it('with for 3 s requires the response for 3 s after every instant where the state holds', () => {
    const q = compileRequirement(`${STATE} for 3 s`, lex).requirement!;
    const r = q.monitor(trace());
    // At t = 1.5 s the state holds (by 0.38 m) and the next 3 s reach the bad speed at 4.5 s.
    expect(r.robustness).toBeCloseTo(-0.38, 12);
    expect(r.worstAt).toBe(4.5);
    expect(r.unit).toBe('m/s');
  });

  it('with for 2 s passes, because 2 s after the state ends the speed is still good', () => {
    const r = compileRequirement(`${STATE} for 2 s`, lex).requirement!.monitor(trace());
    expect(r.robustness).toBeCloseTo(0.1, 12);
  });

  it('rejects within on a WHILE requirement, at the word within', () => {
    const line = `${STATE} within 3 s`;
    const r = compileRequirement(line, lex);
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics.map((d) => [d.kind, line.slice(d.start, d.end), d.message])).toEqual([
      ['PATTERN_MISMATCH', 'within',
        "A WHILE requirement is checked at every instant where its state holds, so its response takes 'for <duration>' or no time limit, not 'within'"],
    ]);
  });
});
