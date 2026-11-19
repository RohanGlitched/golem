import { describe, expect, it } from 'vitest';
import { closestTemplate, toWildcardSequence } from '../editDistance.js';
import { tokenize } from '../tokenizer.js';
import type { CompiledTemplate } from '../types.js';

const toks = (s: string) => tokenize(s).tokens;
const tpl = (index: number, phrase: string, pattern: CompiledTemplate['pattern']): CompiledTemplate => ({
  phrase,
  pattern,
  index,
});

describe('toWildcardSequence', () => {
  it('counts a number with its unit as one token', () => {
    expect(toWildcardSequence(toks('pushed with 200 N for 0.2 s'))).toEqual([
      { word: 'pushed' },
      { word: 'with' },
      { wild: 'force' },
      { word: 'for' },
      { wild: 'duration' },
    ]);
  });

  it('collapses a bare count and a bare ratio to their kinds', () => {
    expect(toWildcardSequence(toks('sort 3 candies at 0.5'))).toEqual([
      { word: 'sort' },
      { wild: 'count' },
      { word: 'candies' },
      { word: 'at' },
      { wild: 'ratio' },
    ]);
  });

  it('folds word case', () => {
    expect(toWildcardSequence(toks('Stay UPRIGHT'))).toEqual([{ word: 'stay' }, { word: 'upright' }]);
  });
});

describe('closestTemplate', () => {
  const stay = tpl(0, 'stay upright', ['stay', 'upright']);
  const push = tpl(1, 'pushed with {force}', ['pushed', 'with', { slot: 'force', name: 'f' }]);

  it('matches a quantity against a slot of the same kind at distance 0', () => {
    const r = closestTemplate(toks('pushed with 200 N'), [stay, push]);
    expect(r.template).toBe(push);
    expect(r.distance).toBe(0);
    expect(r.tooFar).toBe(false);
  });

  it('picks the first template on a tie', () => {
    const a = tpl(0, 'stay upright', ['stay', 'upright']);
    const b = tpl(1, 'stay uptight', ['stay', 'uptight']);
    const r = closestTemplate(toks('stay up'), [a, b]);
    expect(r.distance).toBe(1);
    expect(r.template).toBe(a);
  });

  it('flags tooFar and still reports distance when no template is close', () => {
    const r = closestTemplate(toks('dance wildly tonight now'), [stay]);
    expect(r.distance).toBe(4);
    expect(r.tooFar).toBe(true);
  });

  it('is not tooFar when distance equals half the longer length', () => {
    const r = closestTemplate(toks('stay up'), [stay]);
    expect(r.distance).toBe(1);
    expect(r.tooFar).toBe(false);
  });

  it('returns no template for an empty class', () => {
    const r = closestTemplate(toks('stay upright'), []);
    expect(r.template).toBeUndefined();
    expect(r.tooFar).toBe(true);
  });
});
