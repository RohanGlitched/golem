import type { Kind } from './types.js';

/** A wildcard (slot or quantity) of a given kind, or a word. Words compare case-folded. */
export type WildToken = { wild: Kind | 'direction' | 'range' } | { word: string };

type Item = string | WildToken;

/** Normalise to a comparable key: words become `w:<lowercase>`, wildcards `*:<kind>`. */
function key(x: Item): string {
  if (typeof x === 'string') return 'w:' + x.toLowerCase();
  if ('wild' in x) return '*:' + x.wild;
  return 'w:' + x.word.toLowerCase();
}

/**
 * Levenshtein distance over token sequences. Insert, delete and substitute cost 1.
 * Equal tokens cost 0 (words after case folding; wildcards of equal kind).
 * A wildcard and a word, or wildcards of different kinds, cost 1.
 */
export function tokenEditDistance(a: readonly Item[], b: readonly Item[]): number {
  const ka = a.map(key);
  const kb = b.map(key);
  const n = kb.length;
  let prev = new Int32Array(n + 1);
  let cur = new Int32Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= ka.length; i++) {
    cur[0] = i;
    const ai = ka[i - 1];
    for (let j = 1; j <= n; j++) {
      const sub = prev[j - 1] + (ai === kb[j - 1] ? 0 : 1);
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      cur[j] = Math.min(sub, del, ins);
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[n];
}
