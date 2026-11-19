import { deriveSeed, SALT } from './prng.js';

/** Three seeds from salt 3 candidates, skipping the original seed. Mutually distinct by injectivity. */
export function verificationSeeds(searchSeed: number, originalSeed: number): [number, number, number] {
  const out: number[] = [];
  const orig = originalSeed >>> 0;
  for (let j = 0; out.length < 3; j++) {
    const c = deriveSeed(searchSeed, SALT.verification, j);
    if (c !== orig) out.push(c);
  }
  return out as [number, number, number];
}

export type Classification = 'robust' | 'seed-sensitive';

/**
 * `null` marks a trial error or NaN. Any null gives undefined. All three below zero gives 'robust',
 * otherwise (zero counts as not failing) 'seed-sensitive'.
 */
export function classify(robustness: readonly (number | null)[]): Classification | undefined {
  for (const r of robustness) if (r === null || Number.isNaN(r)) return undefined;
  return (robustness as number[]).every((r) => r < 0) ? 'robust' : 'seed-sensitive';
}
