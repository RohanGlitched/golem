// Regression test for defect 9: suggestions repeated the template the user already wrote, and a
// gait phase could not be pinned to a fixed value.
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import { g1Lexicon, PUSH_PHRASE } from './g1Lexicon.js';

const lex = g1Lexicon();
const line = (trigger: string) => `WHEN ${trigger}, THE golem SHALL stay upright for 3 s`;

describe('defect 9: slot-aware suggestions', () => {
  it('names the slot, its accepted forms, and suggests a rewrite that compiles', () => {
    const text = line('the pelvis is pushed with up to 200 N for 0.2 s from the left at any point in its stride');
    const r = compileRequirement(text, lex);
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics).toHaveLength(1);
    const d = r.diagnostics[0]!;
    expect(d.kind).toBe('UNKNOWN_PHRASE');
    expect(text.slice(d.start, d.end)).toBe('the left');
    expect(d.message).toBe(
      `'the left' is not accepted by {direction} in "${PUSH_PHRASE}". It accepts any direction, behind, or an angle such as 90 deg.`,
    );
    expect(d.suggestion).toBe('the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride');
    expect(compileRequirement(line(d.suggestion!), lex).diagnostics).toEqual([]);
  });

  it('suggests a quantity for a quantity slot that got words', () => {
    const text = line('the pelvis is pushed with up to 200 N for a moment from behind at any point in its stride');
    const d = compileRequirement(text, lex).diagnostics[0]!;
    expect(text.slice(d.start, d.end)).toBe('a moment');
    expect(d.message).toBe(
      `'a moment' is not accepted by {duration} in "${PUSH_PHRASE}". It accepts a number with a duration unit (s, ms), such as 0.2 s.`,
    );
    expect(compileRequirement(line(d.suggestion!), lex).diagnostics).toEqual([]);
  });

  it('keeps "Did you mean" for a misspelt literal word', () => {
    const r = compileRequirement('THE golem SHALL stay uprigth', lex);
    expect(r.diagnostics[0]!.message).toBe(`'uprigth' does not continue any predicate phrase. Did you mean "stay upright"?`);
    expect(r.diagnostics[0]!.suggestion).toBe('stay upright');
  });
});

describe('defect 9: a fixed gait phase', () => {
  it.each([
    ['at 50%', 0.5],
    ['at 62% of its stride', 0.62],
    ['at 62% into its stride', 0.62],
    ['at 0%', 0],
    ['at 100%', 1],
  ])('binds %s as a fixed phase', (phase, value) => {
    const r = compileRequirement(line(`the pelvis is pushed with up to 200 N for 0.2 s from behind ${phase}`), lex);
    expect(r.diagnostics).toEqual([]);
    const q = r.requirement!;
    expect(q.perturbations[0]!.params['phase']).toBeCloseTo(value, 12);
    const dim = q.space.dims.find((d) => d.name === 'push.phase')!;
    expect(dim.min).toBe(dim.max);
    expect(dim.min).toBeCloseTo(value, 12);
  });

  it('rejects a phase outside 0% to 100%', () => {
    const text = line('the pelvis is pushed with up to 200 N for 0.2 s from behind at 120%');
    const r = compileRequirement(text, lex);
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics.map((d) => [d.kind, text.slice(d.start, d.end), d.message])).toEqual([
      ['BAD_RANGE', '120%', "A phase must be from 0% to 100% of the stride, found '120%'"],
    ]);
  });
});
