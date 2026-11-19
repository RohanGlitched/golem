// The gate's confirmation pass: the second search seed and the words that describe the pass.

/** The murmur3 finalizer, a bijection on uint32 (the same function the falsifier uses to derive its trial seeds). */
function fmix32(z: number): number {
  z = z >>> 0;
  z ^= z >>> 16; z = Math.imul(z, 0x85ebca6b);
  z ^= z >>> 13; z = Math.imul(z, 0xc2b2ae35);
  z ^= z >>> 16;
  return z >>> 0;
}

/** XORed into the first search seed before mixing, so that the second seed is not a trivial function such as `seed + 1`. */
export const CONFIRM_SALT = 0xc0def57a;

/**
 * The second, independent search seed of the confirmation pass: `fmix32(first XOR 0xC0DEF57A)`, a pure function of the
 * first seed. The result is a uint32 in [1, 2^32), never equal to the first seed, so it is also a valid `--search-seed`.
 * Where that mixing would give 0 or the first seed itself, the mixing is repeated on the result plus 1.
 */
export function confirmSeed(first: number): number {
  const f = first >>> 0;
  let s = fmix32(f ^ CONFIRM_SALT);
  while (s === 0 || s === f) s = fmix32(s + 1);
  return s;
}

/** What the confirmation pass of one gate run did. */
export interface ConfirmInfo {
  /**
   * confirmed: every Expected_Hold line was searched again and held. broke: at least one did not hold the second time.
   * skipped: `--no-confirm`. unmet: a line already missed its expectation, so the gate is red without it.
   * none: no line is marked Expected_Hold, so there is nothing to search again.
   */
  status: 'confirmed' | 'broke' | 'skipped' | 'unmet' | 'none';
  /** The search seed of the first pass and the derived seed of the confirmation. */
  firstSeed: number;
  secondSeed: number;
  /** Search budget of the confirmation for each line, on top of the pinned seeds that always re-run first. */
  budget: { maxTrials?: number; maxWallMs?: number };
  /** The lines that were searched again, and those among them that did not hold. */
  reqIds: string[];
  failedIds: string[];
  /** Trials of the confirmation pass alone. */
  trials: number;
}

const budgetWords = (b: ConfirmInfo['budget']): string => {
  const parts: string[] = [];
  if (b.maxTrials !== undefined) parts.push(`${b.maxTrials} trials`);
  if (b.maxWallMs !== undefined) parts.push(`${b.maxWallMs / 1000} s`);
  return parts.join(' or ') || 'the default budget';
};

/** One line for a GREEN or RED gate: which pass ran, with both seeds and the trials. */
export function confirmSummary(c: ConfirmInfo, totalTrials: number): string {
  const seeds = `search seed ${c.firstSeed}, then confirmation seed ${c.secondSeed}`;
  switch (c.status) {
    case 'confirmed':
      return `confirmed: ${c.reqIds.length} Expected_Hold ${c.reqIds.length === 1 ? 'line' : 'lines'} searched again with a second, independent search seed (${seeds}; ${budgetWords(c.budget)} per line; ${c.trials} confirmation trials, ${totalTrials} in total)`;
    case 'broke':
      return `NOT confirmed: ${c.failedIds.join(', ')} held under search seed ${c.firstSeed} and did not hold under confirmation seed ${c.secondSeed} (${budgetWords(c.budget)} per line; ${c.trials} confirmation trials, ${totalTrials} in total)`;
    case 'skipped':
      return `NOT confirmed (--no-confirm): each line was searched once, with search seed ${c.firstSeed}; ${totalTrials} trials in total`;
    case 'unmet':
      return `confirmation not run: a line already misses its expectation (search seed ${c.firstSeed}; confirmation seed would be ${c.secondSeed})`;
    case 'none':
      return `nothing to confirm: no line is marked Expected_Hold (search seed ${c.firstSeed})`;
  }
}
