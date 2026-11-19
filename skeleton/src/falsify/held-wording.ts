// The wording of a held verdict, shared by the CLI, the MCP tools and the studio.
// The failure-rate bound comes from the uniformly random trials only (they are i.i.d.; guided and shrink trials are not),
// so the sentence says which trials the bound is from.

/**
 * `no counterexample in 24 trials; from the 4 uniformly random ones, failure rate below 75 % (95 % confidence)`.
 * `rateText` is the bound already formatted with its unit, such as "75 %"; leave it out when there is no bound.
 */
export function heldWording(trials: number, randomTrials: number, rateText?: string): string {
  const head = `no counterexample in ${trials} trials`;
  if (rateText === undefined) return head;
  const which = randomTrials === 1 ? 'the 1 uniformly random one' : `the ${randomTrials} uniformly random ones`;
  return `${head}; from ${which}, failure rate below ${rateText} (95 % confidence)`;
}
