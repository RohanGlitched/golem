// Handle helpers for setup-time and monitor-side code. They allocate; do not call them in a Step_Loop.
import { SimError } from './errors.js';
import { registry } from './handles.js';
import type { Mj } from './types.js';

const viewOf = (buf: any): Float64Array => (typeof buf.GetView === 'function' ? buf.GetView() : buf.getView());

/** Creates a DoubleBuffer of `n` zeros, passes it to `fn`, and deletes it exactly once afterwards. */
export function withDoubleBuffer<R>(mj: Mj, n: number, fn: (buf: any) => R): R {
  if (!Number.isInteger(n) || n < 1) {
    throw new SimError(`Invalid buffer length ${String(n)}: an integer of 1 or more is required`);
  }
  const buf = registry.track(new (mj as any).DoubleBuffer(n), 'DoubleBuffer');
  try {
    return fn(buf);
  } finally {
    registry.release(buf);
  }
}

export function geomDistance(
  mj: Mj, model: any, data: any, g1: number, g2: number, distmax: number,
): number;
export function geomDistance(
  mj: Mj, model: any, data: any, g1: number, g2: number, distmax: number, opts: { nearestPoints: true },
): { distance: number; fromto: Float64Array };
export function geomDistance(
  mj: Mj, model: any, data: any, g1: number, g2: number, distmax: number, opts?: { nearestPoints: boolean },
): number | { distance: number; fromto: Float64Array } {
  return withDoubleBuffer(mj, 6, (buf) => {
    const distance: number = (mj as any).mj_geomDistance(model, data, g1, g2, distmax, buf);
    return opts?.nearestPoints ? { distance, fromto: Float64Array.from(viewOf(buf)) } : distance;
  });
}

/** Visits contacts 0..ncon-1 in ascending order. The contact vector is deleted exactly once. */
export function forEachContact(mj: Mj, data: any, visit: (contact: any, index: number) => void): void {
  void mj;
  const vec = registry.track(data.contact, 'ContactVector');
  try {
    const n: number = data.ncon;
    for (let i = 0; i < n; i++) visit(vec.get(i), i);
  } finally {
    registry.release(vec);
  }
}

/**
 * Reads MuJoCo's warning counters by name (INERTIA, CONTACTFULL, CNSTRFULL, BADQPOS, BADQVEL, BADQACC,
 * BADCTRL). `data.warning` is a reference into MjData and must never be deleted (the module aborts);
 * each element returned by `.get(i)` is a copy and is deleted here. Allocates: not for the step loop.
 */
export function readWarnings(mj: Mj, data: any): Record<string, number> {
  const out: Record<string, number> = {};
  const enumObj = (mj as any).mjtWarning as Record<string, { value?: number }> | undefined;
  const w = data.warning;
  if (enumObj === undefined || w === undefined || w === null) return out;
  const size: number = typeof w.size === 'function' ? w.size() : 0;
  for (const key of Object.keys(enumObj)) {
    if (!key.startsWith('mjWARN_')) continue;
    const i = enumObj[key]?.value;
    if (typeof i !== 'number' || i < 0 || i >= size) continue;
    const stat = w.get(i);
    try {
      out[key.slice('mjWARN_'.length)] = stat.number as number;
    } finally {
      stat.delete?.();
    }
  }
  return out;
}