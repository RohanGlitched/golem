// Feature: candy-app, Property 37: A candy released into a bowl stays in it (proposal P9)
//
// golem test found candies that left the bowls after a release from 0.097 m. Two scene defects caused it:
//   1. the 10 mm bowl floor was a free cylinder on the Table, and the soft contact let a candy at about 1.2 m/s sink through it
//      into the gap above the Table, where it rested at z = 0 (the floor now reaches 0.02 m into the Table);
//   2. a box that left the cup with a little spin hit the floor on a corner, and the elastic contact (damping ratio 1) threw it out
//      over the 0.05 m wall at 1 to 2 m/s with up to 100 rad/s of spin (the bowl geoms now have a damping ratio of 4: an inelastic landing).
// These tests drop each candy into each bowl at the release state and need only 1 s of simulated time.
import fc from 'fast-check';
import { buildContext } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import { BOWL, BOWLS, CANDY_HALF_HEIGHT, SIM_DT } from '../constants';
import { CANDY_NAMES, candyIds } from '../controller/ids';
import { bowlAt } from '../geometry';
import { compileRobot } from './helpers/mujoco';

const { mj, model } = await compileRobot();
const data = new mj.MjData(model);
const ctx = buildContext(mj, model, data, CANDY_NAMES as never);
const ids = candyIds(ctx);
afterAll(() => { data.delete(); model.delete(); });

/** Unit quaternion (w, x, y, z) of a rotation about x by rx, then about y by ry, then about z by rz. */
function quat(rx: number, ry: number, rz: number): number[] {
  const cx = Math.cos(rx / 2), sx = Math.sin(rx / 2), cy = Math.cos(ry / 2), sy = Math.sin(ry / 2), cz = Math.cos(rz / 2), sz = Math.sin(rz / 2);
  return [cz * cy * cx + sz * sy * sx, cz * cy * sx - sz * sy * cx, cz * sy * cx + sz * cy * sx, sz * cy * cx - cz * sy * sx];
}

interface Drop { i: number; bowl: number; dx: number; dy: number; z0: number; vz: number; tiltX?: number; tiltY?: number; yaw?: number; spin?: number }

/** Drops candy i over a bowl with the given state, then runs 1 s. Returns its final pose and its highest z after the impact. */
function drop(d: Drop): { z: number; x: number; y: number; maxZ: number } {
  mj.mj_resetData(model, data);
  const q: Float64Array = data.qpos, v: Float64Array = data.qvel;
  // park the other candies far away on the floor
  for (let k = 0; k < 6; k++) {
    const a = ids.candyQpos[k]!;
    q[a] = -0.6 - 0.05 * k; q[a + 1] = 0.9; q[a + 2] = -0.38; q[a + 3] = 1; q[a + 4] = 0; q[a + 5] = 0; q[a + 6] = 0;
  }
  const a = ids.candyQpos[d.i]!, dof = ids.candyDof[d.i]!;
  const b = BOWLS[d.bowl]!;
  q[a] = b.x + d.dx; q[a + 1] = b.y + d.dy; q[a + 2] = d.z0;
  const qq = quat(d.tiltX ?? 0, d.tiltY ?? 0, d.yaw ?? 0);
  q[a + 3] = qq[0]!; q[a + 4] = qq[1]!; q[a + 5] = qq[2]!; q[a + 6] = qq[3]!;
  v[dof + 2] = -d.vz; v[dof + 4] = d.spin ?? 0;
  mj.mj_forward(model, data);
  let maxZ = -Infinity;
  const afterImpact = Math.round(0.1 / SIM_DT);
  for (let s = 0; s < Math.round(1 / SIM_DT); s++) {
    mj.mj_step(model, data);
    if (s > afterImpact && q[a + 2]! > maxZ) maxZ = q[a + 2]!;
  }
  return { z: q[a + 2]!, x: q[a]!, y: q[a + 1]!, maxZ };
}

describe('bowl floor', () => {
  it('reaches below the Table surface and keeps its top at 0.010 m', () => {
    for (const b of BOWLS) {
      const g = mj.mj_name2id(model, mj.mjtObj.mjOBJ_GEOM.value, `${b.name}_floor`);
      const half = model.geom_size[3 * g + 1]!, centre = model.geom_pos[3 * g + 2]!;
      expect(centre + half).toBeCloseTo(2 * BOWL.floorHalfHeight, 12);
      expect(centre - half).toBeCloseTo(-BOWL.floorSink, 12);
    }
  });

  it('rests every candy in every bowl after a drop at the release speed (1.2 m/s) and at 2 m/s, above z = 0.010 m and not inside the floor', () => {
    // With the first scene a capsule sank to z = -0.003 m at 2 m/s, and a box released at 1.2 m/s ended at z = 0.
    for (const vz of [1.2, 2.0]) for (const i of [0, 1, 2, 3, 4, 5]) for (let bowl = 0; bowl < 3; bowl++) {
      const r = drop({ i, bowl, dx: 0.02, dy: -0.01, z0: 0.097, vz });
      expect(r.z, `candy ${i}, bowl ${bowl}, ${vz} m/s`).toBeGreaterThan(0.010 + 0.5 * CANDY_HALF_HEIGHT[i]!);
      expect(bowlAt(r.x, r.y, r.z)).toBe(bowl);
    }
  });

  it('replays the exact release state of seed 1117610652 (line 4.1): a box with 1.3 rad/s of spin does not bounce out', () => {
    // at the instant the cup lets go, as recorded by golem replay: tilt about y of 0.12 rad, yaw 0.31 rad, falling at 1 m/s
    const r = drop({ i: 0, bowl: 2, dx: -0.003, dy: 0, z0: 0.047, vz: 0.997, tiltY: 0.118, yaw: 0.31, spin: 1.311 });
    expect(r.maxZ).toBeLessThan(BOWL.wallHeight);
    expect(r.z).toBeCloseTo(CANDY_HALF_HEIGHT[0]! + 2 * BOWL.floorHalfHeight, 3);
    expect(bowlAt(r.x, r.y, r.z)).toBe(2);
  });

  it('property: a candy released over a bowl, tilted, spinning and falling at up to 1.5 m/s, never rises above the wall top and stays in the bowl', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 2 }),
      fc.double({ min: -0.04, max: 0.04, noNaN: true }), fc.double({ min: -0.04, max: 0.04, noNaN: true }),
      fc.double({ min: -0.3, max: 0.3, noNaN: true }), fc.double({ min: -0.3, max: 0.3, noNaN: true }),
      fc.double({ min: 0, max: 6.3, noNaN: true }), fc.double({ min: -2, max: 2, noNaN: true }), fc.double({ min: 0, max: 1.5, noNaN: true }),
      (i, bowl, dx, dy, tiltX, tiltY, yaw, spin, vz) => {
        const r = drop({ i, bowl, dx, dy, z0: 0.047, vz, tiltX, tiltY, yaw, spin });
        expect(r.maxZ).toBeLessThan(BOWL.wallHeight);
        expect(bowlAt(r.x, r.y, r.z)).toBe(bowl);
        expect(r.z).toBeGreaterThan(0.010);
      },
    ), { numRuns: 80 });
  });
});
