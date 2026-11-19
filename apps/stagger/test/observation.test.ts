import { describe, expect, it } from 'vitest';
import { DEFAULT_POSE, GAIT_PERIOD, buildObservation, gaitPhase, projectedGravity } from '../controller/observation';
import { allocations, functionBody } from './helpers/sourceScan';

describe('observation', () => {
  it('lays out a hand-written case like the deploy script', () => {
    const qpos = new Float64Array(19); const qvel = new Float64Array(18);
    qpos[3] = 1; // upright
    for (let i = 0; i < 12; i++) { qpos[7 + i] = DEFAULT_POSE[i]! + 0.01 * (i + 1); qvel[6 + i] = i - 6; }
    qvel[3] = 4; qvel[4] = -8; qvel[5] = 2;
    const prev = Float64Array.from({ length: 12 }, (_, i) => -i);
    const obs = new Float64Array(47);
    buildObservation(qpos, qvel, new Float64Array([0.5, -0.25, 1]), prev, 0.2, obs);
    expect(Array.from(obs.subarray(0, 3))).toEqual([1, -2, 0.5]);
    expect(Array.from(obs.subarray(3, 6))).toEqual([0, -0, -1]);
    expect(Array.from(obs.subarray(6, 9))).toEqual([1, -0.5, 0.25]);
    for (let i = 0; i < 12; i++) {
      expect(obs[9 + i]).toBeCloseTo(0.01 * (i + 1), 15);
      expect(obs[21 + i]).toBeCloseTo(0.05 * (i - 6), 15);
      expect(obs[33 + i]).toBe(-i);
    }
    expect(obs[45]).toBeCloseTo(Math.sin(2 * Math.PI * 0.25), 15);
    expect(obs[46]).toBeCloseTo(Math.cos(2 * Math.PI * 0.25), 15);
  });
  it('gives (0, 0, -1) for the upright quaternion', () => {
    const g = new Float64Array(3);
    projectedGravity([1, 0, 0, 0], g, 0);
    expect(Array.from(g)).toEqual([0, -0, -1]);
  });
  it('gives phase 0 at t = 0 and a 0.8 s period', () => {
    expect(gaitPhase(0)).toBe(0);
    expect(GAIT_PERIOD).toBe(0.8);
    expect(gaitPhase(0.4)).toBeCloseTo(0.5, 12);
    expect(gaitPhase(0.8 * 3 + 0.2)).toBeCloseTo(0.25, 9);
  });
  it('writes a zero previous action when given the zero vector of the first step', () => {
    const qpos = new Float64Array(19); qpos[3] = 1;
    const obs = new Float64Array(47).fill(9);
    buildObservation(qpos, new Float64Array(18), new Float64Array(3), new Float64Array(12), 0, obs);
    expect(Array.from(obs.subarray(33, 45))).toEqual(new Array(12).fill(0));
    expect(obs[45]).toBe(0); expect(obs[46]).toBe(1);
  });
  it('allocates nothing per call', () => {
    expect(allocations(functionBody('controller/observation.ts', /export function buildObservation\(/))).toEqual([]);
    expect(allocations(functionBody('controller/observation.ts', /export function projectedGravity\(/))).toEqual([]);
  });
});