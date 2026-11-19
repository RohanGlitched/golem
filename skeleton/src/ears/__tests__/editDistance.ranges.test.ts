import { describe, expect, it } from 'vitest';
import { toWildcardSequence } from '../editDistance.js';
import { tokenize } from '../tokenizer.js';

const toks = (s: string) => tokenize('x ' + s).tokens.slice(1);

describe('toWildcardSequence with range phrases', () => {
  it('collapses `up to <q>` to one range wildcard', () => {
    expect(toWildcardSequence(toks('with up to 200 N for 0.2 s'))).toEqual([
      { word: 'with' }, { wild: 'range' }, { word: 'for' }, { wild: 'duration' },
    ]);
  });

  it('collapses `<q> to <q>` even when the first number has no unit', () => {
    expect(toWildcardSequence(toks('with 150 to 250 N'))).toEqual([{ word: 'with' }, { wild: 'range' }]);
  });

  it('keeps `from` and collapses the direction and the stride phrases', () => {
    expect(toWildcardSequence(toks('from any direction at any point in its stride'))).toEqual([
      { word: 'from' }, { wild: 'direction' }, { word: 'at' }, { wild: 'phase' },
    ]);
    expect(toWildcardSequence(toks('from behind'))).toEqual([{ word: 'from' }, { wild: 'direction' }]);
  });

  it('leaves `any direction` alone when it does not follow `from`', () => {
    expect(toWildcardSequence(toks('push any direction'))).toEqual([
      { word: 'push' }, { word: 'any' }, { word: 'direction' },
    ]);
  });
});
