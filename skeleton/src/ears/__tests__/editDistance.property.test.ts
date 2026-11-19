import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { tokenEditDistance as d } from '../editDistance.js';
import { refKey } from './refEditDistance.js';
import { arbTokenSeq } from './generators.tokens.js';
import { propConfig } from './support.js';

describe('tokenEditDistance metric laws', () => {
  // Feature: golem-ears, Property 16: Token edit distance obeys the metric laws
  // **Validates: Requirements 9.10, 9.11, 13.8**
  it('Feature: golem-ears, Property 16: Token edit distance obeys the metric laws', () => {
    fc.assert(
      fc.property(arbTokenSeq(), arbTokenSeq(), arbTokenSeq(), (a, b, c) => {
        expect(d(a, a)).toBe(0);
        expect(d(a, b)).toBe(d(b, a));
        expect(d(a, b)).toBeGreaterThanOrEqual(0);
        const equal = a.length === b.length && a.every((x, i) => refKey(x) === refKey(b[i]));
        expect(d(a, b) === 0).toBe(equal);
        expect(d(a, c)).toBeLessThanOrEqual(d(a, b) + d(b, c));
        expect(d(a, b)).toBeGreaterThanOrEqual(Math.abs(a.length - b.length));
        expect(d(a, b)).toBeLessThanOrEqual(Math.max(a.length, b.length));
      }),
      propConfig,
    );
  });
});
