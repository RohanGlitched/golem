import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Clause } from '../ast.js';
import { matchPerturbation, matchPredicate } from '../matcher.js';
import { tokenize } from '../tokenizer.js';
import type { Lexicon } from '../types.js';
import { arbLexicon, arbMutation, arbValidLine } from './generators.js';
import { propConfig } from './support.js';

/** Builds a clause from text. Prefixed with a word so a leading number is not read as an ID. */
function clauseOf(text: string): Clause {
  const tokens = tokenize('x ' + text).tokens.slice(1);
  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  return { text, tokens, span: { start: first.start, end: last.end, line: first.line, column: first.column } };
}

// ---------- independent oracle: could this text be an instance of this template? ----------

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** One word of a filled slot: a number-like word, a unit spelling or a range/direction word. */
const SLOT_WORD =
  '(?:[-+]?\\d\\S*|up|to|any|direction|behind|N|kN|s|ms|m|cm|mm|m\\/s|cm\\/s|deg|°|rad|kg|g|%)';
const SLOT = `${SLOT_WORD}(?: ${SLOT_WORD}){0,5}`;

/**
 * A deliberately permissive regex for a template: literals must appear in order and verbatim
 * (ignoring case); each slot is any run of up to six slot words. A predicate may also end in
 * `for|within <slot>`. If this regex rejects a text, no template instance can equal it.
 */
function skeletonRegex(phrase: string, allowWrapper: boolean): RegExp {
  const body = phrase
    .trim()
    .split(/\s+/)
    .map((w) => (/^\{[^{}]*\}$/.test(w) ? SLOT : escapeRe(w)))
    .join(' ');
  const tail = allowWrapper ? `(?: (?:for|within) ${SLOT})?` : '';
  return new RegExp(`^${body}${tail}$`, 'i');
}

const couldMatchSomeTemplate = (phrases: readonly string[], text: string, allowWrapper: boolean): boolean =>
  phrases.some((p) => skeletonRegex(p, allowWrapper).test(text));

/**
 * Each number with the word that follows it. A mutation that changes one of these pairs damages a
 * quantity (a lost or foreign unit, a bare number), which Requirements 2.5 to 2.10 report as
 * MISSING_UNIT, BAD_RANGE or a kind mismatch instead of a plain unknown phrase. Property 15 is
 * about the literal words, so only mutations that leave every quantity intact are generated.
 */
