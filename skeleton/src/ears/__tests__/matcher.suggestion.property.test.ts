import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Clause } from '../ast.js';
import { toWildcardSequence, type WildToken } from '../editDistance.js';
import { matchPerturbation, matchPredicate } from '../matcher.js';
import { tokenize } from '../tokenizer.js';
import type { Lexicon, Token } from '../types.js';
import { lookupUnit } from '../units.js';
import { arbLexicon, arbMutation, arbValidLine, propConfig } from './generators.js';
import { refEditDistance } from './refEditDistance.js';

// Feature: golem-ears, Property 18: The suggestion is the first closest template of the right class, or absent when too far

function clauseOf(text: string): Clause {
  const tokens = tokenize('x ' + text).tokens.slice(1);
  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  return { text, tokens, span: { start: first.start, end: last.end, line: first.line, column: first.column } };
}

/** Independent template sequence built straight from the phrase text. */
function refTemplateSeq(phrase: string): WildToken[] {
  return phrase.split(/\s+/).filter((w) => w.length > 0).map((w): WildToken => {
    const m = /^\{(.*)\}$/.exec(w);
    if (!m) return { word: w.toLowerCase() };
    const body = m[1]!;
    return { wild: (body.startsWith('range:') ? 'range' : body) as 'range' };
  });
}

/** Reference closest: first minimum in Lexicon order, with the too-far rule. */
function refClosest(seq: WildToken[], phrases: string[]) {
  let best = -1;
  let bestD = Infinity;
  let bestLen = 0;
  phrases.forEach((p, i) => {
    const t = refTemplateSeq(p);
    const d = refEditDistance(seq, t);
    if (d < bestD) { best = i; bestD = d; bestLen = Math.max(seq.length, t.length); }
  });
  return { index: best, distance: bestD, tooFar: best < 0 || bestD > bestLen / 2 };
}

/** The clause without a trailing `for|within <duration>`, when it has one. */
function strippedTokens(clause: Clause): Token[] | undefined {
  const toks = clause.tokens.filter((t) => t.type !== 'comma');
  const n = toks.length;
  const isKw = (t: Token | undefined) => t !== undefined && t.type === 'word' && ['for', 'within'].includes(t.text.toLowerCase());
  let cut = -1;
  let numTok: Token | undefined;
  let unitTok: Token | undefined;
  if (n >= 3 && toks[n - 1]!.type === 'unit' && toks[n - 2]!.type === 'number' && isKw(toks[n - 3])) {
    cut = n - 3; numTok = toks[n - 2]; unitTok = toks[n - 1];
  } else if (n >= 2 && toks[n - 1]!.type === 'number' && isKw(toks[n - 2])) {
    cut = n - 2; numTok = toks[n - 1];
  }
  if (cut <= 0 || numTok === undefined) return undefined;
  if (unitTok !== undefined && lookupUnit(unitTok.text)?.kind !== 'duration') return undefined;
  return toks.slice(0, cut);
}

function expectedSuggestion(clause: Clause, phrases: string[], withWrapper: boolean): string | undefined {
  let r = refClosest(toWildcardSequence(clause.tokens), phrases);
  const rest = withWrapper ? strippedTokens(clause) : undefined;
  if (rest) {
    const alt = refClosest(toWildcardSequence(rest), phrases);
    if (alt.distance <= r.distance) r = alt;
  }
  return r.tooFar ? undefined : phrases[r.index];
}

