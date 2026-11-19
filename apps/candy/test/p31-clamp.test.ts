// Feature: candy-app, Property 31: Out-of-range scenario values are clamped
import fc from 'fast-check';
import { buildContext } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import { CANDY_MASS_RANGE, CANDY_SPAWN, HAND_HEIGHT_RANGE, MAX_TRACKER_LAG, UD } from '../constants';
import { CANDY_NAMES, candyIds } from '../controller/ids';
import { candiesLand, candiesWeigh, handReaches, trackerLags, vacuumWeakens } from '../perturbations';
import { compileRobot } from './helpers/mujoco';

const { mj, model } = await compileRobot();
const data = new mj.MjData(model);
const ctx = buildContext(mj, model, data, CANDY_NAMES as never);
const ids = candyIds(ctx);
const mass0 = Float64Array.from({ length: 6 }, (_, i) => model.body_mass[ids.candyBody[i]!]);
const inertia0 = Float64Array.from(model.body_inertia);
afterAll(() => { data.delete(); model.delete(); });

/** Values far outside any range, but never NaN. */
const wild = fc.double({ min: -1e6, max: 1e6, noNaN: true });
const restore = () => {
  for (let i = 0; i < 6; i++) model.body_mass[ids.candyBody[i]!] = mass0[i]!;
  model.body_inertia.set(inertia0);
  const scratch = new mj.MjData(model);
  mj.mj_setConst(model, scratch);
  scratch.delete();
};

describe('clamping', () => {
  it('keeps the hand pose finite and its height inside [0.05, 0.25] m for any value, without throwing', () => {
    fc.assert(fc.property(wild, wild, wild, wild, fc.double({ min: 0, max: 100, noNaN: true }), (angle, speed, entry, height, t) => {
      expect(() => handReaches.apply(ctx, t, 1.0, { angle, speed, entry, height })).not.toThrow();
      const m = ids.handMocap;
      const pos = Array.from((data.mocap_pos as Float64Array).slice(3 * m, 3 * m + 3));
      for (const v of pos) expect(Number.isFinite(v)).toBe(true);
      if (t - 1.0 - Math.max(0, entry) >= 0) {
        expect(pos[2]).toBeGreaterThanOrEqual(HAND_HEIGHT_RANGE.min);
        expect(pos[2]).toBeLessThanOrEqual(HAND_HEIGHT_RANGE.max);
      }
    }), { numRuns: 300 });
  });

  it('clamps the candy mass into [0.005, 0.060] kg, the lag into [0, 0.3] s and the placement into the spawn box', () => {
    fc.assert(fc.property(wild, wild, (mass, lag) => {
      expect(() => candiesWeigh.begin!(ctx, { mass })).not.toThrow();
      for (let i = 0; i < 6; i++) {
        const m = model.body_mass[ids.candyBody[i]!];
        expect(m).toBeGreaterThanOrEqual(CANDY_MASS_RANGE.min - 1e-12);
        expect(m).toBeLessThanOrEqual(CANDY_MASS_RANGE.max + 1e-12);
      }
      restore();
      expect(() => trackerLags.begin!(ctx, { lag })).not.toThrow();
      expect(data.userdata[UD.lag]).toBeGreaterThanOrEqual(0);
      expect(data.userdata[UD.lag]).toBeLessThanOrEqual(MAX_TRACKER_LAG);
    }), { numRuns: 100 });
    fc.assert(fc.property(fc.array(wild, { minLength: 12, maxLength: 12 }), (v) => {
      const values: Record<string, number> = {};
      for (let i = 0; i < 6; i++) { values[`candy.${i}.x`] = v[2 * i]!; values[`candy.${i}.y`] = v[2 * i + 1]!; }
      expect(() => candiesLand.begin!(ctx, values)).not.toThrow();
      for (let i = 0; i < 6; i++) {
        const x = data.qpos[ids.candyQpos[i]!], y = data.qpos[ids.candyQpos[i]! + 1];
        expect(x).toBeGreaterThanOrEqual(CANDY_SPAWN.xMin);
        expect(x).toBeLessThanOrEqual(CANDY_SPAWN.xMax + 5 * 0.04 + 1e-9);   // the overlap rule shifts by at most 0.04 m per earlier candy
        expect(Math.abs(y!)).toBeLessThanOrEqual(CANDY_SPAWN.yMax + 1e-12);
      }
    }), { numRuns: 100 });
  });

  it('passes a vacuum ratio outside [0, 1] on to the suction model, which clamps it and warns', () => {
    fc.assert(fc.property(wild, (ratio) => {
      expect(() => vacuumWeakens.begin!(ctx, { ratio })).not.toThrow();
      expect(data.userdata[UD.vacuum]).toBe(ratio);
    }), { numRuns: 100 });
    vacuumWeakens.begin!(ctx, { ratio: 1 });
  });

  it('never throws for a NaN value either', () => {
    expect(() => handReaches.apply(ctx, 5, 1, { angle: NaN, speed: NaN, entry: NaN, height: NaN })).not.toThrow();
    expect(() => candiesWeigh.begin!(ctx, { mass: NaN })).not.toThrow();
    restore();
    expect(() => trackerLags.begin!(ctx, { lag: NaN })).not.toThrow();
  });
});
