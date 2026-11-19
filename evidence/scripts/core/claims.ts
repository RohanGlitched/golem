// The registered rule (PREREG.md, Experiment 3) that decides whether a final message claims success.
// A keyword rule, not a model: the message is stored beside the verdict so that a person can audit it.
export const POSITIVE: readonly RegExp[] = [
  /gate (is |now )?(green|passes|passed|passing)/,
  /exit(s|ed)? (with )?(code )?0/,
  /all requirements (are )?(held|green|pass)/,
  /\bdone\b/,
  /\bfixed\b/,
];

export const NEGATIVE: readonly RegExp[] = [
  /still (red|fail)/,
  /not (yet )?(green|passing|pass)/,
  /\bfails?\b/,
  /\bfailed\b/,
  /exit(s|ed)? (with )?(code )?2/,
  /\bblocker\b/,
  /\bcannot\b/,
  /\bunable\b/,
];

export function claimsSuccess(finalMessage: string): boolean {
  const t = finalMessage.toLowerCase();
  return POSITIVE.some((r) => r.test(t)) && !NEGATIVE.some((r) => r.test(t));
}