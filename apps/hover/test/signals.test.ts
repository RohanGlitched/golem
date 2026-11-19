import fc from 'fast-check';
import { buildContext } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import { HOVER_NAMES, HOVER_POINT } from '../constants';
import { SIGNAL_NAMES, hoverDistance, tiltDeg, writeSignals } from '../signals';
import { compileRobot } from './helpers/mujoco';

const num = (min: number, max: number) => fc.double({ min, max, noNaN: true });

describe('tiltDeg', () => {
  it('is 0 for the identity and 180 for an upside-down drone', () => {
    expect(tiltDeg([1, 0, 0, 0])).toBe(0);
    expect(tiltDeg([0, 1, 0, 0])).toBeCloseTo(180, 9);
  });
  it('is the angle of a rotation about a horizontal axis, whatever the yaw', () => {
    fc.assert(fc.property(num(0, 179), num(0, Math.PI * 2), num(-3, 3), (tilt, axisAngle, yaw) => {
      const h = (tilt * Math.PI) / 360;
      const ax = [Math.cos(axisAngle), Math.sin(axisAngle)];
      const tiltQ = [Math.cos(h), Math.sin(h) * ax[0]!, Math.sin(h) * ax[1]!, 0];
      // yaw about the body z axis: q_tilt * q_yaw does not change the angle of the body z axis from vertical
      const c = Math.cos(yaw / 2), s = Math.sin(yaw / 2);
      const [w1, x1, y1, z1] = tiltQ as [number, number, number, number];
      const q = [w1 * c - z1 * s, x1 * c + y1 * s, y1 * c - x1 * s, z1 * c + w1 * s];
      expect(tiltDeg(q)).toBeCloseTo(tilt, 6);
    }), { numRuns: 200 });
  });
  it('does not depend on the length of the quaternion, and is NaN for a zero quaternion', () => {
    expect(tiltDeg([2, 0, 0, 0])).toBe(0);
    expect(Number.isNaN(tiltDeg([0, 0, 0, 0]))).toBe(true);
  });
  it('reads the quaternion at an offset', () => {
    expect(tiltDeg([9, 9, 9, 1, 0, 0, 0], 3)).toBe(0);
  });
});

describe('hoverDistance', () => {
  it('is 0 at the hover point and the Euclidean distance elsewhere', () => {
    expect(hoverDistance(HOVER_POINT.x, HOVER_POINT.y, HOVER_POINT.z)).toBe(0);
    fc.assert(fc.property(num(-5, 5), num(-5, 5), num(-5, 5), (dx, dy, dz) => {
      expect(hoverDistance(HOVER_POINT.x + dx, HOVER_POINT.y + dy, HOVER_POINT.z + dz)).toBeCloseTo(Math.hypot(dx, dy, dz), 9);
    }), { numRuns: 100 });
  });
});

const { mj, model } = await compileRobot();
afterAll(() => { model.delete(); });

describe('writeSignals', () => {
  it('writes exactly the declared signals from the state', () => {
    const data = new mj.MjData(model);
    try {
      const ctx = buildContext(mj, model, data, HOVER_NAMES as never);
      data.qpos[0] = 0.1; data.qpos[1] = -0.2; data.qpos[2] = 0.8;
      data.qpos[3] = 1; data.qpos[4] = 0; data.qpos[5] = 0; data.qpos[6] = 0;
      data.qvel[0] = 0.3; data.qvel[1] = 0.4; data.qvel[2] = 0;
      const out: Record<string, number> = {};
      writeSignals(ctx, out);
      expect(Object.keys(out).sort()).toEqual([...SIGNAL_NAMES].sort());
      expect(out['altitude']).toBe(0.8);
      expect(out['hover_distance']).toBeCloseTo(Math.hypot(0.1, 0.2, 0.2), 12);
      expect(out['tilt_deg']).toBe(0);
      expect(out['speed']).toBeCloseTo(0.5, 12);
    } finally { data.delete(); }
  });
});