const numberPairs = (text: string): string[] => {
  const w = text.split(' ');
  return w.flatMap((x, i) => (/^[-+]?\d/.test(x) ? [`${x}|${w[i + 1] ?? ''}`] : []));
};
const quantitiesIntact = (original: string, mutated: string): boolean => {
  const a = numberPairs(original);
  const b = numberPairs(mutated);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

// Feature: golem-ears, Property 15: Matching is exact, never approximate
describe('Feature: golem-ears, Property 15: Matching is exact, never approximate', () => {
  it('binds nothing and reports UNKNOWN_PHRASE for a really mutated response clause', () => {
    // **Validates: Requirements 5.4, 5.6**
    let checked = 0;
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) =>
          arbValidLine(lex).chain((line) =>
            arbMutation(line.response.text).map((m) => ({ lex, line, m })),
          ),
        ),
        ({ lex, line, m }) => {
          fc.pre(m.changed);
          fc.pre(quantitiesIntact(line.response.text, m.text));
          fc.pre(tokenize('x ' + m.text).diagnostics.length === 0);
          fc.pre(!couldMatchSomeTemplate(lex.predicates.map((p) => p.phrase), m.text, true));
          checked++;
          const r = matchPredicate(clauseOf(m.text), lex);
          expect(r.bound, `${line.response.phrase} -> ${m.text}`).toBeUndefined();
          expect(r.wrapper).toBeUndefined();
          expect(r.diagnostics.length).toBeGreaterThan(0);
          expect(r.diagnostics.some((d) => d.kind === 'UNKNOWN_PHRASE' && d.severity === 'error')).toBe(true);
        },
      ),
      propConfig,
    );
    expect(checked).toBeGreaterThan(0);
  });

  it('binds nothing and reports UNKNOWN_PHRASE for a really mutated trigger clause', () => {
    // **Validates: Requirements 5.4, 5.6**
    let checked = 0;
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) =>
          arbValidLine(lex, 'event').chain((line) =>
            arbMutation(line.condition!.text).map((m) => ({ lex, line, m })),
          ),
        ),
        ({ lex, line, m }) => {
          fc.pre(m.changed);
          fc.pre(quantitiesIntact(line.condition!.text, m.text));
          fc.pre(tokenize('x ' + m.text).diagnostics.length === 0);
          fc.pre(!couldMatchSomeTemplate(lex.perturbations.map((p) => p.phrase), m.text, false));
          checked++;
          const r = matchPerturbation(clauseOf(m.text), lex);
          expect(r.bound, `${line.condition!.phrase} -> ${m.text}`).toBeUndefined();
          expect(r.diagnostics.length).toBeGreaterThan(0);
          expect(r.diagnostics.some((d) => d.kind === 'UNKNOWN_PHRASE' && d.severity === 'error')).toBe(true);
        },
      ),
      propConfig,
    );
    expect(checked).toBeGreaterThan(0);
  });

  it('binds an unmutated clause to exactly the template it was written from', () => {
    // **Validates: Requirements 5.4, 5.6**
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) => arbValidLine(lex, 'event').map((line) => ({ lex, line }))),
        ({ lex, line }) => {
          const p = matchPerturbation(clauseOf(line.condition!.text), lex);
          expect(p.diagnostics).toEqual([]);
          expect(p.bound?.template.phrase).toBe(line.condition!.phrase);
          const q = matchPredicate(clauseOf(line.response.text), lex);
          expect(q.diagnostics).toEqual([]);
          expect(q.bound?.template.phrase).toBe(line.response.phrase);
        },
      ),
      propConfig,
    );
  });

  it('reports one ambiguity diagnostic listing both phrases when two templates match, and binds nothing', () => {
    // **Validates: Requirements 5.4, 5.6**
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) =>
          arbValidLine(lex, 'event').map((line) => {
            const dupPred = lex.predicates.find((t) => t.phrase === line.response.phrase)!;
            const dupPert = lex.perturbations.find((t) => t.phrase === line.condition!.phrase)!;
            const twin: Lexicon = {
              ...lex,
              predicates: [...lex.predicates, { ...dupPred }],
              perturbations: [...lex.perturbations, { ...dupPert }],
            };
            return { twin, line };
          }),
        ),
        ({ twin, line }) => {
          const check = (r: { bound?: unknown; diagnostics: { kind: string; message: string }[] }, phrase: string) => {
            expect(r.bound).toBeUndefined();
            expect(r.diagnostics).toHaveLength(1);
            expect(r.diagnostics[0]!.kind).toBe('UNKNOWN_PHRASE');
            const quoted = `"${phrase}"`;
            expect(r.diagnostics[0]!.message.split(quoted).length - 1).toBe(2);
          };
          check(matchPerturbation(clauseOf(line.condition!.text), twin), line.condition!.phrase);
          check(matchPredicate(clauseOf(line.response.text), twin), line.response.phrase);
        },
      ),
      propConfig,
    );
  });

  it('rejects a hand-made near miss with a suggestion instead of binding it', () => {
    const lex: Lexicon = {
      robotNames: ['robot'],
      predicates: [{ phrase: 'keep its pelvis above {length}', signals: ['s'], unit: 'm', margin: () => 1 }],
      perturbations: [],
    };
    for (const text of ['keep pelvis above 5 cm', 'keep its pelvis abvoe 5 cm', 'its keep pelvis above 5 cm']) {
      const r = matchPredicate(clauseOf(text), lex);
      expect(r.bound).toBeUndefined();
      expect(r.diagnostics[0]!.kind).toBe('UNKNOWN_PHRASE');
    }
  });
});
