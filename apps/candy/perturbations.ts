// The Candy perturbations: a hand that reaches in, heavier candies, a weaker vacuum, a lagging hand tracker, and
// candies that land anywhere on the tray.
//
// golem-sim calls `apply(ctx, t, tTrigger, values)` before every Sim_Step of the Active Phase, and `begin(ctx, values)`
// once at the trigger. The setup perturbations (mass, vacuum, lag, placement) act in `begin`: the Episode_Runner
// restores the whole model after every trial, so the mass edit needs no undo code here. `apply` of the hand only
// writes the mocap pose. Nothing in apply allocates.
import {
  CANDY_COUNT, CANDY_HALF_HEIGHT, CANDY_MASS_RANGE, CANDY_SPAWN, HAND_ENTRY_FALLBACK, HAND_HEIGHT_RANGE, MAX_TRACKER_LAG, UD,
} from './constants';
import type { Dimension, PerturbationTemplate, Quantity, SimContext, Slots } from './contract';
import { candyIds } from './controller/ids';
import { handPose, resolveOverlaps } from './geometry';
import { clamp, runtimeFor } from './runtime';

const TWO_PI = 2 * Math.PI;
/** Widest hand speed that apply accepts (m/s). The studio limits a dragged hand to 3 m/s as well. */
export const HAND_SPEED_MAX = 3;

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
  const base = { name: 'hand.angle', kind: 'angle' as const, severity: 'none' as const };
  if (v === 'any direction') return { ...base, wrap: true, min: 0, max: TWO_PI };
  if (v === 'behind') return { ...base, wrap: true, min: (3 * Math.PI) / 4, max: (5 * Math.PI) / 4 };
  if (isQuantity(v)) return { ...base, min: v.si, max: v.si };
  throw new Error(`hand.angle: unknown direction '${String(v)}'`);
}

/** The requirement horizon, if the compiler passed it as the hidden `horizon` slot; the fallback otherwise. */
function horizonOf(slots: Slots): number {
  const h = slots['horizon'];
  return isQuantity(h) && h.si > 0 ? h.si : HAND_ENTRY_FALLBACK;
}

/**
 * The compiler turns a slot into a perturbation parameter only when a Dimension name ends with the slot name. These
 * Dimensions (hand.angle, hand.entry, hand.height, tracker.lag, candy.<i>.x) have no slot of their own in the phrase,
 * so their values would never reach `apply`. This adds a placeholder slot with the Dimension's short name, which
 * makes the compiler pass the Dimension through. It is a workaround for golem-ears and is harmless once the compiler
 * passes every Dimension itself (see proposals.md).
 */
function exposeDims(slots: Slots, dims: readonly Dimension[]): void {
  for (const d of dims) {
    const short = d.name.slice(d.name.lastIndexOf('.') + 1);
    const key = /^candy\.\d\.[xy]$/.test(d.name) ? d.name : short;
    if (!(key in slots)) {
      try { slots[key] = ''; } catch { /* a frozen slot object: the compiler then has to pass the Dimension itself */ }
    }
  }
}

// ---------------------------------------------------------------- dimensions

export function handDims(slots: Slots): Dimension[] {
  return [
    directionDim(slots['direction']),
    rangeDim('hand.speed', slots['speed'], 'speed', 'up'),
    { name: 'hand.entry', kind: 'duration', min: 0, max: horizonOf(slots), severity: 'none' },
    { name: 'hand.height', kind: 'length', min: HAND_HEIGHT_RANGE.min, max: HAND_HEIGHT_RANGE.max, severity: 'none' },
  ];
}

export function lagDim(slots: Slots): Dimension {
  return rangeDim('tracker.lag', slots['duration'], 'duration', 'up');
}

export function placementDims(): Dimension[] {
  const dims: Dimension[] = [];
  for (let i = 0; i < CANDY_COUNT; i++) {
    dims.push({ name: `candy.${i}.x`, kind: 'length', min: CANDY_SPAWN.xMin, max: CANDY_SPAWN.xMax, severity: 'none' });
    dims.push({ name: `candy.${i}.y`, kind: 'length', min: CANDY_SPAWN.yMin, max: CANDY_SPAWN.yMax, severity: 'none' });
  }
  return dims;
}

// ---------------------------------------------------------------- apply and begin bodies

/** Hand mocap pose for the sim time `t`. Allocation-free. */
function applyHand(ctx: SimContext, t: number, tTrigger: number, values: Record<string, number>): void {
  const rt = runtimeFor(ctx);
  const p = rt.pose;
  handPose(p, t, tTrigger, {
    angle: values['angle'] ?? values['direction'] ?? 0,
    speed: clamp(values['speed'] ?? 0, 0, HAND_SPEED_MAX),
    entry: clamp(values['entry'] ?? 0, 0, Infinity),
    height: clamp(values['height'] ?? HAND_HEIGHT_RANGE.max, HAND_HEIGHT_RANGE.min, HAND_HEIGHT_RANGE.max),
  });
  const m = rt.hand;
  rt.mocapPos[3 * m] = p[0] as number; rt.mocapPos[3 * m + 1] = p[1] as number; rt.mocapPos[3 * m + 2] = p[2] as number;
  const half = 0.5 * (p[3] as number);
  rt.mocapQuat[4 * m] = Math.cos(half); rt.mocapQuat[4 * m + 1] = 0; rt.mocapQuat[4 * m + 2] = 0; rt.mocapQuat[4 * m + 3] = Math.sin(half);
}

