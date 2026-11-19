import type { WildToken } from '../editDistance.js';

type Item = string | WildToken;

/** Independent comparison key: words fold case, wildcards compare by kind. */
export function refKey(x: Item): string {
  if (typeof x === 'string') return 'w:' + x.toLowerCase();
  if ('wild' in x) return '*:' + x.wild;
  return 'w:' + x.word.toLowerCase();
}

/** Reference Levenshtein distance using the full (m+1) x (n+1) matrix. */
export function refEditDistance(a: readonly Item[], b: readonly Item[]): number {
  const ka = a.map(refKey);
  const kb = b.map(refKey);
  const m = ka.length;
  const n = kb.length;
  const d: number[][] = [];
  for (let i = 0; i <= m; i++) {
    const row = new Array<number>(n + 1).fill(0);
    row[0] = i;
    d.push(row);
  }
  const at = (i: number, j: number): number => d[i]![j]!;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i]![j] = Math.min(
        at(i - 1, j - 1) + (ka[i - 1] === kb[j - 1] ? 0 : 1),
        at(i - 1, j) + 1,
        at(i, j - 1) + 1,
      );
    }
  }
  return at(m, n);
}
