import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Clause } from '../ast.js';
import { compileTemplate, matchPerturbation, matchPredicate, type MatcherSlot } from '../matcher.js';
import { tokenize } from '../tokenizer.js';
import { quantityFromTokens } from '../units.js';
import type { Quantity } from '../types.js';
import { arbLexicon, arbValidLine, type GeneratedClause } from './generators.js';
import { propConfig } from './support.js';

/** Builds a clause from text. A leading word keeps a leading number from being read as an ID. */
function clauseOf(text: string): Clause {
  const tokens = tokenize('x ' + text).tokens.slice(1);
  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  return { text, tokens, span: { start: first.start, end: last.end, line: first.line, column: first.column } };
}

const near = (a: number, b: number): boolean =>
  Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b)) + 1e-300;

/** Upper-cases or lower-cases the literal words of a clause, leaving written values untouched. */
function recase(text: string, phrase: string, upper: boolean): string {
  const lits = new Set(
    phrase.split(' ').filter((w) => !w.startsWith('{')).map((w) => w.toLowerCase()).concat(['for', 'within']),
  );
  return text
    .split(' ')
    .map((w) => (lits.has(w.toLowerCase()) ? (upper ? w.toUpperCase() : w.toLowerCase()) : w))
    .join(' ');
}

/** Checks every slot binding of a matched clause against the generator's written values. */
function expectBound(
  gen: GeneratedClause,
  bound: { slots: Record<string, unknown>; si: Record<string, number> },
): void {
  const tpl = compileTemplate(gen.phrase, 0);
  const slotEls = tpl.pattern.filter((e): e is MatcherSlot => typeof e !== 'string');
  expect(slotEls.length).toBe(gen.bindings.length);
  slotEls.forEach((el, i) => {
    const b = gen.bindings[i]!;
    expect(b.slot === el.slot || b.slot === `range:${el.rangeKind}`).toBe(true);
    if (el.slot === 'range') {
      const pair = bound.slots[el.name] as Quantity[];
      expect(near(bound.si[`${el.name}.min`]!, b.range![0])).toBe(true);
      expect(near(bound.si[`${el.name}.max`]!, b.range![1])).toBe(true);
      expect(pair[0]!.kind).toBe(el.rangeKind);
      expect(pair[1]!.kind).toBe(el.rangeKind);
    } else if (el.slot === 'direction') {
      expect(bound.slots[el.name]).toBe(b.text);
      if (b.text === 'behind') {
        expect(near(bound.si[`${el.name}.min`]!, (135 * Math.PI) / 180)).toBe(true);
        expect(near(bound.si[`${el.name}.max`]!, (225 * Math.PI) / 180)).toBe(true);
      } else {
        expect(bound.si[`${el.name}.min`]).toBe(0);
      }
    } else {
      expect(near(bound.si[el.name]!, b.si!)).toBe(true);
      expect((bound.slots[el.name] as Quantity).text).toBe(b.text);
    }
  });
}

/** Expected wrapper of a response, read from its written `for|within <duration>` tail. */
function expectedWrapper(text: string): { kind: 'always' | 'eventually'; duration: number } | undefined {
  const m = / (for|within) ([^ ]+(?: [^ ]+)?)$/.exec(text);
  if (!m) return undefined;
  const toks = tokenize('x ' + m[2]!).tokens.slice(1);
  const q = quantityFromTokens(toks[0]!, toks[1], 'duration').quantity;
  if (!q || q.kind !== 'duration') return undefined;
  return { kind: m[1] === 'for' ? 'always' : 'eventually', duration: q.si };
}

// Feature: golem-ears, Property 14: Template matching binds the written values
// **Validates: Requirements 5.1, 5.2, 5.10, 5.11**
describe('template matching binds the written values', () => {
  it('binds each slot of a trigger clause to the written SI value, dims and ranges as written', () => {
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) => fc.tuple(fc.constant(lex), arbValidLine(lex, 'event'))),
        ([lex, line]) => {
          const cond = line.condition!;
          const r = matchPerturbation(clauseOf(cond.text), lex);
          expect(r.diagnostics).toEqual([]);
          expect(r.bound!.template.phrase).toBe(cond.phrase);
          expectBound(cond, r.bound!);
          expect(r.bound!.dimensions).toEqual([]);
        },
      ),
      propConfig,
    );
  });

  it('binds each slot of a response clause in SI and reports the temporal wrapper', () => {
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) => fc.tuple(fc.constant(lex), arbValidLine(lex, 'ubiquitous'))),
        ([lex, line]) => {
          const resp = line.response;
          const r = matchPredicate(clauseOf(resp.text), lex);
          expect(r.diagnostics).toEqual([]);
          expect(r.bound!.template.phrase).toBe(resp.phrase);
          expectBound(resp, r.bound!);
          const w = expectedWrapper(resp.text);
          if (w === undefined) expect(r.wrapper).toBeUndefined();
          else {
            expect(r.wrapper!.kind).toBe(w.kind);
            expect(near(r.wrapper!.duration!, w.duration)).toBe(true);
          }
        },
      ),
      propConfig,
    );
  });

  it('gives equal bindings when the literal words are written in any letter case', () => {
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) => fc.tuple(fc.constant(lex), arbValidLine(lex, 'event'))),
        ([lex, line]) => {
          const cond = line.condition!;
          const base = matchPerturbation(clauseOf(recase(cond.text, cond.phrase, false)), lex);
          const up = matchPerturbation(clauseOf(recase(cond.text, cond.phrase, true)), lex);
          expect(up.diagnostics).toEqual([]);
          expect(up.bound!.template.phrase).toBe(base.bound!.template.phrase);
          expect(up.bound!.si).toEqual(base.bound!.si);
          expect(up.bound!.slots).toEqual(base.bound!.slots);

          const resp = line.response;
          const pb = matchPredicate(clauseOf(recase(resp.text, resp.phrase, false)), lex);
          const pu = matchPredicate(clauseOf(recase(resp.text, resp.phrase, true)), lex);
          expect(pu.diagnostics).toEqual([]);
          expect(pu.bound!.template.phrase).toBe(pb.bound!.template.phrase);
          expect(pu.bound!.si).toEqual(pb.bound!.si);
          expect(pu.bound!.slots).toEqual(pb.bound!.slots);
          expect(pu.wrapper).toEqual(pb.wrapper);
        },
      ),
      propConfig,
    );
  });
});
