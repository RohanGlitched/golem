// The controller on the real model, with short horizons (at most 2 s of simulated time per trial).
import { describe, expect, it } from 'vitest';
import { GRAVITY, HOVER_POINT, MASS } from '../constants';
import { gustForce, sagBattery } from '../perturbations';
import { runtimeFor } from '../runtime';
import { hoverDistance, tiltDeg } from '../signals';
import { makeSim, type Sim } from './helpers/sim';

interface Peaks { dist: number; tilt: number; minZ: number }

/** Runs `seconds`, optionally with a gust of `force` N from `angle` for the first 0.5 s, and returns the extremes. */
function fly(sim: Sim, seconds: number, gust?: { force: number; angle: number }): Peaks {
  const peaks: Peaks = { dist: 0, tilt: 0, minZ: Infinity };
  const f = new Float64Array(2);
  if (gust) gustForce(gust.force, gust.angle, f);
  const t0 = sim.t;
  const qpos: Float64Array = sim.data.qpos;
  const xfrc: Float64Array = sim.data.xfrc_applied;
  const row = 6 * (sim.ctx.ids['body:x2'] as number);
  sim.run(seconds, {
    beforeSim: (t) => { if (gust && t - t0 < 0.5) { xfrc[row] = f[0]!; xfrc[row + 1] = f[1]!; } },
    perSim: () => {
      peaks.dist = Math.max(peaks.dist, hoverDistance(qpos[0]!, qpos[1]!, qpos[2]!));
      peaks.tilt = Math.max(peaks.tilt, tiltDeg(qpos, 3));
      peaks.minZ = Math.min(peaks.minZ, qpos[2]!);
    },
  });
  return peaks;
}

describe('hover', () => {
  it('stays on the hover point when nothing disturbs it: under 1 cm after 2 s from the point itself', async () => {
    const sim = await makeSim();
    try {
      const p = fly(sim, 2);
      expect(p.dist).toBeLessThan(0.01);
      expect(p.tilt).toBeLessThan(0.5);
    } finally { sim.dispose(); }
  });
  it('converges from a start 3 cm away on each axis: under 2 cm after 2 s, level, and nearly at rest', async () => {
    const sim = await makeSim([0.03, -0.03, 1.03]);
    try {
      fly(sim, 2);
      const q: Float64Array = sim.data.qpos, v: Float64Array = sim.data.qvel;
      expect(hoverDistance(q[0]!, q[1]!, q[2]!)).toBeLessThan(0.02);
      expect(tiltDeg(q, 3)).toBeLessThan(1);
      expect(Math.hypot(v[0]!, v[1]!, v[2]!)).toBeLessThan(0.05);
    } finally { sim.dispose(); }
  });
  it('holds the weight at hover: the four motors together make about m g', async () => {
    const sim = await makeSim();
    try {
      fly(sim, 1);
      const ctrl: Float64Array = sim.data.ctrl;
      expect(ctrl[0]! + ctrl[1]! + ctrl[2]! + ctrl[3]!).toBeCloseTo(MASS * GRAVITY, 0);
    } finally { sim.dispose(); }
  });
});

describe('gusts', () => {
  it('rejects a small gust from every one of eight directions: within 0.25 m and under 30 deg of tilt (the lines 1.1 and 1.2)', async () => {
    for (let k = 0; k < 8; k++) {
      const sim = await makeSim();
      try {
        const p = fly(sim, 2, { force: 2, angle: (k * Math.PI) / 4 });
        expect(p.dist, `direction ${k * 45} deg`).toBeLessThan(0.25);
        expect(p.tilt, `direction ${k * 45} deg`).toBeLessThan(30);
      } finally { sim.dispose(); }
    }
  });
  it('moves the drone along the force: a gust from +x pushes it toward -x', async () => {
    const sim = await makeSim();
    try {
      fly(sim, 0.6, { force: 5, angle: 0 });
      expect((sim.data.qpos as Float64Array)[0]).toBeLessThan(-0.01);
      expect(Math.abs((sim.data.qpos as Float64Array)[1]!)).toBeLessThan(0.01);
    } finally { sim.dispose(); }
  });
  it('is blown out of a 1 m ball by a strong gust within 2 s (the line 1.3 breaks)', async () => {
    const sim = await makeSim();
    try {
      const p = fly(sim, 2, { force: 20, angle: 1 });
      expect(p.dist).toBeGreaterThan(1);
    } finally { sim.dispose(); }
  });
  it('never leans past the 35 deg tilt limit by much, even in a strong gust', async () => {
    const sim = await makeSim();
    try {
      const p = fly(sim, 2, { force: 20, angle: 1 });
      expect(p.tilt).toBeLessThan(45);
    } finally { sim.dispose(); }
  });
  it('does not fall while a strong gust blows: the altitude stays above 0.8 m', async () => {
    const sim = await makeSim();
    try {
      const p = fly(sim, 2, { force: 20, angle: 1 });
      expect(p.minZ).toBeGreaterThan(0.8);
    } finally { sim.dispose(); }
  });
});

describe('battery', () => {
  it('keeps its height when the battery sags to 60% (the line 2.1)', async () => {
    const sim = await makeSim();
    try {
      sagBattery(sim.ctx, 0.6);
      const p = fly(sim, 2);
      expect(p.minZ).toBeGreaterThan(0.5);
      const z = (sim.data.qpos as Float64Array)[2]!;
      expect(z).toBeGreaterThan(0.75);          // 2 s after the sag the integral term has not finished raising the thrust
      expect(z).toBeGreaterThan(p.minZ);        // and the drone is climbing back
    } finally { sim.dispose(); }
  });
  it('cannot hold up when the battery gives less than the weight: 20% sags to the floor', async () => {
    const sim = await makeSim();
    try {
      sagBattery(sim.ctx, 0.2);
      const p = fly(sim, 2);
      expect(p.minZ).toBeLessThan(0.5);
    } finally { sim.dispose(); }
  });
});

describe('estimate lag', () => {
  it('does not change the flight when nothing moves the drone: the estimate of a drone at rest is the same, delayed or not', async () => {
    const sim = await makeSim();
    try {
      runtimeFor(sim.ctx).lag = 0.3;
      const p = fly(sim, 1);
      expect(p.dist).toBeLessThan(0.01);
    } finally { sim.dispose(); }
  });
  it('lets a short lag go by: with a 0.1 s lag a 2 N gust moves the drone under 0.35 m (the line 3.1)', async () => {
    const sim = await makeSim();
    try {
      runtimeFor(sim.ctx).lag = 0.1;
      const p = fly(sim, 2, { force: 2, angle: 0.5 });
      expect(p.dist).toBeLessThan(0.35);
    } finally { sim.dispose(); }
  });
  it('turns the same gust into a runaway with a long lag: 0.5 s of lag carries the drone past 0.35 m within 2 s', async () => {
    const sim = await makeSim();
    try {
      runtimeFor(sim.ctx).lag = 0.5;
      const p = fly(sim, 2, { force: 2, angle: 0.5 });
      expect(p.dist).toBeGreaterThan(0.35);
    } finally { sim.dispose(); }
  });
});

describe('constants of the scene', () => {
  it('starts the helper at the hover point', async () => {
    const sim = await makeSim();
    try {
      const q: Float64Array = sim.data.qpos;
      expect([q[0], q[1], q[2]]).toEqual([HOVER_POINT.x, HOVER_POINT.y, HOVER_POINT.z]);
    } finally { sim.dispose(); }
  });
});
