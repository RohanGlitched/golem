// The Hover perturbations: a horizontal gust, a battery that sags, and a position estimate that lags.
//
// golem-sim calls `apply(ctx, t, tTrigger, values)` before every Sim_Step of the Active Phase and `begin(ctx, values)`
// once at the trigger. The gust acts in `apply` (the runner clears xfrc_applied before every step, so each call only
// writes the force while the gust lasts). The battery and the lag are set-up edits that act in `begin`: the runner
// restores the whole model after every trial, so the thrust scale needs no undo code. Nothing in `apply` allocates.
import { MAX_LAG, MIN_BATTERY } from './constants';
import type { PerturbationTemplate, SimContext, SlotDimension } from './contract';
import { clamp, runtimeFor } from './runtime';

// ---------------------------------------------------------------- slots

/**
 * The gust. `direction` is the side the gust comes FROM, counterclockwise from +x seen from above (0 deg from +x,
 * 90 deg from +y), the same convention as the G1's push.angle. The force points away from that side.
 */
export const GUST_SLOTS: Record<string, SlotDimension> = {
  force: { dim: 'gust.force', severity: 'up' },
  direction: { dim: 'gust.angle', severity: 'none' },
};

/** The lag of the lag-only phrase. */
export const LAG_SLOT: Record<string, SlotDimension> = { duration: { dim: 'estimate.lag', severity: 'up' } };

// ---------------------------------------------------------------- bodies

/** The horizontal force (N) of a gust from `angle` (rad) at strength `force` (N), written into `out[0..1]`. */
export function gustForce(force: number, angle: number, out: Float64Array): void {
  out[0] = -force * Math.cos(angle);
  out[1] = -force * Math.sin(angle);
}

const scratch = new Float64Array(2);

function applyGust(ctx: SimContext, t: number, tTrigger: number, values: Record<string, number>): void {
  const dt = t - tTrigger;
  const duration = values['duration'] ?? 0;
  if (!(dt >= 0 && dt < duration)) return;
  gustForce(values['force'] ?? 0, values['direction'] ?? 0, scratch);
  const rt = runtimeFor(ctx);
  const r = rt.bodyRow;
  rt.xfrc[r] = scratch[0] as number;
  rt.xfrc[r + 1] = scratch[1] as number;
  rt.xfrc[r + 2] = 0;
  rt.xfrc[r + 3] = 0; rt.xfrc[r + 4] = 0; rt.xfrc[r + 5] = 0;
}

/**
 * Scales the thrust of every motor, and with it the yaw reaction torque, by `ratio`: the same command now makes less
 * thrust, and the largest thrust falls by the same factor. The ratio is limited to [MIN_BATTERY, 1].
 */
export function sagBattery(ctx: SimContext, ratio: number): void {
  const k = clamp(ratio, MIN_BATTERY, 1);
  const gear: Float64Array = ctx.model.actuator_gear;
  const nu: number = ctx.model.nu;
  for (let a = 0; a < nu; a++) {
    gear[6 * a + 2] = (gear[6 * a + 2] as number) * k;
    gear[6 * a + 5] = (gear[6 * a + 5] as number) * k;
  }
}

function setLag(ctx: SimContext, lag: number): void {
  runtimeFor(ctx).lag = clamp(lag, 0, MAX_LAG);
}

const nothing = (): void => undefined;

// ---------------------------------------------------------------- templates

export const gustHits: PerturbationTemplate = {
  phrase: 'a gust of {range:force} hits it for {duration} from {direction}',
  slots: GUST_SLOTS,
  apply: applyGust,
  visual(values) {
    const f = values['force'] ?? 0, a = values['direction'] ?? 0;
    return { force: [-f * Math.cos(a), -f * Math.sin(a), 0], at: 'x2' };
  },
};

export const batterySags: PerturbationTemplate = {
  phrase: 'the battery sags to {range:ratio}',
  slots: { ratio: { dim: 'battery.ratio', severity: 'down' } },
  begin: (ctx, values) => sagBattery(ctx, values['ratio'] as number),
  apply: nothing,
};

export const estimateLags: PerturbationTemplate = {
  phrase: 'the position estimate lags by {range:duration}',
  slots: LAG_SLOT,
  begin: (ctx, values) => setLag(ctx, values['duration'] as number),
  apply: nothing,
};

/** A lagging estimate together with a gust: the lag only matters when something moves the drone. */
export const gustAndLag: PerturbationTemplate = {
  phrase: 'a gust of {range:force} hits it for {duration} from {direction} while the position estimate lags by {range:duration}',
  // the first duration is the gust's, the second (duration2) is the lag
  slots: { ...GUST_SLOTS, duration2: { dim: 'estimate.lag', severity: 'up' } },
  begin: (ctx, values) => setLag(ctx, values['duration2'] as number),
  apply: applyGust,
  visual: gustHits.visual!,
};

export const perturbations: PerturbationTemplate[] = [gustHits, batterySags, estimateLags, gustAndLag];
