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
import type { PerturbationTemplate, SimContext, SlotDimension } from './contract';
import { candyIds } from './controller/ids';
import { handPose, resolveOverlaps } from './geometry';
import { clamp, runtimeFor } from './runtime';

/** Widest hand speed that apply accepts (m/s). The studio limits a dragged hand to 3 m/s as well. */
export const HAND_SPEED_MAX = 3;

// ---------------------------------------------------------------- slots
//
// golem-ears builds every Dimension from the range written in the line and passes it to `apply` or `begin` under
// the slot name. A slot the phrase carries ({direction}, {range:speed}, {range:duration}, ...) takes its range from
// the line. A hidden slot (`range` declared here) is one the phrase does not carry: the hand's entry time and height
// and the candy placements are part of the scene, not of the requirement text, so the lexicon fixes their ranges.

/** Slots of the hand: `direction` and `speed` come from the line, `entry` and `height` are hidden. */
export const HAND_SLOTS: Record<string, SlotDimension> = {
  direction: { dim: 'hand.angle', severity: 'none' },
  speed: { dim: 'hand.speed', severity: 'up' },
  entry: { dim: 'hand.entry', severity: 'none', range: { kind: 'duration', min: 0, max: HAND_ENTRY_FALLBACK } },
  height: { dim: 'hand.height', severity: 'none', range: { kind: 'length', min: HAND_HEIGHT_RANGE.min, max: HAND_HEIGHT_RANGE.max } },
};

/** The tracker lag comes from `{range:duration}`. */
export const LAG_SLOT: Record<string, SlotDimension> = { duration: { dim: 'tracker.lag', severity: 'up' } };

/** Twelve hidden slots, named like their Dimensions: `candy.<i>.x` and `candy.<i>.y`. */
export function placementSlots(): Record<string, SlotDimension> {
  const slots: Record<string, SlotDimension> = {};
  for (let i = 0; i < CANDY_COUNT; i++) {
    slots[`candy.${i}.x`] = { dim: `candy.${i}.x`, severity: 'none', range: { kind: 'length', min: CANDY_SPAWN.xMin, max: CANDY_SPAWN.xMax } };
    slots[`candy.${i}.y`] = { dim: `candy.${i}.y`, severity: 'none', range: { kind: 'length', min: CANDY_SPAWN.yMin, max: CANDY_SPAWN.yMax } };
  }
  return slots;
}

// ---------------------------------------------------------------- apply and begin bodies

/** Hand mocap pose for the sim time `t`. Allocation-free. */
function applyHand(ctx: SimContext, t: number, tTrigger: number, values: Record<string, number>): void {
  const rt = runtimeFor(ctx);
  const p = rt.pose;
  handPose(p, t, tTrigger, {
    angle: values['direction'] ?? 0,
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
  runtimeFor(ctx).userdata[UD.lag] = clamp(values['duration'] ?? 0, 0, MAX_TRACKER_LAG);
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
  slots: HAND_SLOTS,
  apply: applyHand,
};

export const candiesWeigh: PerturbationTemplate = {
  phrase: 'the candies weigh {range:mass}',
  slots: { mass: { dim: 'candy.mass', severity: 'up' } },
  begin: (ctx, values) => setCandyMass(ctx, values['mass'] as number),
  apply: nothing,
};

export const vacuumWeakens: PerturbationTemplate = {
  phrase: 'the vacuum weakens to {range:ratio}',
  slots: { ratio: { dim: 'vacuum.ratio', severity: 'down' } },
  // The ratio is written as given: the suction model clamps it into [0, 1] and records a warning (requirement 3.12).
  begin: (ctx, values) => { runtimeFor(ctx).userdata[UD.vacuum] = values['ratio'] as number; },
  apply: nothing,
};

export const trackerLags: PerturbationTemplate = {
  phrase: 'the hand tracker lags by {range:duration}',
  slots: LAG_SLOT,
  begin: beginLag,
  apply: nothing,
};

export const candiesLand: PerturbationTemplate = {
  phrase: 'candies land anywhere on the tray',
  slots: placementSlots(),
  begin: beginPlacement,
  apply: nothing,
};

/** A lagging tracker together with a reaching hand: the lag only matters when a hand comes in. */
export const trackerLagsAndHandReaches: PerturbationTemplate = {
  phrase: 'the hand tracker lags by {range:duration} and a hand reaches in from {direction} at {range:speed}',
  slots: { ...LAG_SLOT, ...HAND_SLOTS },
  begin: beginLag,
  apply: applyHand,
};

export const perturbations: PerturbationTemplate[] = [
  handReaches, candiesWeigh, vacuumWeakens, trackerLags, candiesLand, trackerLagsAndHandReaches,
];
