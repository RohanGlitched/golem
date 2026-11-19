import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deriveSeed, SALT } from './prng.js';
import { verificationSeeds } from './classify.js';

const u32 = fc.integer({ min: 0, max: 2 ** 32 - 1 });

describe('seed derivation properties', () => {
  // Feature: golem-falsify, Property 4: Seed derivation is pure, uint32 and injective per phase
  it('derives pure uint32 seeds that are injective per phase and verification seeds that are distinct', () => {
    fc.assert(
      fc.property(
        u32, fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 2 ** 20 - 1 }), fc.integer({ min: 0, max: 2 ** 20 - 1 }),
        (s, p, i, j) => {
          const a = deriveSeed(s, p, i);
          expect(Number.isInteger(a) && a >= 0 && a < 2 ** 32).toBe(true);
          expect(deriveSeed(s, p, i)).toBe(a);
          if (i !== j) expect(deriveSeed(s, p, j)).not.toBe(a);
        },
      ),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(u32, u32, (s, orig) => {
        const [a, b, c] = verificationSeeds(s, orig);
        expect(new Set([a, b, c, orig]).size).toBe(4);
      }),
      { numRuns: 300 },
    );
    expect(SALT.verification).toBe(3);
  });
});
