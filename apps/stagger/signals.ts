// The G1 signals that predicates read. golem-sim calls `writeSignals` (through `app.signals`) once per
// Control_Step after warm-up. Nothing here allocates per call: the runtime owns every buffer.
import type { SimContext } from './contract.js';
import { SPEED_WINDOW, WARMUP, type StaggerRuntime } from './runtime.js';

export const SIGNAL_NAMES = [
  'pelvis_z', 'tilt_deg', 'forward_speed', 'commanded_speed', 'lateral_drift', 'episode_time',
] as const;

const RAD2DEG = 180 / Math.PI;

/**
 * Heading: the pelvis x axis projected on the horizontal plane, normalised. Writes out[0], out[1].
 * When the x axis points straight up or down the heading is undefined; out keeps its value.
 */
export function heading(quat: ArrayLike<number>, out: Float64Array, offset = 0): void {
  const w = quat[offset] as number, x = quat[offset + 1] as number;
  const y = quat[offset + 2] as number, z = quat[offset + 3] as number;
  const hx = 1 - 2 * (y * y + z * z);
  const hy = 2 * (x * y + w * z);
  const n = Math.sqrt(hx * hx + hy * hy);
  if (n < 1e-12) return;
  out[0] = hx / n;
  out[1] = hy / n;
}

/** Angle between the body z axis and world up, in degrees, in [0, 180]. Quaternion (w, x, y, z). */
export function tiltDeg(quat: ArrayLike<number>, offset = 0): number {
  const w = quat[offset] as number, x = quat[offset + 1] as number;
  const y = quat[offset + 2] as number, z = quat[offset + 3] as number;
  const n2 = w * w + x * x + y * y + z * z;
  let c = 1 - (2 * (x * x + y * y)) / n2;    // R[2][2]
  if (c > 1) c = 1; else if (c < -1) c = -1;
  return Math.acos(c) * RAD2DEG;
}

/** Horizontal distance from p to the line through p0 along the unit heading h. */
export function lateralDrift(px: number, py: number, p0x: number, p0y: number, hx: number, hy: number): number {
  return Math.abs((px - p0x) * hy - (py - p0y) * hx);
}

/** Projection of the horizontal velocity on the unit heading. */
export function forwardSpeed(vx: number, vy: number, hx: number, hy: number): number {
  return vx * hx + vy * hy;
}

export interface Ring { buf: Float64Array; n: number; head: number; sum: number }

/** Pushes one sample into a ring of capacity buf.length. */
export function ringPush(r: Ring, x: number): void {
  const cap = r.buf.length;
  r.buf[r.head] = x;
  r.head = r.head + 1 === cap ? 0 : r.head + 1;
  if (r.n < cap) r.n++;
}

/** Arithmetic mean of the samples held (0 when empty). Summed afresh, so no drift builds up. */
export function ringMean(r: Ring): number {
  if (r.n === 0) return 0;
  const cap = r.buf.length;
  let s = 0;
  let i = r.head - r.n;
  if (i < 0) i += cap;
  for (let k = 0; k < r.n; k++) {
    s += r.buf[i] as number;
    i = i + 1 === cap ? 0 : i + 1;
  }
  r.sum = s;
  return s / r.n;
}

export function ringReset(r: Ring): void {
  r.buf.fill(0); r.n = 0; r.head = 0; r.sum = 0;
}

/** Moving average over the last `n` samples (50 = 1 s of Control_Steps), allocated up front. */
export class MovingAverage {
  private readonly ring: Ring;
  constructor(n: number = SPEED_WINDOW) {
    if (!Number.isInteger(n) || n < 1) throw new Error(`moving-average window must be a positive integer, got ${n}`);
    this.ring = { buf: new Float64Array(n), n: 0, head: 0, sum: 0 };
  }
  push(x: number): void { ringPush(this.ring, x); }
  mean(): number { return ringMean(this.ring); }
  get count(): number { return this.ring.n; }
  reset(): void { ringReset(this.ring); }
}

/** Latches the trigger pose and Heading from the pelvis, unless a perturbation already did. */
export function latchTrigger(rt: StaggerRuntime, t: number, pos: ArrayLike<number>, quat: ArrayLike<number>, pOff: number, qOff: number): void {
  if (rt.trigger.latched) return;
  rt.trigger.latched = true;
  rt.trigger.t = t;
  rt.trigger.pos[0] = pos[pOff] as number;
  rt.trigger.pos[1] = pos[pOff + 1] as number;
  rt.trigger.pos[2] = pos[pOff + 2] as number;
  rt.trigger.heading[0] = 1; rt.trigger.heading[1] = 0;
  heading(quat, rt.trigger.heading, qOff);
}

/**
 * Writes pelvis_z, tilt_deg, forward_speed, commanded_speed, lateral_drift and episode_time into `out`.
 * Reads the pelvis body pose from data.xpos / data.xquat and its velocity from the free joint.
 */
export function writeSignals(ctx: SimContext, rt: StaggerRuntime, out: Record<string, number>): void {
  const data = ctx.data;
  const b = ctx.ids['body:pelvis'] ?? 1;
  const xpos: Float64Array = data.xpos;
  const xquat: Float64Array = data.xquat;
  const qvel: Float64Array = data.qvel;
  const time: number = data.time;
  const p = 3 * b, q = 4 * b;

  if (!rt.trigger.latched && time >= WARMUP - 1e-9) latchTrigger(rt, time, xpos, xquat, p, q);

  const h = rt.scratch;
  h[0] = 1; h[1] = 0;
  heading(xquat, h, q);
  ringPush(rt.speedRing, forwardSpeed(qvel[0] as number, qvel[1] as number, h[0] as number, h[1] as number));

  const px = xpos[p] as number, py = xpos[p + 1] as number;
  const drift = rt.trigger.latched
    ? lateralDrift(px, py, rt.trigger.pos[0] as number, rt.trigger.pos[1] as number,
      rt.trigger.heading[0] as number, rt.trigger.heading[1] as number)
    : 0;

  out['pelvis_z'] = xpos[p + 2] as number;
  out['tilt_deg'] = tiltDeg(xquat, q);
  out['forward_speed'] = ringMean(rt.speedRing);
  out['commanded_speed'] = rt.command[0] as number;
  out['lateral_drift'] = drift;
  out['episode_time'] = time;
}
