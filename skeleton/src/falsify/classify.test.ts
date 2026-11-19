import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classify, verificationSeeds } from './classify.js';
import { deriveSeed, SALT } from './prng.js';

describe('classify', () => {
  it('is robust when all three trials fail', () => {
    expect(classify([-1, -0.1, -5])).toBe('robust');
  });
  it('is seed-sensitive when one trial is non-negative', () => {
    expect(classify([-1, 0.2, -5])).toBe('seed-sensitive');
  });
  it('treats exactly zero as not failing', () => {
    expect(classify([-1, 0, -1])).toBe('seed-sensitive');
  });
  it('is undefined when any trial errored, even if another trial passed', () => {
    expect(classify([-1, null, -1])).toBeUndefined();
    expect(classify([1, null, -1])).toBeUndefined();
    expect(classify([-1, NaN, -1])).toBeUndefined();
  });
});

describe('verificationSeeds', () => {
  it('skips the original seed when it is a candidate', () => {
    const c0 = deriveSeed(5, SALT.verification, 0);
    const c1 = deriveSeed(5, SALT.verification, 1);
    const c2 = deriveSeed(5, SALT.verification, 2);
    const c3 = deriveSeed(5, SALT.verification, 3);
    expect(verificationSeeds(5, c1)).toEqual([c0, c2, c3]);
    expect(verificationSeeds(5, 12345)).toEqual([c0, c1, c2]);
  });
  it('is deterministic', () => {
    expect(verificationSeeds(9, 1)).toEqual(verificationSeeds(9, 1));
  });
});

describe('classification property', () => {
  // Feature: golem-falsify, Property 15: Classification rule
  it('robust iff all three are below zero, seed-sensitive iff all present and one is >= 0, else unset', () => {
    const outcome = fc.oneof(fc.double({ min: -5, max: 5, noNaN: true }), fc.constant(0), fc.constant(null));
    fc.assert(
      fc.property(fc.tuple(outcome, outcome, outcome), (t) => {
        const c = classify(t);
        if (t.some((x) => x === null)) expect(c).toBeUndefined();
        else if ((t as number[]).every((x) => x < 0)) expect(c).toBe('robust');
        else expect(c).toBe('seed-sensitive');
      }),
      { numRuns: 300 },
    );
  });
});