function beginLag(ctx: SimContext, values: Record<string, number>): void {
  runtimeFor(ctx).userdata[UD.lag] = clamp(values['lag'] ?? 0, 0, MAX_TRACKER_LAG);
}

/**
 * Recomputes the constants that depend on the masses (subtree masses, inverse weights). mj_setConst resets the data it
 * is given to the model's reference state, so it runs on a scratch MjData: the live trial state stays as it is.
 */
export function refreshConstants(ctx: SimContext): void {
  const scratch = new ctx.mj.MjData(ctx.model);
  try { ctx.mj.mj_setConst(ctx.model, scratch); } finally { scratch.delete(); }
}

/** Sets every candy to `mass` kg, scaling its inertia by the same factor, then refreshes the derived constants. */
export function setCandyMass(ctx: SimContext, mass: number): void {
  const m = clamp(mass, CANDY_MASS_RANGE.min, CANDY_MASS_RANGE.max);
  const model = ctx.model;
  const body: Float64Array = model.body_mass;
  const inertia: Float64Array = model.body_inertia;
  const ids = candyIds(ctx);
  for (let i = 0; i < CANDY_COUNT; i++) {
    const b = ids.candyBody[i] as number;
    const k = m / (body[b] as number);
    if (k === 1) continue;
    body[b] = m;
    inertia[3 * b] = (inertia[3 * b] as number) * k;
    inertia[3 * b + 1] = (inertia[3 * b + 1] as number) * k;
    inertia[3 * b + 2] = (inertia[3 * b + 2] as number) * k;
  }
  refreshConstants(ctx);
}

/** Puts each candy at its scenario position (after the overlap rule) at rest on the tray. */
export function placeCandies(ctx: SimContext, xy: Float64Array): void {
  resolveOverlaps(xy);
  const ids = candyIds(ctx);
  const qpos: Float64Array = ctx.data.qpos;
  const qvel: Float64Array = ctx.data.qvel;
  for (let i = 0; i < CANDY_COUNT; i++) {
    const q = ids.candyQpos[i] as number, d = ids.candyDof[i] as number;
    qpos[q] = xy[2 * i] as number; qpos[q + 1] = xy[2 * i + 1] as number; qpos[q + 2] = CANDY_HALF_HEIGHT[i] as number;
    qpos[q + 3] = 1; qpos[q + 4] = 0; qpos[q + 5] = 0; qpos[q + 6] = 0;
    for (let k = 0; k < 6; k++) qvel[d + k] = 0;
  }
}

function beginPlacement(ctx: SimContext, values: Record<string, number>): void {
  const xy = runtimeFor(ctx).xy;
  for (let i = 0; i < CANDY_COUNT; i++) {
    xy[2 * i] = clamp(values[`candy.${i}.x`] ?? CANDY_SPAWN.xMin, CANDY_SPAWN.xMin, CANDY_SPAWN.xMax);
    xy[2 * i + 1] = clamp(values[`candy.${i}.y`] ?? 0, CANDY_SPAWN.yMin, CANDY_SPAWN.yMax);
  }
  placeCandies(ctx, xy);
}

const nothing = (): void => undefined;

// ---------------------------------------------------------------- templates

export const handReaches: PerturbationTemplate = {
  phrase: 'a hand reaches in from {direction} at {range:speed}',
  dims: (slots) => { const d = handDims(slots); exposeDims(slots, d); return d; },
  apply: applyHand,
};

export const candiesWeigh: PerturbationTemplate = {
  phrase: 'the candies weigh {range:mass}',
  dims: (slots) => [rangeDim('candy.mass', slots['mass'], 'mass', 'up')],
  begin: (ctx, values) => setCandyMass(ctx, values['mass'] as number),
  apply: nothing,
};

export const vacuumWeakens: PerturbationTemplate = {
  phrase: 'the vacuum weakens to {range:ratio}',
  dims: (slots) => [rangeDim('vacuum.ratio', slots['ratio'], 'ratio', 'down')],
  // The ratio is written as given: the suction model clamps it into [0, 1] and records a warning (requirement 3.12).
  begin: (ctx, values) => { runtimeFor(ctx).userdata[UD.vacuum] = values['ratio'] as number; },
  apply: nothing,
};

export const trackerLags: PerturbationTemplate = {
  phrase: 'the hand tracker lags by {range:duration}',
  dims: (slots) => { const d = [lagDim(slots)]; exposeDims(slots, d); return d; },
  begin: beginLag,
  apply: nothing,
};

export const candiesLand: PerturbationTemplate = {
  phrase: 'candies land anywhere on the tray',
  dims: (slots) => { const d = placementDims(); exposeDims(slots, d); return d; },
  begin: beginPlacement,
  apply: nothing,
};

/** A lagging tracker together with a reaching hand: the lag only matters when a hand comes in. */
export const trackerLagsAndHandReaches: PerturbationTemplate = {
  phrase: 'the hand tracker lags by {range:duration} and a hand reaches in from {direction} at {range:speed}',
  dims: (slots) => { const d = [lagDim(slots), ...handDims(slots)]; exposeDims(slots, d); return d; },
  begin: beginLag,
  apply: applyHand,
};

export const perturbations: PerturbationTemplate[] = [
  handReaches, candiesWeigh, vacuumWeakens, trackerLags, candiesLand, trackerLagsAndHandReaches,
];
