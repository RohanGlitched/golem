// Hover_Signals: what the monitors read. `writeSignals` runs once per Control_Step, before that step's Sim_Steps.
// It reads the live views of the runtime and allocates nothing.
import { HOVER_POINT } from './constants';
import type { SimContext } from './contract';
import { runtimeFor } from './runtime';

export const SIGNAL_NAMES = ['altitude', 'hover_distance', 'tilt_deg', 'speed'] as const;

const RAD2DEG = 180 / Math.PI;

/** Angle between the body z axis and world up, in degrees, in [0, 180]. Quaternion (w, x, y, z) at `o`. */
export function tiltDeg(q: ArrayLike<number>, o = 0): number {
  const w = q[o] as number, x = q[o + 1] as number, y = q[o + 2] as number, z = q[o + 3] as number;
  const n2 = w * w + x * x + y * y + z * z;
  if (!(n2 > 0)) return Number.NaN;
  let c = 1 - (2 * (x * x + y * y)) / n2;
  if (c > 1) c = 1; else if (c < -1) c = -1;
  return Math.acos(c) * RAD2DEG;
}

/** Distance (m) from (x, y, z) to the hover point. */
export function hoverDistance(x: number, y: number, z: number): number {
  return Math.hypot(x - HOVER_POINT.x, y - HOVER_POINT.y, z - HOVER_POINT.z);
}

/** Writes the Hover_Signals into `out`. */
export function writeSignals(ctx: SimContext, out: Record<string, number>): void {
  const { qpos, qvel } = runtimeFor(ctx);
  const x = qpos[0] as number, y = qpos[1] as number, z = qpos[2] as number;
  out['altitude'] = z;
  out['hover_distance'] = hoverDistance(x, y, z);
  out['tilt_deg'] = tiltDeg(qpos, 3);
  out['speed'] = Math.hypot(qvel[0] as number, qvel[1] as number, qvel[2] as number);
}
