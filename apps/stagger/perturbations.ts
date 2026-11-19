// The six G1 perturbations: push, slope, payload, floor friction, sensor latency and command.
// golem-sim calls `apply(ctx, t, tTrigger, values)` before every Sim_Step of the Active Phase, after
// zeroing data.xfrc_applied. Every `apply` reads and writes preallocated runtime state only.
//
// Model changes (gravity, mass, friction) are saved into rt.saved before the first change and
// undone by `restoreModel`, which app.endTrial and app.initState call. The model is shared by
// every trial in a worker, so a leftover change would leak into the next trial.
import type { Dimension, PerturbationTemplate, Quantity, SimContext, Slots } from './contract.js';
import { GAIT_PERIOD, gaitPhase } from './controller/observation.js';
import { delaySteps } from './controller/latency.js';
import { runtimeFor, type StaggerRuntime } from './runtime.js';
import { heading } from './signals.js';

/** The 12-DOF G1 model has no separate torso link: the pelvis body carries the torso inertia. */
export const TORSO_BODY = 'pelvis';
export const PUSH_BODY = 'pelvis';
export const FLOOR_GEOM = 'floor';

const TWO_PI = 2 * Math.PI;

// ---------------------------------------------------------------- pure helpers

/** Delay from the trigger to the instant the Gait_Phase equals `pushPhase`: ((p - p0) mod 1) * 0.8 s, in [0, 0.8). */
export function pushStartOffset(pushPhase: number, triggerPhase: number): number {
  let d = (pushPhase - triggerPhase) % 1;
  if (d < 0) d += 1;
  if (d >= 1) d = 0;
  const off = d * GAIT_PERIOD;
  return off >= GAIT_PERIOD ? 0 : off;
}

/**
 * Horizontal push force. Inside [start, start + duration) writes force * (heading rotated by angle)
 * into out[0], out[1] and 0 into out[2]; outside it writes zeros.
 */
export function pushForce(
  t: number, start: number, duration: number, force: number,
  head: ArrayLike<number>, angle: number, out: Float64Array,
): void {
  if (t < start || t >= start + duration) { out[0] = 0; out[1] = 0; out[2] = 0; return; }
  const c = Math.cos(angle), s = Math.sin(angle);
  const hx = head[0] as number, hy = head[1] as number;
  out[0] = force * (c * hx - s * hy);
  out[1] = force * (s * hx + c * hy);
  out[2] = 0;
}

/** Gravity rotated about the world y axis by `angle` (rad). The norm and the y component are kept. */
export function slopeGravity(g0: ArrayLike<number>, angle: number, out: Float64Array): void {
  const c = Math.cos(angle), s = Math.sin(angle);
  const gx = g0[0] as number, gy = g0[1] as number, gz = g0[2] as number;
  out[0] = c * gx + s * gz;
  out[1] = gy;
  out[2] = -s * gx + c * gz;
}

/** Rejects a ratio outside [0, 1] with a message that names the ratio and the range. */
export function validateRatio(ratio: number): void {
  if (!(ratio >= 0 && ratio <= 1)) {
    throw new Error(`ratio ${formatPercent(ratio)} is outside 0% to 100%`);
  }
}

function formatPercent(r: number): string {
  if (!Number.isFinite(r)) return String(r);
  return `${Number((r * 100).toPrecision(12))}%`;
}

// ---------------------------------------------------------------- slot helpers (compile time)

type Pair = [Quantity, Quantity];
const isPair = (v: unknown): v is Pair => Array.isArray(v) && v.length === 2;
const isQuantity = (v: unknown): v is Quantity => typeof v === 'object' && v !== null && !Array.isArray(v) && 'si' in v;

function rangeDim(name: string, v: Slots[string] | undefined, kind: Dimension['kind'], severity: Dimension['severity']): Dimension {
  if (isPair(v)) return { name, kind, min: v[0].si, max: v[1].si, severity };
  if (isQuantity(v)) return { name, kind, min: v.si, max: v.si, severity };
  throw new Error(`${name}: expected a ${kind} or a ${kind} range`);
}

/** `any direction` = [0, 2 pi), `behind` = [135 deg, 225 deg], a fixed angle otherwise. */
function directionDim(v: Slots[string] | undefined): Dimension {
  const base = { name: 'push.angle', kind: 'angle' as const, severity: 'none' as const, wrap: true };
  if (v === 'any direction') return { ...base, min: 0, max: TWO_PI };
  if (v === 'behind') return { ...base, min: (3 * Math.PI) / 4, max: (5 * Math.PI) / 4 };
  if (isQuantity(v)) return { ...base, min: v.si, max: v.si };
  throw new Error(`push.angle: unknown direction '${String(v)}'`);
}

