// Feature: candy-app, Property 2: Scene structure invariants
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { BOWLS, COLOURS, HAND, Q_HOME, SIM_DT } from '../constants';
import { compileRobot } from './helpers/mujoco';

const { mj, model } = await compileRobot();
afterAll(() => { model.delete(); });

const idOf = (type: string, name: string): number => mj.mj_name2id(model, mj.mjtObj[`mjOBJ_${type.toUpperCase()}`].value, name);
const nameOf = (type: string, i: number): string => mj.mj_id2name(model, mj.mjtObj[`mjOBJ_${type.toUpperCase()}`].value, i);

const BODIES = [
  ...Array.from({ length: 8 }, (_, i) => `link${i}`), 'cup', 'bowl_orange', 'bowl_purple', 'bowl_green', 'hand',
  ...Array.from({ length: 6 }, (_, i) => `candy_${i}`),
];

describe('scene structure properties', () => {
  it('resolves every required name to exactly one object of the right type', () => {
    fc.assert(fc.property(fc.constantFrom(...BODIES), (name) => {
      expect(idOf('body', name)).toBeGreaterThan(0);
      let count = 0;
      for (let i = 0; i < model.nbody; i++) if (nameOf('body', i) === name) count++;
      expect(count).toBe(1);
    }), { numRuns: 100 });
    fc.assert(fc.property(fc.constantFrom('table', 'hand_palm', 'hand_forearm', 'cup_collision'), (name) => {
      expect(idOf('geom', name)).toBeGreaterThanOrEqual(0);
    }), { numRuns: 100 });
    expect(idOf('site', 'tip')).toBeGreaterThanOrEqual(0);
  });

  it('gives each candy a box, sphere or capsule geom of 0.005 to 0.060 kg in the colour of exactly one bowl', () => {
    const bowlRgba = BOWLS.map((b) => {
      const g = idOf('geom', `${b.name}_floor`);
      return Array.from(model.geom_rgba.slice(4 * g, 4 * g + 4)) as number[];
    });
    fc.assert(fc.property(fc.integer({ min: 0, max: 5 }), (i) => {
      const g = idOf('geom', `candy_${i}_geom`);
      const type = model.geom_type[g];
      expect([mj.mjtGeom.mjGEOM_BOX.value, mj.mjtGeom.mjGEOM_SPHERE.value, mj.mjtGeom.mjGEOM_CAPSULE.value]).toContain(type);
      const body = idOf('body', `candy_${i}`);
      expect(model.body_mass[body]).toBeGreaterThanOrEqual(0.005);
      expect(model.body_mass[body]).toBeLessThanOrEqual(0.060);
      expect(model.body_jntnum[body]).toBe(1);
      const rgba = Array.from(model.geom_rgba.slice(4 * g, 4 * g + 4)) as number[];
      const matches = bowlRgba.filter((b) => b.every((v, k) => Math.abs(v - rgba[k]!) < 1e-6));
      expect(matches).toHaveLength(1);
      expect(bowlRgba.indexOf(matches[0]!)).toBe(i % 3);
      expect(rgba.slice(0, 3).map((v) => Number(v.toFixed(2)))).toEqual(COLOURS[i % 3]!.rgba.slice(0, 3));
    }), { numRuns: 100 });
  });

  it('builds the bowls from box and cylinder geoms only', () => {
    const allowed = [mj.mjtGeom.mjGEOM_BOX.value, mj.mjtGeom.mjGEOM_CYLINDER.value];
    fc.assert(fc.property(fc.constantFrom(...BOWLS.map((b) => b.name)), (name) => {
      const body = idOf('body', name);
      expect(model.body_geomnum[body]).toBeGreaterThan(0);
      for (let k = 0; k < model.body_geomnum[body]; k++) {
        expect(allowed).toContain(model.geom_type[model.body_geomadr[body] + k]);
      }
    }), { numRuns: 100 });
  });

  it('has seven arm position actuators, none on the cup, and a 2 ms timestep', () => {
    expect(model.nu).toBe(7);
    fc.assert(fc.property(fc.integer({ min: 0, max: 6 }), (a) => {
      const joint = model.actuator_trnid[2 * a];
      expect(nameOf('joint', joint)).toBe(`joint${a + 1}`);
      expect(model.body_jntnum[idOf('body', 'cup')]).toBe(0);
    }), { numRuns: 100 });
    expect(model.opt.timestep).toBeCloseTo(SIM_DT, 12);
  });

  it('keeps the hand at least 1.0 m from the tip for any arm pose within 0.05 rad of the Home_Pose', () => {
    const data = new mj.MjData(model);
    try {
      const tip = idOf('site', 'tip');
      const hand = idOf('body', 'hand');
      fc.assert(fc.property(fc.array(fc.double({ min: -0.05, max: 0.05, noNaN: true }), { minLength: 7, maxLength: 7 }), (d) => {
        for (let i = 0; i < 7; i++) data.qpos[i] = Q_HOME[i]! + d[i]!;
        mj.mj_forward(model, data);
        const t = data.site_xpos.slice(3 * tip, 3 * tip + 3);
        const h = data.xpos.slice(3 * hand, 3 * hand + 3);
        expect(Math.hypot(h[0] - t[0], h[1] - t[1], h[2] - t[2]) - HAND.palmRadius).toBeGreaterThanOrEqual(1.0);
      }), { numRuns: 100 });
    } finally { data.delete(); }
  });
});
