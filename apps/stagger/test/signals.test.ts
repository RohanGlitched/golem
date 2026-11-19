import { describe, expect, it } from 'vitest';
import { runtimeFor } from '../runtime';
import { MovingAverage, SIGNAL_NAMES, heading, lateralDrift, tiltDeg, writeSignals } from '../signals';
import { allocations, functionBody } from './helpers/sourceScan';

/** A stub ctx whose pelvis (body 1) sits at `pos` with orientation `quat` and linear velocity `vel`. */
function pelvisCtx(pos: number[], quat: number[], vel: number[], time: number) {
  const xpos = new Float64Array(6); xpos.set(pos, 3);
  const xquat = new Float64Array(8); xquat[0] = 1; xquat.set(quat, 4);
  const qvel = new Float64Array(18); qvel.set(vel, 0);
  return { mj: {}, model: {}, data: { xpos, xquat, qvel, time }, ids: { 'body:pelvis': 1 } };
}

describe('signals', () => {
  it('names the five signals and episode_time', () => {
    expect(SIGNAL_NAMES).toEqual(['pelvis_z', 'tilt_deg', 'forward_speed', 'commanded_speed', 'lateral_drift', 'episode_time']);
  });

  it('gives a tilt of 0 deg when upright', () => {
    expect(tiltDeg([1, 0, 0, 0])).toBe(0);
  });

  it('gives a tilt of 90 deg for a 90 deg roll', () => {
    const a = Math.PI / 4;
    expect(tiltDeg([Math.cos(a), Math.sin(a), 0, 0])).toBeCloseTo(90, 10);
  });

  it('gives a tilt of 180 deg upside down', () => {
    expect(tiltDeg([0, 1, 0, 0])).toBeCloseTo(180, 10);
  });

  it('reads the heading from the pelvis x axis', () => {
    const h = new Float64Array(2);
    const a = Math.PI / 6;   // 60 deg yaw
    heading([Math.cos(a), 0, 0, Math.sin(a)], h);
    expect(h[0]).toBeCloseTo(0.5, 12);
    expect(h[1]).toBeCloseTo(Math.sqrt(3) / 2, 12);
  });

  it('averages over the samples available when fewer than 50 exist', () => {
    const m = new MovingAverage(50);
    m.push(1); m.push(2); m.push(6);
    expect(m.mean()).toBe(3);
  });

  it('forgets samples older than the window', () => {
    const m = new MovingAverage(50);
    for (let i = 0; i < 50; i++) m.push(100);
    for (let i = 0; i < 50; i++) m.push(1);
    expect(m.mean()).toBe(1);
  });

  it('measures drift as the distance to the heading line', () => {
    // line through (1, 1) along +x; point (4, 3.5) is 2.5 m to the side
    expect(lateralDrift(4, 3.5, 1, 1, 1, 0)).toBeCloseTo(2.5, 12);
    // line along the diagonal; point on the line has no drift
    const s = Math.SQRT1_2;
    expect(lateralDrift(3, 3, 0, 0, s, s)).toBeCloseTo(0, 12);
    expect(lateralDrift(0, 2, 0, 0, s, s)).toBeCloseTo(Math.SQRT2, 12);
  });

  it('latches the trigger at the end of warm-up and reports drift from there', () => {
    const ctx = pelvisCtx([0.5, 0.2, 0.78], [1, 0, 0, 0], [0.4, 0, 0], 2);
    const rt = runtimeFor(ctx);
    const out: Record<string, number> = {};
    writeSignals(ctx, rt, out);
    expect(rt.trigger.latched).toBe(true);
    expect(out).toEqual({
      pelvis_z: 0.78, tilt_deg: 0, forward_speed: 0.4, commanded_speed: 0.5, lateral_drift: 0, episode_time: 2,
    });
    ctx.data.xpos[3] = 1.0; ctx.data.xpos[4] = -0.1; ctx.data.time = 2.02;
    ctx.data.qvel[0] = 0.6;
    writeSignals(ctx, rt, out);
    expect(out['lateral_drift']).toBeCloseTo(0.3, 12);
    expect(out['forward_speed']).toBeCloseTo(0.5, 12);
    expect(out['episode_time']).toBe(2.02);
  });

  it('does not latch the trigger before the end of warm-up', () => {
    const ctx = pelvisCtx([0, 0, 0.78], [1, 0, 0, 0], [0, 0, 0], 1.5);
    const rt = runtimeFor(ctx);
    writeSignals(ctx, rt, {});
    expect(rt.trigger.latched).toBe(false);
  });

  it('allocates nothing inside writeSignals', () => {
    expect(allocations(functionBody('signals.ts', /export function writeSignals\(/))).toEqual([]);
    expect(allocations(functionBody('signals.ts', /export function ringMean\(/))).toEqual([]);
    expect(allocations(functionBody('signals.ts', /export function ringPush\(/))).toEqual([]);
    expect(allocations(functionBody('signals.ts', /export function heading\(/))).toEqual([]);
  });
});
