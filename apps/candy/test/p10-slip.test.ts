// Feature: candy-app, Property 10: Candies above the carry mass slip
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runSuction } from './helpers/suctionFixture';

const G = 9.81;

describe('suction slip', () => {
  it('lets a candy above 1.05 times the carry mass leave the radius within 0.5 s, with the force at the cap', async () => {
    await fc.assert(fc.asyncProperty(
      fc.constantFrom(...(['box', 'sphere', 'capsule'] as const)),
      fc.double({ min: 0.5, max: 1, noNaN: true }),
      fc.double({ min: 0.5, max: 5, noNaN: true }),
      fc.double({ min: 0, max: 1, noNaN: true }),
      async (shape, vr, a, u) => {
        const carry = (3 * vr) / (G + a);
        const mass = carry * 1.05 + u * 0.15;
        const r = await runSuction({ shape, mass, vacuum: vr, accel: [0, 0, a], vMax: 2, move: 0.5 });
        expect(r.finite).toBe(true);
        expect(r.leftAt, `mass ${mass} kg`).toBeGreaterThanOrEqual(0);
        // the applied force reaches the cap 3 N * ratio and never goes above it
        expect(r.maxForce).toBeLessThanOrEqual(3 * vr + 1e-9);
        expect(r.maxForce).toBeGreaterThan(3 * vr - 1e-9);
      },
    ), { numRuns: 8 });
  });
});
