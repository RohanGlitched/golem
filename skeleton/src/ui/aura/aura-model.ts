// Aura data: 36 direction bins of the strongest push held and the weakest push that broke.
// Pure, no three.js. The view (aura-view.ts) encodes these bins into a 36x1 texture.
import type { Dimension, ScenarioSpace } from '../types.js';

export const AURA_BINS = 36;
export const AURA_RMAX = 1.2;
export const TICK_CAPACITY = 512;
const TAU = 2 * Math.PI;

/** Bin of an angle (radians, world azimuth): wraps, floor(frac * 36), clamped to 35. */
export function binOf(angle: number): number {
  const turns = angle / TAU;
  const frac = turns - Math.floor(turns);
  const b = Math.floor(frac * AURA_BINS);
  return b > AURA_BINS - 1 ? AURA_BINS - 1 : b < 0 ? 0 : b;
}

/** Centre direction of bin i in degrees: 5 + 10 i. */
export const binCentreDeg = (i: number): number => 5 + 10 * i;

/** The force and direction dimensions the Aura reads: the first of kind force and of kind angle. */
export function auraDims(space: ScenarioSpace): { force: Dimension; angle: Dimension } | undefined {
  const force = space.dims.find((d) => d.kind === 'force');
  const angle = space.dims.find((d) => d.kind === 'angle');
  return force && angle ? { force, angle } : undefined;
}

export interface Tick { angle: number; force: number }

const tickLess = (a: Tick, b: Tick): boolean => a.force < b.force || (a.force === b.force && a.angle < b.angle);

export class AuraModel {
  readonly held = new Float64Array(AURA_BINS).fill(-Infinity);
  readonly broke = new Float64Array(AURA_BINS).fill(Infinity);
  /** The lowest 512 broken trials by (force, angle). Sorted, so the list is order independent. */
  readonly ticks: Tick[] = [];
  ignored = 0;
  total = 0;

  constructor(public forceMax: number) {}

  add(angle: number, force: number, robustness: number): void {
    this.total++;
    if (Number.isNaN(robustness) || !Number.isFinite(angle) || !Number.isFinite(force)) { this.ignored++; return; }
    const b = binOf(angle);
    if (robustness >= 0) {
      if (force > (this.held[b] as number)) this.held[b] = force;
      return;
    }
    if (force < (this.broke[b] as number)) this.broke[b] = force;
    const t: Tick = { angle, force };
    const ticks = this.ticks;
    if (ticks.length >= TICK_CAPACITY && !tickLess(t, ticks[ticks.length - 1] as Tick)) return;
    let lo = 0, hi = ticks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tickLess(ticks[mid] as Tick, t) || !tickLess(t, ticks[mid] as Tick)) lo = mid + 1; else hi = mid;
    }
    ticks.splice(lo, 0, t);
    if (ticks.length > TICK_CAPACITY) ticks.pop();
  }

  reset(forceMax = this.forceMax): void {
    this.forceMax = forceMax;
    this.held.fill(-Infinity);
    this.broke.fill(Infinity);
    this.ticks.length = 0;
    this.ignored = 0;
    this.total = 0;
  }
}

/** Broke_Force, else Held_Force, else undefined. */
export function boundaryForce(m: AuraModel, i: number): number | undefined {
  const br = m.broke[i] as number;
  if (br !== Infinity) return br;
  const h = m.held[i] as number;
  if (h !== -Infinity) return h;
  return undefined;
}

/** Boundary radius of bin i in metres: 1.2 * min(1, B / forceMax), 0 when unknown. */
export function binRadius(m: AuraModel, i: number): number {
  const B = boundaryForce(m, i);
  if (B === undefined || !(m.forceMax > 0)) return 0;
  const r = B / m.forceMax;
  return AURA_RMAX * (r < 0 ? 0 : r > 1 ? 1 : r);
}

/** CPU reference of the shader: linear interpolation between the two nearest bin centres, wrapping. */
export function radiusAt(m: AuraModel, angle: number): number {
  const turns = angle / TAU;
  const u = (turns - Math.floor(turns)) * AURA_BINS - 0.5;
  const i0 = Math.floor(u);
  const w = u - i0;
  const a = ((i0 % AURA_BINS) + AURA_BINS) % AURA_BINS;
  const b = (a + 1) % AURA_BINS;
  return (1 - w) * binRadius(m, a) + w * binRadius(m, b);
}

/** Writes the 36 RGBA texels: R = round(255 R_i / 1.2), G = 255 when the bin has a break. */
export function encodeTexels(m: AuraModel, out: Uint8Array): void {
  for (let i = 0; i < AURA_BINS; i++) {
    const o = 4 * i;
    out[o] = Math.round((255 * binRadius(m, i)) / AURA_RMAX);
    out[o + 1] = (m.broke[i] as number) !== Infinity ? 255 : 0;
    out[o + 2] = 0;
    out[o + 3] = 255;
  }
}
