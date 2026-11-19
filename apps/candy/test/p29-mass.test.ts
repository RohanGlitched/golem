// Feature: candy-app, Property 29: Candy mass is set and restored
import fc from 'fast-check';
import { ModelCache, buildContext, compileRequirement, runTrial } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import candy from '../app';
import { CANDY_MASS_RANGE } from '../constants';
import { CANDY_NAMES, candyIds } from '../controller/ids';
import { lexicon } from '../lexicon';
import { candiesWeigh } from '../perturbations';
import { compileRobot } from './helpers/mujoco';

const LINE = 'R1. WHEN the candies weigh 0.005 kg to 0.060 kg THE arm SHALL not drop a candy outside the bowls for 1 s';
const cache = new ModelCache();
afterAll(() => { cache.dispose(); });

describe('candy mass', () => {
  it('sets every candy to the given mass, scales the inertia by the same factor, and equals one application when applied twice', async () => {
    const { mj, model } = await compileRobot();
    const data = new mj.MjData(model);
    const ctx = buildContext(mj, model, data, CANDY_NAMES as never);
    const ids = candyIds(ctx);
    const mass0 = Float64Array.from(model.body_mass), inertia0 = Float64Array.from(model.body_inertia);
    try {
      fc.assert(fc.property(fc.double({ min: CANDY_MASS_RANGE.min, max: CANDY_MASS_RANGE.max, noNaN: true }), (m) => {
        candiesWeigh.begin!(ctx, { mass: m });
        const once = { mass: Float64Array.from(model.body_mass), inertia: Float64Array.from(model.body_inertia) };
        for (let i = 0; i < 6; i++) {
          const b = ids.candyBody[i]!;
          expect(model.body_mass[b]).toBe(m);
          for (let k = 0; k < 3; k++) expect(model.body_inertia[3 * b + k]).toBeCloseTo(inertia0[3 * b + k]! * (m / mass0[b]!), 12);
        }
        candiesWeigh.begin!(ctx, { mass: m });
        expect(Array.from(model.body_mass).map((v, i) => Object.is(v, once.mass[i]))).not.toContain(false);
        expect(Array.from(model.body_inertia as Float64Array).map((v, i) => Math.abs(v - once.inertia[i]!) <= 1e-18 + 1e-12 * Math.abs(v))).not.toContain(false);
        model.body_mass.set(mass0); model.body_inertia.set(inertia0);
      }), { numRuns: 100 });
    } finally { data.delete(); model.delete(); }
  });

  it('gives candies the mass during a trial and leaves body_mass and body_inertia bit-identical afterwards', async () => {
    const req = compileRequirement(LINE, lexicon).requirement!;
    await runTrial(candy, req, { app: 'candy', reqId: 'R1', seed: 1, scenario: { 'candy.mass': 0.02 } }, { cache });
    const { model } = await cache.getModel(candy as never);
    const before = { mass: Float64Array.from(model.body_mass), inertia: Float64Array.from(model.body_inertia) };
    let seen: number[] = [];
    const spy = {
      ...candy,
      endTrial: (ctx: any) => {
        const ids = candyIds(ctx);
        seen = Array.from({ length: 6 }, (_, i) => ctx.model.body_mass[ids.candyBody[i]!]);
        candy.endTrial!(ctx);
      },
    };
    await fc.assert(fc.asyncProperty(fc.double({ min: CANDY_MASS_RANGE.min, max: CANDY_MASS_RANGE.max, noNaN: true }), async (m) => {
      await runTrial(spy as never, req, { app: 'candy', reqId: 'R1', seed: 5, scenario: { 'candy.mass': m } }, { cache });
      expect(seen).toEqual([m, m, m, m, m, m]);
      expect(Array.from(model.body_mass).map((v, i) => Object.is(v, before.mass[i]))).not.toContain(false);
      expect(Array.from(model.body_inertia).map((v, i) => Object.is(v, before.inertia[i]))).not.toContain(false);
    }), { numRuns: 8 });
  });
});
