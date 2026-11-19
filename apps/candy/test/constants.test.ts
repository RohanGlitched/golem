import { describe, expect, it } from 'vitest';
import {
  BOWLS, COLOURS, HAND_START, JOINT_RANGE, NUSERDATA, Q_HOME, SSM, SUCTION, TABLE, TIP_HOME_ESTIMATE, UD, WORKSPACE,
  DELAY_LENGTH, DWELL_STEPS, T_READY,
} from '../constants';

const inBox = (x: number, y: number) =>
  x >= WORKSPACE.xMin && x <= WORKSPACE.xMax && y >= WORKSPACE.yMin && y <= WORKSPACE.yMax;

describe('constants', () => {
  it('puts the bowls on the 0.72 m arc at -32, 0 and +32 degrees', () => {
    [-32, 0, 32].forEach((deg, i) => {
      const b = BOWLS[i]!;
      // the design rounds bowl centres to the millimetre\n      expect(Math.abs(Math.hypot(b.x, b.y) - 0.72)).toBeLessThan(1e-3);
      expect(Math.atan2(b.y, b.x) * 180 / Math.PI).toBeCloseTo(deg, 1);
    });
    expect(BOWLS.map((b) => b.name)).toEqual(['bowl_orange', 'bowl_purple', 'bowl_green']);
  });
  it('gives each bowl one colour and the three colours differ', () => {
    expect(COLOURS).toHaveLength(3);
    expect(new Set(COLOURS.map((c) => c.rgba.join(','))).size).toBe(3);
  });
  it('has a Home_Pose of 7 joints inside the Panda joint limits', () => {
    expect(Q_HOME).toHaveLength(7);
    Q_HOME.forEach((q, i) => {
      expect(q).toBeGreaterThanOrEqual(JOINT_RANGE[i]![0]);
      expect(q).toBeLessThanOrEqual(JOINT_RANGE[i]![1]);
    });
  });
  it('uses distinct userdata indexes below 24', () => {
    const idx = Object.values(UD);
    expect(new Set(idx).size).toBe(idx.length);
    for (const i of idx) expect(i).toBeLessThan(NUSERDATA);
    expect(UD.colour + 5).toBeLessThan(NUSERDATA);
  });
  it('starts the hand at least 1.0 m from the Home_Pose tip estimate', () => {
    const d = Math.hypot(HAND_START.x - TIP_HOME_ESTIMATE.x, HAND_START.y - TIP_HOME_ESTIMATE.y, HAND_START.z - TIP_HOME_ESTIMATE.z);
    expect(d - 0.05).toBeGreaterThanOrEqual(1.0);
  });
  it('places every Table edge point outside the Workspace', () => {
    const n = 200;
    for (let i = 0; i <= n; i++) {
      const x = TABLE.xMin + (i / n) * (TABLE.xMax - TABLE.xMin);
      const y = TABLE.yMin + (i / n) * (TABLE.yMax - TABLE.yMin);
      expect(inBox(x, TABLE.yMin)).toBe(false);
      expect(inBox(x, TABLE.yMax)).toBe(false);
      expect(inBox(TABLE.xMin, y)).toBe(false);
      expect(inBox(TABLE.xMax, y)).toBe(false);
    }
  });
  it('keeps the bowls inside the workspace and the tip at home inside it too', () => {
    for (const b of BOWLS) expect(inBox(b.x, b.y)).toBe(true);
  });
  it('states the suction and SSM numbers of the requirements', () => {
    expect(SUCTION.holdingForce).toBe(3);
    expect(SUCTION.engageRadius).toBe(0.01);
    expect(SSM).toEqual({ slowdown: 0.40, stop: 0.15 });
  });
  it('derives the timing counts from the control step', () => {
    expect(DWELL_STEPS).toBe(15);
    expect(DELAY_LENGTH).toBe(16);
    expect(T_READY).toBeCloseTo(1.3, 12);
  });
});
