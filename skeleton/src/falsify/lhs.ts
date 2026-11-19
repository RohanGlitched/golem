// Latin hypercube sampler: one sample per stratum in every non-fixed dimension.
import type { Scenario, ScenarioSpace } from './contract.js';
import { deriveSeed, fmix32, hashString, mulberry32, SALT } from './prng.js';

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

/** Largest double below x (x finite, x > 0 or x < 0). */
export function prevDouble(x: number): number {
  if (x === 0) return -Number.MIN_VALUE;
  f64[0] = x;
  const bits = u64[0] as bigint;
  u64[0] = x > 0 ? bits - 1n : bits + 1n;
  return f64[0] as number;
}

export function latinHypercube(
  space: ScenarioSpace, n: number, searchSeed: number, generation: number,
): Scenario[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`lhs: invalid n=${String(n)}`);
  for (const d of space.dims) {
    const bad = !Number.isFinite(d.min) || !Number.isFinite(d.max) || d.min > d.max;
    if (bad) throw new RangeError(`lhs: invalid bounds for dimension "${d.name}": min=${d.min}, max=${d.max}`);
  }
  if (n === 0) return [];
  const out: Scenario[] = Array.from({ length: n }, () => ({}));
  const genSeed = deriveSeed(searchSeed, SALT.lhs, generation);
  for (const d of space.dims) {
    if (d.min === d.max) {
      for (let i = 0; i < n; i++) (out[i] as Scenario)[d.name] = d.min;
      continue;
    }
    const rng = mulberry32(fmix32((genSeed ^ hashString(d.name)) >>> 0));
    const perm = new Array<number>(n);
    for (let i = 0; i < n; i++) perm[i] = i;
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = perm[i] as number; perm[i] = perm[j] as number; perm[j] = t;
    }
    const width = d.max - d.min;
    const wrapMax = d.wrap === true ? prevDouble(d.max) : d.max;
    for (let i = 0; i < n; i++) {
      const stratum = perm[i] as number;
      const u = rng();
      let v = d.min + ((stratum + u) / n) * width;
      if (d.wrap === true) {
        if (v >= d.max) v = wrapMax;
      } else if (v > d.max) v = d.max;
      if (Math.floor(((v - d.min) / width) * n) !== stratum) {
        v = d.min + ((stratum + 0.5) / n) * width;
      }
      (out[i] as Scenario)[d.name] = v;
    }
  }
  return out;
}
