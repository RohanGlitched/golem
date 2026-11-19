import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateBudget } from './budget.js';

describe('budget properties', () => {
  // Feature: golem-falsify, Property 25: Budget validation and fractions
  it('rejects every invalid budget or fraction pair with an error that names the field', () => {
    const badNum = fc.oneof(
      fc.constant(NaN), fc.constant(Infinity), fc.constant(-Infinity), fc.constant(0),
      fc.double({ max: -1e-9, noNaN: true }),
    );
    fc.assert(
      fc.property(badNum, (x) => {
        expect(() => validateBudget({ maxTrials: x }, 0.4, 0.6)).toThrow(/maxTrials/);
        expect(() => validateBudget({ maxWallMs: x }, 0.4, 0.6)).toThrow(/maxWallMs/);
      }),
      { numRuns: 150 },
    );
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 1e6, noNaN: true }), (x) => {
        fc.pre(!Number.isInteger(x));
        expect(() => validateBudget({ maxTrials: x }, 0.4, 0.6)).toThrow(/maxTrials/);
      }),
      { numRuns: 150 },
    );
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => {
        const run = () => validateBudget({ maxTrials: 10 }, a, b);
        if (a + b > 1 + 1e-12) expect(run).toThrow(/phase1Fraction.*phase2Fraction/);
        else expect(run).not.toThrow();
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(fc.oneof(fc.double({ min: 1.0001, max: 5, noNaN: true }), fc.double({ min: -5, max: -0.0001, noNaN: true })), (f) => {
        expect(() => validateBudget({ maxTrials: 10 }, f, 0)).toThrow(/phase1Fraction/);
        expect(() => validateBudget({ maxTrials: 10 }, 0, f)).toThrow(/phase2Fraction/);
      }),
      { numRuns: 150 },
    );
    expect(() => validateBudget({}, 0.4, 0.6)).toThrow(/maxTrials/);
  });
});
