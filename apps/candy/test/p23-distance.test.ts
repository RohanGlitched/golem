// Feature: candy-app, Property 23: Link-hand distance signal
import fc from 'fast-check';
import { buildContext, geomDistance } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import { DISTMAX, Q_HOME } from '../constants';
import { CANDY_NAMES, candyIds } from '../controller/ids';
import { writeSignals } from '../signals';
import { compileRobot } from './helpers/mujoco';

const { mj, model } = await compileRobot();
const data = new mj.MjData(model);
const ctx = buildContext(mj, model, data, CANDY_NAMES as never);
const ids = candyIds(ctx);
afterAll(() => { data.delete(); model.delete(); });

const arm = fc.array(fc.double({ min: -0.35, max: 0.35, noNaN: true }), { minLength: 7, maxLength: 7 });
const hand = fc.tuple(
  fc.double({ min: -0.3, max: 1.0, noNaN: true }), fc.double({ min: -0.8, max: 0.8, noNaN: true }), fc.double({ min: 0.0, max: 0.8, noNaN: true }),
  fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
);

describe('link-hand distance signal', () => {
  it('equals the minimum of every per-pair signed distance, never exceeds 0.6 m, and is 0.6 m exactly when no pair is closer', () => {
    let nearCount = 0, farCount = 0;
    fc.assert(fc.property(arm, hand, (dq, h) => {
      data.qpos.fill(0);
      for (let j = 0; j < 7; j++) {
        const lo = model.jnt_range[2 * j], hi = model.jnt_range[2 * j + 1];
        data.qpos[j] = Math.min(hi, Math.max(lo, Q_HOME[j]! + dq[j]!));
      }
      const m = ids.handMocap;
      data.mocap_pos[3 * m] = h[0]; data.mocap_pos[3 * m + 1] = h[1]; data.mocap_pos[3 * m + 2] = h[2];
      data.mocap_quat[4 * m] = Math.cos(h[3] / 2); data.mocap_quat[4 * m + 1] = 0; data.mocap_quat[4 * m + 2] = 0; data.mocap_quat[4 * m + 3] = Math.sin(h[3] / 2);
      mj.mj_forward(model, data);
      const out: Record<string, number> = {};
      writeSignals(ctx, out);
      let ref = Infinity;
      for (const g of ids.armGeoms) for (const hg of [ids.palmGeom, ids.forearmGeom]) {
        ref = Math.min(ref, geomDistance(mj, model, data, g, hg, DISTMAX));
      }
      const s = out['min_link_hand_distance']!;
      expect(s).toBeLessThanOrEqual(DISTMAX);
      expect(s).toBeCloseTo(Math.min(ref, DISTMAX), 9);
      if (ref >= DISTMAX) { expect(s).toBe(DISTMAX); farCount++; } else { expect(s).toBeLessThan(DISTMAX); nearCount++; }
    }), { numRuns: 200 });
    // the generator exercises both branches
    expect(nearCount).toBeGreaterThan(5);
    expect(farCount).toBeGreaterThan(5);
  });
});
