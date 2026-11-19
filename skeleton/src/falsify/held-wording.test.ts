import { describe, expect, it } from 'vitest';
import { heldWording } from './held-wording.js';

describe('heldWording', () => {
  it('says the bound is from the uniformly random trials, with both counts', () => {
    expect(heldWording(24, 2, '75 %'))
      .toBe('no counterexample in 24 trials; from the 2 uniformly random ones, failure rate below 75 % (95 % confidence)');
  });
  it('uses the singular for one random trial', () => {
    expect(heldWording(5, 1, '100 %')).toContain('from the 1 uniformly random one, failure rate');
  });
  it('leaves the bound out when there is none', () => {
    expect(heldWording(24, 0)).toBe('no counterexample in 24 trials');
  });
});
