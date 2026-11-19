import { describe, expect, it } from 'vitest';
import { HALF_HEIGHT, runSuction, type Shape } from './helpers/suctionFixture';

const SHAPES: Shape[] = ['box', 'sphere', 'capsule'];

describe('suction physics (fixture world)', () => {
  it.each(SHAPES)('settles a 20 g %s within 4 mm of the tip', async (shape) => {
    const r = await runSuction({ shape, mass: 0.020, move: 0.0, settle: 0.4 });
    expect(r.finite).toBe(true);
    // design: a candy resting on the face is h - 8 mm from the site: 2 mm box, 4 mm sphere, 0 mm capsule
    expect(r.finalDist).toBeLessThan(0.0045);
    expect(Math.abs(r.finalDist - Math.abs(HALF_HEIGHT[shape] - 0.008))).toBeLessThan(0.0012);
  });

  it.each([
    ['up', [0, 0, 5]], ['down', [0, 0, -5]], ['sideways', [5, 0, 0]], ['diagonal', [3, 0, 4]],
  ] as const)('keeps a 20 g box within 0.01 m of the tip at 0.5 m/s and 5 m/s² (%s)', async (_label, accel) => {
    const r = await runSuction({ shape: 'box', mass: 0.020, accel: [...accel] as [number, number, number], vMax: 0.5, move: 0.5 });
    expect(r.finite).toBe(true);
    expect(r.leftAt).toBe(-1);
    expect(r.maxDist).toBeLessThan(0.01);
    // design margin: at most 4.74 mm at 5 m/s²
    expect(r.maxDist).toBeLessThan(0.0065);
    expect(r.maxForce).toBeLessThanOrEqual(3 + 1e-9);
  });

  it('stays finite with the cup at rest for candies of 5 g to 60 g', async () => {
    for (const mass of [0.005, 0.010, 0.020, 0.040, 0.060]) {
      for (const shape of SHAPES) {
        const r = await runSuction({ shape, mass, move: 0.0, settle: 0.5 });
        expect(r.finite, `${shape} ${mass}`).toBe(true);
        expect(r.maxDist, `${shape} ${mass}`).toBeLessThan(0.01);
        for (const d of r.trace) expect(Number.isFinite(d)).toBe(true);
      }
    }
  });
});
