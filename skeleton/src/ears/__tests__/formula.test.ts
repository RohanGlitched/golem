// Improvement 1 of golem-ears-hardening: every CompiledRequirement states its STL formula.
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import { G1_STRIDE, g1Lexicon, push } from './g1Lexicon.js';

const lex = g1Lexicon({ features: ['the payload kit is fitted'] });
const PUSH = 'the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride';
const formula = (line: string, l = lex, opts = {}) => {
  const r = compileRequirement(line, l, opts);
  expect(r.diagnostics).toEqual([]);
  return (r.requirement as unknown as { formula: string }).formula;
};

describe('CompiledRequirement.formula', () => {
  it.each([
    [`WHEN ${PUSH}, THE golem SHALL stay upright for 3 s`,
      'G[t₀, t₀+3 s] margin("stay upright") > 0 m'],
    [`WHEN ${PUSH}, THE golem SHALL stay upright`,
      'G[t₀, t_end] margin("stay upright") > 0 m'],
    ['IF the pelvis is pushed with 150 to 250 N for 0.1 s from behind at 62% of its stride, THEN THE robot SHALL keep its pelvis above 50 cm within 6 s',
      'F[t₀, t₀+6 s] G[·, t_end] margin("keep its pelvis above 50 cm") > 0 m'],
    ['THE golem SHALL track the commanded speed within 15 cm/s',
      'G[t_start, t_end] margin("track the commanded speed within 15 cm/s") > 0 m/s'],
    ['THE golem SHALL stay upright for 3 s',
      'G[t_start, t_start+3 s] margin("stay upright") > 0 m'],
    ['THE golem SHALL stay upright within 2.5 s',
      'F[t_start, t_start+2.5 s] G[·, t_end] margin("stay upright") > 0 m'],
    ['WHILE keep its pelvis above 0.4 m, THE golem SHALL stay upright',
      'G[t_start, t_end] (margin("keep its pelvis above 0.4 m") > 0 m → margin("stay upright") > 0 m)'],
    ['WHILE keep its pelvis above 0.4 m, THE golem SHALL stay upright for 3 s',
      'G[t_start, t_end] (margin("keep its pelvis above 0.4 m") > 0 m → G[t, t+3 s] margin("stay upright") > 0 m)'],
    ['WHILE walking on a slope of up to 10 deg, THE golem SHALL stay upright for 3 s',
      'G[t_start, t_start+3 s] margin("stay upright") > 0 m, with "walking on a slope of up to 10 deg" applied throughout'],
    ['WHERE the payload kit is fitted, THE golem SHALL stay upright',
      'true (feature "the payload kit is fitted" is not enabled)'],
  ])('%s', (line, want) => {
    expect(formula(line)).toBe(want);
  });

  it('prints an enabled feature as the response formula', () => {
    expect(formula('WHERE the payload kit is fitted, THE golem SHALL stay upright', lex, { enabledFeatures: ['the payload kit is fitted'] }))
      .toBe('G[t_start, t_end] margin("stay upright") > 0 m');
  });

  it('adds the trigger onset to the window', () => {
    const timed = g1Lexicon({ perturbations: [{ ...push, maxOnset: G1_STRIDE }] });
    expect(formula(`WHEN ${PUSH}, THE golem SHALL stay upright for 3 s`, timed)).toBe('G[t₀, t₀+3.8 s] margin("stay upright") > 0 m');
  });
});