describe('Property 18: suggestion is the first closest template of the right class', () => {
  const check = (
    lexicon: Lexicon,
    text: string,
    cls: 'perturbation' | 'predicate',
  ): void => {
    const clause = clauseOf(text);
    const m = cls === 'perturbation' ? matchPerturbation(clause, lexicon) : matchPredicate(clause, lexicon);
    if (m.bound) return; // the mutation still matched: not an unmatched clause
    const d = m.diagnostics[0];
    if (!d || d.kind !== 'UNKNOWN_PHRASE' || d.message.startsWith('Ambiguous')) return;
    const phrases = (cls === 'perturbation' ? lexicon.perturbations : lexicon.predicates).map((t) => t.phrase);
    const want = expectedSuggestion(clause, phrases, cls === 'predicate');
    for (const diag of m.diagnostics) {
      if (diag.kind !== 'UNKNOWN_PHRASE') continue;
      // golem-ears-hardening defect 9: when the clause follows the closest template up to a slot
      // that rejects what is written, the message names that template and slot, and the suggestion
      // is the clause rewritten with an accepted form.
      if (/ is not accepted by \{|\} is missing in "/.test(diag.message)) {
        expect(want).toBeDefined();
        expect(diag.message).toContain(`in "${want}"`);
        expect(diag.message).toContain('It accepts ');
        expect(diag.suggestion).toBeDefined();
        expect(diag.suggestion).not.toBe(text);
        continue;
      }
      expect(diag.suggestion).toBe(want);
      if (want === undefined) expect(diag.message).toContain('No close phrase exists');
      else expect(diag.message).toContain(`Did you mean "${want}"?`);
    }
    // Repeating the call gives equal results.
    const again = cls === 'perturbation' ? matchPerturbation(clause, lexicon) : matchPredicate(clause, lexicon);
    expect(again.diagnostics.map((x) => [x.message, x.suggestion])).toEqual(
      m.diagnostics.map((x) => [x.message, x.suggestion]),
    );
  };

  it('suggests the first minimum-distance template of the same class, or none when too far', () => {
    // **Validates: Requirements 5.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.12**
    fc.assert(
      fc.property(
        arbLexicon.chain((lx) =>
          fc.tuple(
            fc.constant(lx),
            arbValidLine(lx, 'event').chain((l) =>
              fc.tuple(arbMutation(l.condition!.text), arbMutation(l.response.text)),
            ),
            fc.integer({ min: 1, max: 3 }),
          ),
        ),
        ([lx, [trig, resp], extra]) => {
          let t = trig.text;
          let r = resp.text;
          // Extra mutations of unrelated words push some clauses past the distance bound.
          for (let i = 0; i < extra - 1; i++) { t += ' banana purple'; r += ' sideways often'; }
          check(lx, t, 'perturbation');
          check(lx, r, 'predicate');
        },
      ),
      propConfig,
    );
  });

  it('reports no close phrase for an unrelated clause', () => {
    fc.assert(
      fc.property(arbLexicon, (lx) => {
        const text = 'banana purple sideways often quickly sharply banana';
        for (const cls of ['perturbation', 'predicate'] as const) {
          const m = cls === 'perturbation' ? matchPerturbation(clauseOf(text), lx) : matchPredicate(clauseOf(text), lx);
          expect(m.bound).toBeUndefined();
          const d = m.diagnostics[0]!;
          expect(d.suggestion).toBeUndefined();
          expect(d.message).toContain('No close phrase exists');
        }
      }),
      propConfig,
    );
  });

  it('names an empty class and never borrows from the other class', () => {
    fc.assert(
      fc.property(arbLexicon, (lx) => {
        const noPert: Lexicon = { ...lx, perturbations: [] };
        const noPred: Lexicon = { ...lx, predicates: [] };
        const pertPhrase = lx.perturbations[0]!.phrase.replace(/\{[^}]*\}/g, '5');
        const predPhrase = lx.predicates[0]!.phrase.replace(/\{[^}]*\}/g, '5');
        const a = matchPerturbation(clauseOf(pertPhrase), noPert);
        const b = matchPredicate(clauseOf(predPhrase), noPred);
        for (const m of [a, b]) {
          expect(m.bound).toBeUndefined();
          expect(m.diagnostics).toHaveLength(1);
          expect(m.diagnostics[0]!.suggestion).toBeUndefined();
          expect(m.diagnostics[0]!.message).toContain('has no');
        }
      }),
      propConfig,
    );
  });

  it('suggests a predicate-class phrase only for a response clause', () => {
    const lx: Lexicon = {
      robotNames: ['robot'],
      perturbations: [{ phrase: 'pushed with {force}', dims: () => [], apply: () => {} }],
      predicates: [{ phrase: 'keep above {length}', signals: ['s'], unit: 'm', margin: () => 1 }],
    };
    expect(matchPerturbation(clauseOf('pushed wth 5 N'), lx).diagnostics[0]!.suggestion).toBe('pushed with {force}');
    expect(matchPredicate(clauseOf('keep abov 5 m'), lx).diagnostics[0]!.suggestion).toBe('keep above {length}');
  });
});
