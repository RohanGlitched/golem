import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { latinHypercube } from './lhs.js';
import { arbSpace } from './testing.js';

const u32 = fc.integer({ min: 0, max: 2 ** 32 - 1 });
const gen = fc.integer({ min: 0, max: 1000 });

describe('latin hypercube properties', () => {
  // Feature: golem-falsify, Property 1: LHS stratum coverage
  it('places exactly one sample in each stratum of every non-fixed dimension', () => {
    fc.assert(
      fc.property(arbSpace, fc.integer({ min: 0, max: 200 }), u32, gen, (space, n, seed, g) => {
        const s = latinHypercube(space, n, seed, g);
        expect(s).toHaveLength(n);
        for (const d of space.dims) {
          if (d.min === d.max) {
            for (const x of s) expect(x[d.name]).toBe(d.min);
            continue;
          }
          const width = d.max - d.min;
          const k = s.map((x) => Math.floor((((x[d.name] as number) - d.min) / width) * n)).sort((a, b) => a - b);
          expect(k).toEqual(Array.from({ length: n }, (_, i) => i));
        }
        for (const x of s) expect(Object.keys(x)).toEqual(space.dims.map((d) => d.name));
      }),
      { numRuns: 200 },
    );
  });

  // Feature: golem-falsify, Property 2: Sampling ranges, wrap-aware (LHS part)
  it('keeps values in [min, max] and wrap dimensions in [min, max)', () => {
    fc.assert(
      fc.property(arbSpace, fc.integer({ min: 1, max: 100 }), u32, gen, (space, n, seed, g) => {
        for (const x of latinHypercube(space, n, seed, g)) {
          for (const d of space.dims) {
            const v = x[d.name] as number;
            expect(v).toBeGreaterThanOrEqual(d.min);
            if (d.wrap === true && d.min !== d.max) expect(v).toBeLessThan(d.max);
            else expect(v).toBeLessThanOrEqual(d.max);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: golem-falsify, Property 3: LHS determinism and per-dimension independence
  it('is bit-identical on repeat and a dimension column does not depend on the other dimensions', () => {
    fc.assert(
      fc.property(arbSpace, fc.integer({ min: 0, max: 60 }), u32, gen, fc.nat(5), (space, n, seed, g, pick) => {
        const a = latinHypercube(space, n, seed, g);
        expect(latinHypercube(space, n, seed, g)).toEqual(a);
        const keep = space.dims[pick % space.dims.length]!;
        const alone = latinHypercube({ dims: [keep] }, n, seed, g);
        expect(alone.map((x) => x[keep.name])).toEqual(a.map((x) => x[keep.name]));
        const reversed = latinHypercube({ dims: [...space.dims].reverse() }, n, seed, g);
        expect(reversed.map((x) => x[keep.name])).toEqual(a.map((x) => x[keep.name]));
      }),
      { numRuns: 200 },
    );
  });
});
