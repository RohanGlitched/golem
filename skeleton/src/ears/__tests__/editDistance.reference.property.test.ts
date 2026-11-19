import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { tokenEditDistance } from '../editDistance.js';
import { refEditDistance } from './refEditDistance.js';
import { arbTokenSeq } from './generators.tokens.js';
import { propConfig } from './support.js';

describe('tokenEditDistance against the reference', () => {
  // Feature: golem-ears, Property 17: Edit distance matches a reference and handles wildcards
  // **Validates: Requirements 9.1, 9.3, 9.4**
  it('Feature: golem-ears, Property 17: Edit distance matches a reference and handles wildcards', () => {
    fc.assert(
      fc.property(arbTokenSeq(), arbTokenSeq(), (a, b) => {
        expect(tokenEditDistance(a, b)).toBe(refEditDistance(a, b));
      }),
      propConfig,
    );
  });

  it('costs 0 for equal-kind wildcards and 1 for different kinds or word versus wildcard', () => {
    expect(tokenEditDistance([{ wild: 'force' }], [{ wild: 'force' }])).toBe(0);
    expect(tokenEditDistance([{ wild: 'force' }], [{ wild: 'length' }])).toBe(1);
    expect(tokenEditDistance(['push'], [{ wild: 'force' }])).toBe(1);
    expect(tokenEditDistance(['PUSH'], [{ word: 'push' }])).toBe(0);
  });
});
