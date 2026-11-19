// Feature: candy-app, Property 9: A 20 g candy stays within the engage radius
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runSuction } from './helpers/suctionFixture';

describe('suction hold', () => {
  it('keeps a 20 g candy of any shape within 0.01 m for any move up to 0.5 m/s and 5 m/s�', async () => {
    await fc.assert(fc.asyncProperty(
      fc.constantFrom(...(['box', 'sphere', 'capsule'] as const)),
      fc.double({ min: 0, max: 0.5, noNaN: true }),
      fc.double({ min: 0, max: 5, noNaN: true }),
      fc.double({ min: 0, max: Math.PI, noNaN: true }),
      fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
      async (shape, v, a, polar, azimuth) => {
        const accel: [number, number, number] = [
          a * Math.sin(polar) * Math.cos(azimuth), a * Math.sin(polar) * Math.sin(azimuth), a * Math.cos(polar),
        ];
        const r = await runSuction({ shape, mass: 0.020, accel, vMax: v, move: 0.5 });
        expect(r.finite).toBe(true);
        expect(r.maxDist).toBeLessThan(0.01);
        expect(r.leftAt).toBe(-1);
      },
    ), { numRuns: 8 });
  });
});
