// Cross-entropy search: distributions, circular statistics, fitting and sampling.
import type { Dimension, Scenario, ScenarioSpace } from './contract.js';
import { drawTruncatedNormal, normalQuantile } from './normal.js';
import { latinHypercube } from './lhs.js';
import { deriveSeed, mulberry32, SALT } from './prng.js';

export type DimDist =
  | { kind: 'normal'; mu: number; sigma: number }
  | { kind: 'wrapped'; mu: number; sigma: number }
  | { kind: 'uniform' }
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

/**
 * `carried`: the best observations so far (at most `ceil(eliteFraction * genSize)`, in the total order),
 * added to the next generation before elites are chosen (elitism, golem-falsify-hardening defect 2).
 */
export interface CemState { dists: DimDist[]; carried: Observed[] }
export interface CemParams { genSize: number; eliteFraction: number; smoothing: number; lhsFraction: number }
/** `index` is the run order (Phase 1 index, then n1 + Phase 2 index): it breaks ties in the total order. */
export interface Observed { scenario: Scenario; robustness: number; index: number }

export const DEFAULT_CEM: CemParams = { genSize: 32, eliteFraction: 0.25, smoothing: 1, lhsFraction: 0.2 };

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
  if (!(p.lhsFraction >= 0 && p.lhsFraction < 1)) {
    return `cem.lhsFraction must be in [0, 1), got ${String(p.lhsFraction)}`;
  }
  return undefined;
}

const byTotalOrder = (a: Observed, b: Observed): number =>
  (a.robustness < b.robustness ? -1 : a.robustness > b.robustness ? 1 : a.index - b.index);

/** Total order (robustness ascending, index ascending); the first ceil(rho * m) of the non-NaN trials. */
export function selectElites(obs: readonly Observed[], rho: number): Observed[] {
  const ok = obs.filter((o) => !Number.isNaN(o.robustness));
  ok.sort(byTotalOrder);
  return ok.slice(0, Math.ceil(rho * ok.length));
}

/**
 * Tie-aware elite set. With `γ` the robustness of the `slots`-th observation in the total order, the
 * elites are every non-NaN observation with robustness `<= γ`, so ties enter together and the index
 * never decides membership. `informative` is false when every observation has the same robustness:
 * the robustness then says nothing about where to look.
 */
export function eliteSet(obs: readonly Observed[], slots: number): { elites: Observed[]; informative: boolean } {
  const ok = obs.filter((o) => !Number.isNaN(o.robustness));
  ok.sort(byTotalOrder);
  if (ok.length === 0 || slots < 1) return { elites: [], informative: false };
  const gamma = (ok[Math.min(slots, ok.length) - 1] as Observed).robustness;
  let atOrBelow = 0;
  for (const o of ok) if (o.robustness <= gamma) atOrBelow++;
  const elites = ok.slice(0, atOrBelow);
  const informative = (ok[0] as Observed).robustness !== (ok[ok.length - 1] as Observed).robustness;
  return { elites, informative };
}

function isFixed(d: Dimension): boolean { return d.min === d.max; }

/** The no-information distribution: uniform on every non-fixed dimension. */
function uniformDist(d: Dimension): DimDist {
  if (isFixed(d)) return { kind: 'fixed' };
  return d.wrap === true ? { kind: 'uniformCircle' } : { kind: 'uniform' };
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

const slotsOf = (p: CemParams): number => Math.ceil(p.eliteFraction * p.genSize);

/**
 * Initial distribution from Phase 1: the fit to the tie-aware elites (`ceil(rho * n1)` slots), or the
 * uniform distribution when Phase 1 has fewer than 2 trials, is uninformative or gives fewer than 2 elites.
 */
export function initCem(space: ScenarioSpace, phase1: readonly Observed[], p: CemParams): CemState {
  const ok = phase1.filter((o) => !Number.isNaN(o.robustness)).sort(byTotalOrder);
  const carried = ok.slice(0, slotsOf(p));
  const { elites, informative } = eliteSet(ok, Math.ceil(p.eliteFraction * ok.length));
  if (!informative || elites.length < 2) return { dists: space.dims.map(uniformDist), carried };
  return { dists: space.dims.map((d) => fitDim(d, elites)), carried };
}

/**
 * Refit after one generation: elites of (carried ∪ generation) with `ceil(rho * genSize)` slots.
 * Fewer than 2 usable observations keeps `prev`; uninformative gives the uniform distribution;
 * fewer than 2 elites keeps `prev`.
 */
export function refitCem(
  space: ScenarioSpace, prev: CemState, gen: readonly Observed[], p: CemParams,
): CemState {
  const pool = [...prev.carried, ...gen].filter((o) => !Number.isNaN(o.robustness)).sort(byTotalOrder);
  if (pool.length < 2) return prev;
  const slots = slotsOf(p);
  const carried = pool.slice(0, slots);
  const { elites, informative } = eliteSet(pool, slots);
  if (!informative) return { dists: space.dims.map(uniformDist), carried };
  if (elites.length < 2) return prev;
  const a = p.smoothing;
  return {
    carried,
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

/** Positions of the LHS draws in a generation of size `G` with `m` LHS draws (interleaved). */
export function isLhsPosition(i: number, m: number, G: number): boolean {
  return Math.floor(((i + 1) * m) / G) > Math.floor((i * m) / G);
}

/**
 * Phase 2 generation `g`: `m = round(lhsFraction * G)` Latin-hypercube draws (stream
 * `deriveSeed(searchSeed, SALT.cemLhs, 0)`, generation `g`) interleaved with `G - m` CEM draws, and
 * then the first `n` (the generation prefix, so a shortened generation is a prefix of the full one).
 * When the state is uniform on every dimension (no information), the whole generation is LHS, the
 * same distribution random-only search uses.
 */
export function sampleGeneration(
  space: ScenarioSpace, state: CemState, G: number, n: number, lhsFraction: number, searchSeed: number, generation: number,
): Scenario[] {
  if (!Number.isInteger(G) || G < 0 || !Number.isInteger(n) || n < 0 || n > G) {
    throw new RangeError(`cem: invalid generation size G=${String(G)}, n=${String(n)}`);
  }
  const uninformed = state.dists.every((d) => d.kind === 'uniform' || d.kind === 'uniformCircle' || d.kind === 'fixed');
  const m = uninformed ? G : Math.round(lhsFraction * G);
  const cem = sampleCem(space, state, G - m, searchSeed, generation);
  const lhs = latinHypercube(space, m, deriveSeed(searchSeed, SALT.cemLhs, 0), generation);
  const out: Scenario[] = [];
  let ci = 0;
  let li = 0;
  for (let i = 0; i < n; i++) out.push(isLhsPosition(i, m, G) ? (lhs[li++] as Scenario) : (cem[ci++] as Scenario));
  return out;
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
      else if (dist.kind === 'uniform') v = Math.min(d.max, d.min + rng() * (d.max - d.min));
      else if (dist.kind === 'uniformCircle') v = wrapInto(d.min + rng() * (d.max - d.min), d.min, d.max);
      else if (dist.kind === 'wrapped') v = drawWrappedNormal(dist.mu, dist.sigma, d.min, d.max, rng());
      else v = drawTruncatedNormal(dist.mu, dist.sigma, d.min, d.max, rng());
      (out[i] as Scenario)[d.name] = v;
    }
  });
  return out;
}