function phaseDim(v: Slots[string] | undefined): Dimension {
  const base = { name: 'push.phase', kind: 'phase' as const, severity: 'none' as const, wrap: true };
  if (v === 'any point in its stride') return { ...base, min: 0, max: 1 };
  if (isQuantity(v)) return { ...base, min: v.si, max: v.si };
  throw new Error(`push.phase: unknown phase '${String(v)}'`);
}

// ---------------------------------------------------------------- model save / restore

/**
 * The runtime that last saved values of each model. A trial aborted before endTrial leaves its entry
 * here, so the next initState (with a new ctx and runtime) can still undo the change.
 */
export const pendingRestore = new WeakMap<object, StaggerRuntime>();

/** Undoes the model changes of any earlier trial on this model whose endTrial did not run. */
export function restoreLeftovers(ctx: SimContext): void {
  const prev = pendingRestore.get(ctx.model);
  if (prev !== undefined) restoreModel(ctx, prev);
  pendingRestore.delete(ctx.model);
}

/** Restores every model field this trial changed, then clears the saved flags. Safe to call twice. */
export function restoreModel(ctx: SimContext, rt: StaggerRuntime): void {
  const s = rt.saved;
  if (!s.has) return;
  const model = ctx.model;
  if (s.gravityHas) model.opt.gravity.set(s.gravity);
  if (s.massHas) {
    const b = bodyId(ctx, TORSO_BODY);
    model.body_mass[b] = s.torsoMass;
    const inertia: Float64Array = model.body_inertia;
    inertia[3 * b] = s.torsoInertia[0] as number;
    inertia[3 * b + 1] = s.torsoInertia[1] as number;
    inertia[3 * b + 2] = s.torsoInertia[2] as number;
    ctx.mj.mj_setConst(model, ctx.data);
  }
  if (s.frictionHas) {
    const g = geomId(ctx, FLOOR_GEOM);
    const f: Float64Array = model.geom_friction;
    f[3 * g] = s.floorFriction[0] as number;
    f[3 * g + 1] = s.floorFriction[1] as number;
    f[3 * g + 2] = s.floorFriction[2] as number;
  }
  s.has = false; s.gravityHas = false; s.massHas = false; s.frictionHas = false;
}

function bodyId(ctx: SimContext, name: string): number {
  const id = ctx.ids[`body:${name}`];
  if (id === undefined) throw new Error(`body "${name}" is not resolved in ctx.ids; add it to app.names`);
  return id;
}
function geomId(ctx: SimContext, name: string): number {
  const id = ctx.ids[`geom:${name}`];
  if (id === undefined) throw new Error(`geom "${name}" is not resolved in ctx.ids; add it to app.names`);
  return id;
}

// ---------------------------------------------------------------- templates

/**
 * Push. The Heading and the start time latch on the first call of the Active Phase (the trigger).
 * The force direction is the latched Heading rotated by push.angle: 0 deg pushes along the Heading.
 */
export const push: PerturbationTemplate = {
  phrase: 'the pelvis is pushed with {range:force} for {duration} from {direction} at {phase}',
  dims: (slots) => [
    rangeDim('push.force', slots['force'], 'force', 'up'),
    directionDim(slots['direction']),
    phaseDim(slots['phase']),
  ],
  apply(ctx, t, tTrigger, values) {
    const rt = runtimeFor(ctx);
    const data = ctx.data;
    const b = ctx.ids['body:pelvis'] as number;
    const p = rt.push;
    if (!p.latched) {
      if (!rt.trigger.latched) {
        rt.trigger.latched = true;
        rt.trigger.t = tTrigger;
        const xpos: Float64Array = data.xpos;
        rt.trigger.pos[0] = xpos[3 * b] as number;
        rt.trigger.pos[1] = xpos[3 * b + 1] as number;
        rt.trigger.pos[2] = xpos[3 * b + 2] as number;
        rt.trigger.heading[0] = 1; rt.trigger.heading[1] = 0;
        heading(data.xquat, rt.trigger.heading, 4 * b);
      }
      // `direction` carries a fixed angle; `angle` carries a searched push.angle
      const angle = (values['angle'] ?? values['direction'] ?? 0) as number;
      const c = Math.cos(angle), s = Math.sin(angle);
      const hx = rt.trigger.heading[0] as number, hy = rt.trigger.heading[1] as number;
      p.dirX = c * hx - s * hy;
      p.dirY = s * hx + c * hy;
      p.startTime = tTrigger + pushStartOffset((values['phase'] ?? 0) as number, gaitPhase(tTrigger));
      p.latched = true;
    }
    const duration = values['duration'] as number;
    if (t < p.startTime || t >= p.startTime + duration) return;
    const f = values['force'] as number;
    const xfrc: Float64Array = data.xfrc_applied;
    const r = 6 * b;
    xfrc[r] = f * p.dirX;
    xfrc[r + 1] = f * p.dirY;
    xfrc[r + 2] = 0;
    xfrc[r + 3] = 0; xfrc[r + 4] = 0; xfrc[r + 5] = 0;
  },
  visual(values) {
    const f = values['force'] ?? 0;
    const a = values['angle'] ?? values['direction'] ?? 0;
    return { force: [f * Math.cos(a), f * Math.sin(a), 0], at: PUSH_BODY };
  },
};

