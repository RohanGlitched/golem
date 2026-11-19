// Live views and scratch arrays that the perturbations (and the app) use every Sim_Step. MuJoCo's typed-array
// properties allocate a view on every access, so the perturbations take them from here instead. One runtime per
// SimContext, in a WeakMap, so no state leaks between trials. The views are re-read after WASM memory growth.
import type { SimContext } from './contract';
import { candyIds } from './controller/ids';

export interface CandyRuntime {
  mocapPos: Float64Array;
  mocapQuat: Float64Array;
  userdata: Float64Array;
  /** Row of the Hand in mocap_pos and mocap_quat. */
  hand: number;
  /** Scratch for the hand pose (x, y, z, yaw). */
  pose: Float64Array;
  /** Scratch for candy placement: (x, y) of candies 0 to 5. */
  xy: Float64Array;
}

const runtimes = new WeakMap<SimContext, CandyRuntime>();

export function runtimeFor(ctx: SimContext): CandyRuntime {
  let rt = runtimes.get(ctx);
  if (rt === undefined) {
    rt = {
      mocapPos: ctx.data.mocap_pos, mocapQuat: ctx.data.mocap_quat, userdata: ctx.data.userdata,
      hand: candyIds(ctx).handMocap, pose: new Float64Array(4), xy: new Float64Array(12),
    };
    runtimes.set(ctx, rt);
  } else if (rt.mocapPos.buffer.byteLength === 0 || rt.userdata.buffer.byteLength === 0) {
    rt.mocapPos = ctx.data.mocap_pos; rt.mocapQuat = ctx.data.mocap_quat; rt.userdata = ctx.data.userdata;
  }
  return rt;
}

/** `v` limited to [lo, hi]; a NaN becomes `lo`. */
export function clamp(v: number, lo: number, hi: number): number {
  return v >= lo ? (v <= hi ? v : hi) : lo;
}
