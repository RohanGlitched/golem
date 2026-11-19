import { describe, expect, it } from 'vitest';
import { tokenEditDistance } from '../editDistance.js';

describe('tokenEditDistance', () => {
  it('returns 0 for identical sequences', () => {
    expect(tokenEditDistance(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0);
    expect(tokenEditDistance([], [])).toBe(0);
  });

  it('costs 1 for one insertion or deletion', () => {
    expect(tokenEditDistance(['a', 'c'], ['a', 'b', 'c'])).toBe(1);
    expect(tokenEditDistance(['a', 'b', 'c'], ['a', 'c'])).toBe(1);
  });

  it('costs the sequence length against an empty sequence', () => {
    expect(tokenEditDistance([], ['a', 'b', 'c'])).toBe(3);
  });

  it('costs 1 for one substitution', () => {
    expect(tokenEditDistance(['a', 'b', 'c'], ['a', 'x', 'c'])).toBe(1);
  });

  it('compares words without regard to case', () => {
    expect(tokenEditDistance(['Keep', 'UPRIGHT'], ['keep', 'upright'])).toBe(0);
    expect(tokenEditDistance([{ word: 'Keep' }], ['kEEp'])).toBe(0);
  });

  it('gives cost 0 to wildcards of equal kind', () => {
    expect(tokenEditDistance(['push', { wild: 'force' }], ['push', { wild: 'force' }])).toBe(0);
  });

  it('gives cost 1 to wildcards of different kinds', () => {
    expect(tokenEditDistance([{ wild: 'force' }], [{ wild: 'duration' }])).toBe(1);
  });

  it('gives cost 1 to a wildcard against a word', () => {
    expect(tokenEditDistance([{ wild: 'force' }], ['force'])).toBe(1);
  });
});
