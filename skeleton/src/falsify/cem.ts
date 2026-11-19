// Cross-entropy search: distributions, circular statistics, fitting and sampling.
import { normalQuantile } from './normal.js';

export type DimDist =
  | { kind: 'normal'; mu: number; sigma: number }
  | { kind: 'wrapped'; mu: number; sigma: number }
  | { kind: 'uniformCircle' }
  | { kind: 'fixed' };

const TWO_PI = 2 * Math.PI;
const TWO_NEG_53 = 2 ** -53;

/** Maps any finite x onto [min, max) for a circle of circumference max - min. */
export function wrapInto(x: number, min: number, max: number): number {
  const width = max - min;
  const d = x - min;
  const r = d - width * Math.floor(d / width);
  if (!(r >= 0) || r >= width) return min;
  const v = min + r;
  return v >= max ? min : v;
}

/** Wrapped normal draw from one uniform: value in [min, max). */
export function drawWrappedNormal(mu: number, sigma: number, min: number, max: number, u: number): number {
  const z = normalQuantile(Math.max(u, TWO_NEG_53));
  return wrapInto(mu + sigma * z, min, max);
}

export interface CircularFit { dist: DimDist; R: number }

/**
 * Circular fit of `values` (at least 1) on [min, max): atan2 mean, mean resultant length R,
 * `uniformCircle` when R < 1e-3, sigma = sqrt(-2 ln R) mapped to the dimension width, floored at 1% of width.
 */
export function fitCircular(values: readonly number[], min: number, max: number): CircularFit {
  const width = max - min;
  let c = 0;
  let s = 0;
  for (const x of values) {
    const th = (TWO_PI * (x - min)) / width;
    c += Math.cos(th);
    s += Math.sin(th);
  }
  c /= values.length;
  s /= values.length;
  const R = Math.sqrt(c * c + s * s);
  if (R < 1e-3) return { dist: { kind: 'uniformCircle' }, R };
  let muTheta = Math.atan2(s, c);
  if (muTheta < 0) muTheta += TWO_PI;
  const mu = wrapInto(min + (muTheta / TWO_PI) * width, min, max);
  const Rc = Math.min(R, 1 - 1e-12);
  const sigmaTheta = Math.sqrt(-2 * Math.log(Rc));
  const sigma = Math.max((sigmaTheta / TWO_PI) * width, 0.01 * width);
  return { dist: { kind: 'wrapped', mu, sigma }, R };
}

/** prev moved toward fit by `alpha` along the shortest arc of the circle [min, max). */
export function blendCircular(prev: number, fit: number, alpha: number, min: number, max: number): number {
  const width = max - min;
  let delta = fit - prev;
  delta -= width * Math.round(delta / width);
  return wrapInto(prev + alpha * delta, min, max);
}
