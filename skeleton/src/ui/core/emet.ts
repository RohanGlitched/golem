// Emet: where the incised word sits on the head, and which letters it shows. Pure.
import type { LineStatus } from '../types.js';

export const EMET_HINT = 'In the legend, erasing one letter unmakes the golem.';
export const HEAD_BAND = 0.18;
export const WIDTH_MIN = 0.02;
export const WIDTH_MAX = 0.2;
/** Seconds to crumble the first "e" away, and to re-form it. */
export const CRUMBLE_S = 0.9;
export const REFORM_S = 0.6;

export type EmetWord = 'emet' | 'met';

export interface ForeheadSpot { at: [number, number, number]; normal: [number, number, number]; width: number }

/**
 * The forehead of a body from its drawn vertices (x, y, z triples in the body frame, z up, x forward): the top 18 %
 * of the body's height is the head; the decal sits 40 % down that band, on its frontmost point, centred across it.
 */
export function foreheadSpot(points: ArrayLike<number>): ForeheadSpot | undefined {
  const n = Math.floor(points.length / 3);
  if (n === 0) return undefined;
  let zTop = -Infinity, zMin = Infinity;
  for (let i = 0; i < n; i++) {
    const z = points[3 * i + 2] as number;
    if (!Number.isFinite(z)) continue;
    if (z > zTop) zTop = z;
    if (z < zMin) zMin = z;
  }
  if (!(zTop >= zMin)) return undefined;
  const band0 = zTop - HEAD_BAND * (zTop - zMin);
  let bMin = Infinity, yLo = Infinity, yHi = -Infinity;
  for (let i = 0; i < n; i++) {
    const z = points[3 * i + 2] as number, y = points[3 * i + 1] as number;
    if (!(z >= band0) || !Number.isFinite(y)) continue;
    if (z < bMin) bMin = z;
    if (y < yLo) yLo = y;
    if (y > yHi) yHi = y;
  }
  const bh = zTop - bMin;
  const zF = zTop - 0.4 * bh;
  const tol = 0.15 * bh;
  let xF = -Infinity, sLo = Infinity, sHi = -Infinity;
  for (let pass = 0; pass < 2 && xF === -Infinity; pass++) {
    for (let i = 0; i < n; i++) {
      const x = points[3 * i] as number, y = points[3 * i + 1] as number, z = points[3 * i + 2] as number;
      if (!(z >= band0) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (pass === 0 && Math.abs(z - zF) > tol) continue;
      if (x > xF) xF = x;
      if (y < sLo) sLo = y;
      if (y > sHi) sHi = y;
    }
  }
  if (xF === -Infinity) return undefined;
  const w = 0.55 * (yHi - yLo);
  const width = w > WIDTH_MAX ? WIDTH_MAX : w > WIDTH_MIN ? w : WIDTH_MIN;
  return { at: [xF, (sLo + sHi) / 2, zF], normal: [1, 0, 0], width };
}

/** The word the decal shows for the selected line: a broken line reads "met"; a running line keeps the last word. */
export function emetTarget(status: LineStatus | undefined, prev: EmetWord): EmetWord {
  if (status === 'broken') return 'met';
  if (status === 'running') return prev;
  return 'emet';
}

/** Crumble amount (0 whole, 1 gone) after `dt` seconds of animating toward `word`. */
export function stepCrumble(c: number, word: EmetWord, dt: number, reduced: boolean): number {
  const goal = word === 'met' ? 1 : 0;
  if (reduced || !(dt >= 0)) return goal;
  const rate = goal > c ? 1 / CRUMBLE_S : 1 / REFORM_S;
  const next = c + Math.sign(goal - c) * rate * dt;
  return goal > c ? Math.min(goal, next) : Math.max(goal, next);
}
