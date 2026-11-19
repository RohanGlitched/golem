import { describe, expect, it } from 'vitest';
import { ACTION_SCALE, KD, KP, actionToTarget, pdTorque } from '../controller/pd';
import { DEFAULT_POSE } from '../controller/observation';

describe('PD law', () => {
  it('uses the gains of configs/g1.yaml', () => {
    expect(Array.from(KP)).toEqual([100, 100, 100, 150, 40, 40, 100, 100, 100, 150, 40, 40]);
    expect(Array.from(KD)).toEqual([2, 2, 2, 4, 2, 2, 2, 2, 2, 4, 2, 2]);
    expect(ACTION_SCALE).toBe(0.25);
  });
  it('gives zero torque at the target with zero velocity', () => {
    const ctrl = new Float64Array(12).fill(5);
    pdTorque(DEFAULT_POSE, DEFAULT_POSE, new Float64Array(12), ctrl);
    expect(Array.from(ctrl).every((v) => v === 0)).toBe(true);
  });
  it('maps a zero action to the default pose and a unit action to 0.25 rad above it', () => {
    const t = new Float64Array(12);
    actionToTarget(new Float64Array(12), t);
    expect(Array.from(t)).toEqual(Array.from(DEFAULT_POSE));
    actionToTarget(new Float64Array(12).fill(1), t);
    for (let j = 0; j < 12; j++) expect(t[j]).toBeCloseTo(DEFAULT_POSE[j]! + 0.25, 15);
  });
  it('computes (target - q) kp - qd kd for a spot value', () => {
    const ctrl = new Float64Array(12);
    const target = new Float64Array(12).fill(0.1);
    pdTorque(target, new Float64Array(12), new Float64Array(12).fill(1), ctrl);
    expect(ctrl[3]).toBeCloseTo(0.1 * 150 - 4, 12);
    expect(ctrl[4]).toBeCloseTo(0.1 * 40 - 2, 12);
  });
});