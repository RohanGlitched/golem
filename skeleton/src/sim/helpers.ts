// Handle helpers for setup-time and monitor-side code. They allocate; do not call them in a Step_Loop.
import { SimError } from './errors.js';
import { registry } from './handles.js';
import type { DoubleBuffer, MjContact } from '@mujoco/mujoco';
import type { Mj, MjData, MjModel } from './types.js';

interface ViewSource { GetView?(): Float64Array; getView?(): Float64Array }
const viewOf = (buf: ViewSource): Float64Array =>
  (typeof buf.GetView === 'function' ? buf.GetView() : (buf.getView as () => Float64Array)());

/** Creates a DoubleBuffer of `n` zeros, passes it to `fn`, and deletes it exactly once afterwards. */
export function withDoubleBuffer<R>(mj: Mj, n: number, fn: (buf: DoubleBuffer) => R): R {
  if (!Number.isInteger(n) || n < 1) {
    throw new SimError(`Invalid buffer length ${String(n)}: an integer of 1 or more is required`);
  }
  const buf = registry.track(new mj.DoubleBuffer(n), 'DoubleBuffer');
  try {
    return fn(buf);
  } finally {
    registry.release(buf);
  }
}

export function geomDistance(
  mj: Mj, model: MjModel, data: MjData, g1: number, g2: number, distmax: number,
): number;
export function geomDistance(
  mj: Mj, model: MjModel, data: MjData, g1: number, g2: number, distmax: number, opts: { nearestPoints: true },
): { distance: number; fromto: Float64Array };
export function geomDistance(
  mj: Mj, model: MjModel, data: MjData, g1: number, g2: number, distmax: number, opts?: { nearestPoints: boolean },
): number | { distance: number; fromto: Float64Array } {
  return withDoubleBuffer(mj, 6, (buf) => {
    const distance = mj.mj_geomDistance(model, data, g1, g2, distmax, buf);
    return opts?.nearestPoints ? { distance, fromto: Float64Array.from(viewOf(buf)) } : distance;
  });
}

/** Visits contacts 0..ncon-1 in ascending order. The contact vector is deleted exactly once. */
export function forEachContact(mj: Mj, data: MjData, visit: (contact: MjContact, index: number) => void): void {
  void mj;
  const vec = registry.track(data.contact, 'ContactVector');
  try {
    const n = data.ncon;
    for (let i = 0; i < n; i++) visit(vec.get(i) as MjContact, i);
  } finally {
    registry.release(vec);
  }
}

/**
 * Reads MuJoCo's warning counters by name (INERTIA, CONTACTFULL, CNSTRFULL, BADQPOS, BADQVEL, BADQACC,
 * BADCTRL). `data.warning` is a reference into MjData and must never be deleted (the module aborts);
 * each element returned by `.get(i)` is a copy and is deleted here. Allocates: not for the step loop.
 */
export function readWarnings(mj: Mj, data: MjData): Record<string, number> {
  const out: Record<string, number> = {};
  const enumObj = mj.mjtWarning as unknown as Record<string, { value?: number } | undefined> | undefined;
  const w = data.warning;
  if (enumObj === undefined || w === undefined || w === null) return out;
  const size: number = typeof w.size === 'function' ? w.size() : 0;
  for (const key of Object.keys(enumObj)) {
    if (!key.startsWith('mjWARN_')) continue;
    const i = enumObj[key]?.value;
    if (typeof i !== 'number' || i < 0 || i >= size) continue;
    const stat = w.get(i);
    if (stat === undefined) continue;
    try {
      out[key.slice('mjWARN_'.length)] = stat.number;
    } finally {
      stat.delete();
    }
  }
  return out;
}
/**
 * Torque-saturation meter (golem-sim-hardening improvement 4). Copies `actuator_ctrlrange` and
 * `actuator_ctrllimited` once (call it per trial, after domain randomisation), and returns a function of
 * `ctrl` giving max_i |2 ctrl_i - (lo_i + hi_i)| / (hi_i - lo_i) over ctrl-limited actuators: 0 at the
 * middle of every range, 1 at a limit, above 1 past it. 0 when no actuator is ctrl-limited; NaN when a
 * limited command is NaN. The returned function does not allocate.
 */
export function createSaturationMeter(
  model: Pick<MjModel, 'nu' | 'actuator_ctrlrange' | 'actuator_ctrllimited'>,
): (ctrl: ArrayLike<number>) => number {
  const nu = model.nu as number;
  const range: ArrayLike<number> = model.actuator_ctrlrange;
  const limited: ArrayLike<number> = model.actuator_ctrllimited;
  const ids: number[] = [];
  for (let i = 0; i < nu; i++) {
    if ((limited[i] as number) !== 0 && (range[2 * i + 1] as number) > (range[2 * i] as number)) ids.push(i);
  }
  const idx = Int32Array.from(ids);
  const mid = new Float64Array(ids.length);
  const span = new Float64Array(ids.length);
  ids.forEach((i, j) => {
    mid[j] = (range[2 * i] as number) + (range[2 * i + 1] as number);
    span[j] = (range[2 * i + 1] as number) - (range[2 * i] as number);
  });
  return (ctrl) => {
    let s = 0;
    for (let j = 0; j < idx.length; j++) {
      const r = Math.abs(2 * (ctrl[idx[j] as number] as number) - (mid[j] as number)) / (span[j] as number);
      if (!(r <= s)) s = r;
    }
    return s;
  };
}