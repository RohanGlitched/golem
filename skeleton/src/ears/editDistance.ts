import type { CompiledTemplate, Kind, Token } from './types.js';
import { lookupUnit } from './units.js';

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
    const ai = ka[i - 1]!;
    for (let j = 1; j <= n; j++) {
      const sub = prev[j - 1]! + (ai === kb[j - 1] ? 0 : 1);
      const del = prev[j]! + 1;
      const ins = cur[j - 1]! + 1;
      cur[j] = Math.min(sub, del, ins);
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[n]!;
}

/**
 * Collapse a clause to a comparable sequence. A number followed by its unit becomes one
 * wildcard of the unit's kind. A bare number becomes `count` when it is an integer and
 * `ratio` otherwise. Commas are dropped. Every other token is a case-folded word.
 */
export function toWildcardSequence(clause: readonly Token[]): WildToken[] {
  const out: WildToken[] = [];
  for (let i = 0; i < clause.length; i++) {
    const tok = clause[i]!;
    if (tok.type === 'comma') continue;
    if (tok.type === 'number') {
      const next = clause[i + 1];
      const spec = next && next.type === 'unit' ? lookupUnit(next.text) : undefined;
      if (spec) {
        out.push({ wild: spec.kind });
        i++;
      } else {
        out.push({ wild: Number.isInteger(Number(tok.text)) ? 'count' : 'ratio' });
      }
      continue;
    }
    out.push({ word: tok.text.toLowerCase() });
  }
  return out;
}

function templateSequence(t: CompiledTemplate): WildToken[] {
  return t.pattern.map((p) => (typeof p === 'string' ? { word: p.toLowerCase() } : { wild: p.slot }));
}

/**
 * The template with the smallest token edit distance to the clause. Templates must all be of
 * one class (perturbation or predicate). The first minimum wins. With no templates the result
 * has no `template`, an infinite distance and `tooFar` true.
 */
export function closestTemplate(
  clause: readonly Token[],
  templates: readonly CompiledTemplate[],
): { template?: CompiledTemplate; distance: number; tooFar: boolean } {
  const a = toWildcardSequence(clause);
  let best: CompiledTemplate | undefined;
  let bestDist = Infinity;
  let bestLen = 0;
  for (const t of templates) {
    const b = templateSequence(t);
    const d = tokenEditDistance(a, b);
    if (d < bestDist) {
      best = t;
      bestDist = d;
      bestLen = Math.max(a.length, b.length);
    }
  }
  if (!best) return { distance: Infinity, tooFar: true };
  return { template: best, distance: bestDist, tooFar: bestDist > bestLen / 2 };
}
