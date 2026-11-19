import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Clause } from '../ast.js';
import { matchPerturbation, matchPredicate } from '../matcher.js';
import { tokenize } from '../tokenizer.js';
import type { Kind, Lexicon } from '../types.js';
import { UNIT_KINDS, arbQuantity, propConfig } from './generators.js';

// Feature: golem-ears, Property 8: Quantity kind mismatch is rejected with both kinds named

/** Kinds a slot can expect: every unit-bearing kind (the quantity side never uses `phase`). */
const SLOT_KINDS: readonly Kind[] = UNIT_KINDS;

const arbMismatch: fc.Arbitrary<{ expected: Kind; found: Kind; text: string }> = fc
  .constantFrom(...SLOT_KINDS)
  .chain((expected) =>
    fc
      .constantFrom(...SLOT_KINDS.filter((k) => k !== expected))
      .chain((found) =>
        arbQuantity(found).map((q) => ({ expected, found, text: q.text })),
      ),
  );

function clauseOf(text: string): Clause {
  const tokens = tokenize('x ' + text).tokens.slice(1);
  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  return { text, tokens, span: { start: first.start, end: last.end, line: first.line, column: first.column } };
}

const lexiconFor = (kind: Kind, asPredicate: boolean): Lexicon => ({
  robotNames: ['robot'],
  predicates: asPredicate
    ? [{ phrase: `keep its pelvis above {${kind}}`, signals: ['s'], unit: 'm', margin: () => 1 }]
    : [],
  perturbations: asPredicate
    ? []
    : [{ phrase: `the pelvis is moved by {${kind}}`, dims: () => [], apply: () => {} }],
});

describe('Property 8: Quantity kind mismatch is rejected with both kinds named', () => {
  it('names the expected and found kinds at the quantity position and binds nothing', () => {
    fc.assert(
      fc.property(arbMismatch, fc.boolean(), ({ expected, found, text }, asPredicate) => {
        const prefix = asPredicate ? 'keep its pelvis above ' : 'the pelvis is moved by ';
        const clause = clauseOf(prefix + text);
        const lexicon = lexiconFor(expected, asPredicate);
        const r = asPredicate ? matchPredicate(clause, lexicon) : matchPerturbation(clause, lexicon);

        expect(r.bound).toBeUndefined();
        expect(r.diagnostics).toHaveLength(1);
        const d = r.diagnostics[0]!;
        expect(d.kind).toBe('UNKNOWN_PHRASE');
        expect(d.message).toContain(expected);
        expect(d.message).toContain(found);
        // The diagnostic points at the first token of the quantity.
        const numberTok = clause.tokens.find((t) => t.type === 'number')!;
        expect(d.line).toBe(numberTok.line);
        expect(d.column).toBe(numberTok.column);
      }),
      propConfig,
    );
  });

  it('example: a duration in a length slot names length and duration', () => {
    const r = matchPredicate(clauseOf('keep its pelvis above 3 s'), lexiconFor('length', true));
    expect(r.bound).toBeUndefined();
    expect(r.diagnostics[0]!.message).toMatch(/length.*duration/);
  });
});
