// Needle benchmarks from docs/reviews/falsify-probe-search.mts, shared by the search-effectiveness tests.
import type { ScenarioSpace } from './contract.js';
import { falsify } from './falsifier.js';
import { directPool, syntheticTrialFn, type RobustnessFn } from './testing.js';
import type { FalsifyOptions } from './types.js';

/** Signed circular distance (degrees) outside [lo, hi] on a 360° circle; negative inside. */
export function angleOutside(a: number, lo: number, hi: number): number {
  const mid = (lo + hi) / 2;
  const half = (hi - lo) / 2;
  return Math.abs((((a - mid) % 360) + 540) % 360 - 180) - half;
}

/** Fails inside angle [lo, hi] with force above `forceMin`; flat: -0.01 inside, 1 outside. */
export function needle(lo: number, hi: number, forceMin: number, flat: boolean): RobustnessFn {
  return (s) => {
    const r = Math.max(angleOutside(s['angle'] as number, lo, hi) / 360, (forceMin - (s['force'] as number)) / 250);
    return flat ? (r < 0 ? -0.01 : 1) : r;
  };
}

export const needleSpace: ScenarioSpace = {
  dims: [
    { name: 'force', kind: 'force', min: 0, max: 250, severity: 'up' },
    { name: 'angle', kind: 'angle', min: 0, max: 360, severity: 'none', wrap: true },
  ],
};

/** The 0.11% region of the audit: angle [130°, 135°], force above 230 N. */
export const NEEDLE_011 = { lo: 130, hi: 135, forceMin: 230 } as const;

/** Number of search seeds (of `seeds`) whose run finds the region within `maxTrials`. */
export async function foundCount(
  fn: RobustnessFn, seeds: readonly number[], maxTrials: number, mode: 'full' | 'random-only', extra: Partial<FalsifyOptions> = {},
): Promise<number> {
  const trial = syntheticTrialFn(fn, 'u');
  let found = 0;
  for (const searchSeed of seeds) {
    const r = await falsify({ id: 'R1', space: needleSpace }, directPool(trial), {
      appId: 'a', budget: { maxTrials }, searchSeed, mode, shrink: { maxTrials: 1, reserveMin: 0, reserveFraction: 0 }, ...extra,
    });
    if (r.verdict.status === 'broken') found++;
  }
  return found;
}
