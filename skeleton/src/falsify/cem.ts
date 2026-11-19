// Cross-entropy search: distributions, circular statistics, fitting and sampling.
import type { Dimension, Scenario, ScenarioSpace } from './contract.js';
import { drawTruncatedNormal, normalQuantile } from './normal.js';
import { deriveSeed, mulberry32, SALT } from './prng.js';

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

// ------------------------------------------------------------------ distributions over a space

export interface CemState { dists: DimDist[] }
export interface CemParams { genSize: number; eliteFraction: number; smoothing: number }
export interface Observed { scenario: Scenario; robustness: number; index: number }

export const DEFAULT_CEM: CemParams = { genSize: 16, eliteFraction: 0.25, smoothing: 1 };

/** Returns a message naming the invalid parameter, or undefined when valid. */
export function validateCemParams(p: CemParams): string | undefined {
  if (!Number.isInteger(p.genSize) || p.genSize < 2) {
    return `cem.generationSize must be an integer of at least 2, got ${String(p.genSize)}`;
  }
  if (!(p.eliteFraction > 0 && p.eliteFraction < 1)) {
    return `cem.eliteFraction must be in the open interval (0, 1), got ${String(p.eliteFraction)}`;
  }
  if (!(p.smoothing > 0 && p.smoothing <= 1)) {
    return `cem.smoothing must be in (0, 1], got ${String(p.smoothing)}`;
  }
  return undefined;
}

/** Total order (robustness ascending, index ascending); the first ceil(rho * m) of the non-NaN trials. */
export function selectElites(obs: readonly Observed[], rho: number): Observed[] {
  const ok = obs.filter((o) => !Number.isNaN(o.robustness));
  ok.sort((a, b) => (a.robustness < b.robustness ? -1 : a.robustness > b.robustness ? 1 : a.index - b.index));
  return ok.slice(0, Math.ceil(rho * ok.length));
}

function isFixed(d: Dimension): boolean { return d.min === d.max; }

function priorDist(d: Dimension): DimDist {
  if (isFixed(d)) return { kind: 'fixed' };
  const width = d.max - d.min;
  return { kind: d.wrap === true ? 'wrapped' : 'normal', mu: d.min + width / 2, sigma: 0.25 * width };
}

function fitDim(d: Dimension, elites: readonly Observed[]): DimDist {
  if (isFixed(d)) return { kind: 'fixed' };
  const xs = elites.map((e) => e.scenario[d.name] as number);
  if (d.wrap === true) return fitCircular(xs, d.min, d.max).dist;
  const width = d.max - d.min;
  let mu = 0;
  for (const x of xs) mu += x;
  mu /= xs.length;
  let v = 0;
  for (const x of xs) v += (x - mu) * (x - mu);
  const sigma = Math.max(Math.sqrt(v / xs.length), 0.01 * width);
  return { kind: 'normal', mu: Math.min(d.max, Math.max(d.min, mu)), sigma };
}

/** Initial distribution from Phase 1 observations (midpoint and 25% width when fewer than 2 elites). */
export function initCem(space: ScenarioSpace, phase1: readonly Observed[], p: CemParams): CemState {
  const elites = selectElites(phase1, p.eliteFraction);
  if (elites.length < 2) return { dists: space.dims.map(priorDist) };
  return { dists: space.dims.map((d) => fitDim(d, elites)) };
}

/** Exact refit to the elites of one generation (smoothing 1); keeps `prev` when fewer than 2 elites. */
export function refitCem(
  space: ScenarioSpace, prev: CemState, gen: readonly Observed[], p: CemParams,
): CemState {
  const elites = selectElites(gen, p.eliteFraction);
  if (elites.length < 2) return prev;
  const a = p.smoothing;
  return {
    dists: space.dims.map((d, i) => {
      const fit = fitDim(d, elites);
      const old = prev.dists[i] as DimDist;
      if (a === 1) return fit;
      if (fit.kind === 'normal' && old.kind === 'normal') {
        return { kind: 'normal', mu: a * fit.mu + (1 - a) * old.mu, sigma: a * fit.sigma + (1 - a) * old.sigma };
      }
      if (fit.kind === 'wrapped' && old.kind === 'wrapped') {
        return {
          kind: 'wrapped',
          mu: blendCircular(old.mu, fit.mu, a, d.min, d.max),
          sigma: a * fit.sigma + (1 - a) * old.sigma,
        };
      }
      return fit;
    }),
  };
}

/** Dimension-major sampling from one stream per generation. */
export function sampleCem(
  space: ScenarioSpace, state: CemState, n: number, searchSeed: number, generation: number,
): Scenario[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`cem: invalid n=${String(n)}`);
  const out: Scenario[] = Array.from({ length: n }, () => ({}));
  const rng = mulberry32(deriveSeed(searchSeed, SALT.cem, generation));
  space.dims.forEach((d, di) => {
    const dist = state.dists[di] as DimDist;
    for (let i = 0; i < n; i++) {
      let v: number;
      if (isFixed(d) || dist.kind === 'fixed') v = d.min;
      else if (dist.kind === 'uniformCircle') v = wrapInto(d.min + rng() * (d.max - d.min), d.min, d.max);
      else if (dist.kind === 'wrapped') v = drawWrappedNormal(dist.mu, dist.sigma, d.min, d.max, rng());
      else v = drawTruncatedNormal(dist.mu, dist.sigma, d.min, d.max, rng());
      (out[i] as Scenario)[d.name] = v;
    }
  });
  return out;
}