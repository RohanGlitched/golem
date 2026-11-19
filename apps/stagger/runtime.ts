// Per-trial mutable state shared by the Walker, the signals and the perturbations.
// SimContext has no slot for it, so it hangs off the context in a WeakMap (an approved addition).
import type { SimContext } from './contract.js';

export interface StaggerRuntime {
  command: Float64Array;              // [vx, vy, wz]
  delaySteps: number;                 // whole Control_Steps of observation delay
  trigger: { latched: boolean; t: number; pos: Float64Array; heading: Float64Array };
  push: { startTime: number; dirX: number; dirY: number; latched: boolean };
  saved: {
    gravity: Float64Array; torsoMass: number; torsoInertia: Float64Array;
    floorFriction: Float64Array; has: boolean;
    /** Which model fields this trial changed (and saved first). */
    gravityHas: boolean; massHas: boolean; frictionHas: boolean;
  };
  speedRing: { buf: Float64Array; n: number; head: number; sum: number };
  /** Scratch for per-call vector math (heading, push force), so hot paths allocate nothing. */
  scratch: Float64Array;
  /** The 12 initial joint-noise values of this trial (rad). */
  noise: Float64Array;
}

export const DEFAULT_COMMAND: readonly [number, number, number] = [0.5, 0, 0];
export const SPEED_WINDOW = 50;
/** Warm-up before the trigger, in seconds (app.warmup). */
export const WARMUP = 2;

const runtimes = new WeakMap<SimContext, StaggerRuntime>();

function create(): StaggerRuntime {
  const rt: StaggerRuntime = {
    command: new Float64Array(3),
    delaySteps: 0,
    trigger: { latched: false, t: 0, pos: new Float64Array(3), heading: new Float64Array(2) },
    push: { startTime: 0, dirX: 1, dirY: 0, latched: false },
    saved: {
      gravity: new Float64Array(3), torsoMass: 0, torsoInertia: new Float64Array(3),
      floorFriction: new Float64Array(3), has: false, gravityHas: false, massHas: false, frictionHas: false,
    },
    speedRing: { buf: new Float64Array(SPEED_WINDOW), n: 0, head: 0, sum: 0 },
    scratch: new Float64Array(4),
    noise: new Float64Array(12),
  };
  resetRuntime(rt);
  return rt;
}

/** Returns the runtime of `ctx`, creating (and allocating) it on the first call. */
export function runtimeFor(ctx: SimContext): StaggerRuntime {
  let rt = runtimes.get(ctx);
  if (rt === undefined) {
    rt = create();
    runtimes.set(ctx, rt);
  }
  return rt;
}

/** Restores trial defaults. Call only after any saved model values were restored. */
export function resetRuntime(rt: StaggerRuntime): void {
  rt.command[0] = DEFAULT_COMMAND[0]; rt.command[1] = DEFAULT_COMMAND[1]; rt.command[2] = DEFAULT_COMMAND[2];
  rt.delaySteps = 0;
  rt.trigger.latched = false; rt.trigger.t = 0;
  rt.trigger.pos.fill(0); rt.trigger.heading[0] = 1; rt.trigger.heading[1] = 0;
  rt.push.startTime = 0; rt.push.dirX = 1; rt.push.dirY = 0; rt.push.latched = false;
  rt.saved.has = false; rt.saved.gravityHas = false; rt.saved.massHas = false; rt.saved.frictionHas = false;
  rt.speedRing.buf.fill(0); rt.speedRing.n = 0; rt.speedRing.head = 0; rt.speedRing.sum = 0;
}
