// Live views and per-trial state that the controller, the signals and the perturbations share. MuJoCo's typed-array
// properties allocate a view on every access, so the Sim_Step code takes them from here instead. One runtime per
// SimContext, in a WeakMap, so no state leaks between trials. The views are re-read after WASM memory growth.
import type { SimContext } from './contract';

export interface HoverRuntime {
  qpos: Float64Array;
  qvel: Float64Array;
  ctrl: Float64Array;
  xfrc: Float64Array;
  /** Row of the drone body in xfrc_applied (6 numbers per body). */
  bodyRow: number;
  /** How far the controller's position estimate lags the true position (s). Set by a perturbation's `begin`. */
  lag: number;
}

const runtimes = new WeakMap<SimContext, HoverRuntime>();

/** The runtime of this trial. The drone body must be resolved in `ctx.ids` (`body:x2`, see HOVER_NAMES). */
export function runtimeFor(ctx: SimContext): HoverRuntime {
  let rt = runtimes.get(ctx);
  if (rt === undefined) {
    const body = ctx.ids['body:x2'];
    if (body === undefined) throw new Error('body "x2" is not resolved in ctx.ids; add it to app.names');
    rt = {
      qpos: ctx.data.qpos, qvel: ctx.data.qvel, ctrl: ctx.data.ctrl, xfrc: ctx.data.xfrc_applied,
      bodyRow: 6 * body, lag: 0,
    };
    runtimes.set(ctx, rt);
  } else if (rt.qpos.buffer.byteLength === 0 || rt.xfrc.buffer.byteLength === 0) {
    rt.qpos = ctx.data.qpos; rt.qvel = ctx.data.qvel; rt.ctrl = ctx.data.ctrl; rt.xfrc = ctx.data.xfrc_applied;
  }
  return rt;
}

/** `v` limited to [lo, hi]; a NaN becomes `lo`. */
export function clamp(v: number, lo: number, hi: number): number {
  return v >= lo ? (v <= hi ? v : hi) : lo;
}