/** Slope: gravity tilts about the world y axis from the start of the Active Phase. Geometry is unchanged. */
export const slope: PerturbationTemplate = {
  phrase: 'walking on a slope of {range:angle}',
  dims: (slots) => [rangeDim('slope.angle', slots['angle'], 'angle', 'up')],
  apply(ctx, _t, _tTrigger, values) {
    const rt = runtimeFor(ctx);
    const s = rt.saved;
    if (s.gravityHas) return;
    const g: Float64Array = ctx.model.opt.gravity;
    s.gravity[0] = g[0] as number; s.gravity[1] = g[1] as number; s.gravity[2] = g[2] as number;
    s.gravityHas = true; s.has = true; pendingRestore.set(ctx.model, rt);
    slopeGravity(s.gravity, values['angle'] as number, rt.scratch);
    g[0] = rt.scratch[0] as number; g[1] = rt.scratch[1] as number; g[2] = rt.scratch[2] as number;
  },
};

/**
 * Payload: adds the mass to the torso (pelvis) body from the start of the Active Phase. The inertia
 * scales with the mass (the payload is spread like the torso), then mj_setConst refreshes the
 * derived constants such as subtree masses.
 */
export const payload: PerturbationTemplate = {
  phrase: 'carrying a payload of {range:mass}',
  dims: (slots) => [rangeDim('payload.mass', slots['mass'], 'mass', 'up')],
  apply(ctx, _t, _tTrigger, values) {
    const rt = runtimeFor(ctx);
    const s = rt.saved;
    if (s.massHas) return;
    const model = ctx.model;
    const b = ctx.ids['body:pelvis'] as number;
    const mass: Float64Array = model.body_mass;
    const inertia: Float64Array = model.body_inertia;
    const m0 = mass[b] as number;
    s.torsoMass = m0;
    s.torsoInertia[0] = inertia[3 * b] as number;
    s.torsoInertia[1] = inertia[3 * b + 1] as number;
    s.torsoInertia[2] = inertia[3 * b + 2] as number;
    s.massHas = true; s.has = true; pendingRestore.set(model, rt);
    const add = values['mass'] as number;
    if (add === 0) return;
    const k = (m0 + add) / m0;
    mass[b] = m0 + add;
    inertia[3 * b] = (s.torsoInertia[0] as number) * k;
    inertia[3 * b + 1] = (s.torsoInertia[1] as number) * k;
    inertia[3 * b + 2] = (s.torsoInertia[2] as number) * k;
    ctx.mj.mj_setConst(model, ctx.data);
  },
};

/** Floor friction: the sliding friction of geom `floor` becomes ratio times its original value. */
export const friction: PerturbationTemplate = {
  phrase: 'the floor friction drops to {ratio}',
  dims: (slots) => {
    const r = slots['ratio'];
    if (isQuantity(r)) validateRatio(r.si);
    return [];
  },
  apply(ctx, _t, _tTrigger, values) {
    const rt = runtimeFor(ctx);
    const s = rt.saved;
    if (s.frictionHas) return;
    const g = ctx.ids['geom:floor'] as number;
    const f: Float64Array = ctx.model.geom_friction;
    s.floorFriction[0] = f[3 * g] as number;
    s.floorFriction[1] = f[3 * g + 1] as number;
    s.floorFriction[2] = f[3 * g + 2] as number;
    s.frictionHas = true; s.has = true; pendingRestore.set(ctx.model, rt);
    f[3 * g] = (s.floorFriction[0] as number) * (values['ratio'] as number);
  },
};

/** Sensor latency: the Walker passes the Observation from round(duration / 20 ms) Control_Steps earlier. */
export const latency: PerturbationTemplate = {
  phrase: 'the sensor latency rises to {range:duration}',
  dims: (slots) => [rangeDim('latency.duration', slots['duration'], 'duration', 'up')],
  apply(ctx, _t, _tTrigger, values) {
    runtimeFor(ctx).delaySteps = delaySteps(values['duration'] as number);
  },
};

/** Command: forward speed command.speed, lateral speed 0 m/s, yaw rate 0 rad/s. */
export const command: PerturbationTemplate = {
  phrase: 'commanded to walk at {range:speed}',
  dims: (slots) => [rangeDim('command.speed', slots['speed'], 'speed', 'none')],
  apply(ctx, _t, _tTrigger, values) {
    const c = runtimeFor(ctx).command;
    c[0] = values['speed'] as number; c[1] = 0; c[2] = 0;
  },
};

export const perturbations: PerturbationTemplate[] = [push, slope, payload, friction, latency, command];
