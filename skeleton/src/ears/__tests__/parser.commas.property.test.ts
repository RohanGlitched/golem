import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stripOffsets, type ParsedRequirement } from '../ast.js';
import { format } from '../format.js';
import { parse } from '../parser.js';
import { tokenize } from '../tokenizer.js';
import type { Token } from '../types.js';
import { arbLexicon, arbValidLine } from './generators.js';
import { propConfig } from './support.js';

/**
 * Rewrites the optional commas of a valid line: the one that ends the condition
 * (before THE, or before THEN for the unwanted pattern) and the one after THEN.
 * Splices are applied right to left so earlier offsets stay valid.
 */
function withCommas(
  text: string,
  tokens: readonly Token[],
  condEnd: number,
  unwanted: boolean,
  before: boolean,
  afterThen: boolean,
): string {
  const edits: { start: number; end: number; insert: string }[] = [];
  const i = tokens.findIndex((t) => t.start >= condEnd);
  const head = tokens[i]!;
  if (head.type === 'comma') {
    if (!before) edits.push({ start: head.start, end: head.end, insert: '' });
  } else if (before) {
    edits.push({ start: condEnd, end: condEnd, insert: ',' });
  }
  if (unwanted) {
    const k = tokens.findIndex((t, idx) => idx >= i && t.type === 'keyword' && t.text.toUpperCase() === 'THEN');
    const then = tokens[k]!;
    const next = tokens[k + 1]!;
    if (next.type === 'comma') {
      if (!afterThen) edits.push({ start: next.start, end: next.end, insert: '' });
    } else if (afterThen) {
      edits.push({ start: then.end, end: then.end, insert: ',' });
    }
  }
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.insert + out.slice(e.end);
  return out;
}

// Feature: golem-ears, Property 10: Optional commas do not change the AST or the canonical text
describe('Feature: golem-ears, Property 10: Optional commas do not change the AST or the canonical text', () => {
  it('yields equal ASTs and equal format() output with or without the optional commas', () => {
    // **Validates: Requirements 3.6, 3.7, 10.9**
    let withCondition = 0;
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) => arbValidLine(lex).map((line) => ({ lex, line }))),
        fc.boolean(),
        fc.boolean(),
        ({ lex, line }, before, afterThen) => {
          const tok = tokenize(line.text);
          const base = parse(tok.tokens, lex.robotNames, line.text);
          expect(base.diagnostics).toEqual([]);
          const baseAst = base.ast!;
          const baseStripped = stripOffsets(baseAst) as ParsedRequirement;
          const baseText = format(baseAst);

          if (line.pattern === 'ubiquitous') return; // no optional comma
          withCondition++;
          const unwanted = line.pattern === 'unwanted';
          const variants = [
            withCommas(line.text, tok.tokens, baseAst.condition!.span.end, unwanted, true, true),
            withCommas(line.text, tok.tokens, baseAst.condition!.span.end, unwanted, false, false),
            withCommas(line.text, tok.tokens, baseAst.condition!.span.end, unwanted, before, afterThen),
          ];
          for (const v of variants) {
            const t = tokenize(v);
            expect(t.diagnostics).toEqual([]);
            const r = parse(t.tokens, lex.robotNames, v);
            expect(r.diagnostics).toEqual([]);
            expect(stripOffsets(r.ast!)).toEqual(baseStripped);
            expect(format(r.ast!)).toBe(baseText);
          }
        },
      ),
      propConfig,
    );
    expect(withCondition).toBeGreaterThan(0);
  });
});
