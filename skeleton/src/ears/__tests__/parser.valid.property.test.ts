import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stripOffsets, type ParsedRequirement } from '../ast.js';
import { parse } from '../parser.js';
import { tokenize } from '../tokenizer.js';
import { arbLexicon, arbValidLine } from './generators.js';
import { propConfig } from './support.js';

// Feature: golem-ears, Property 9: Generated valid lines parse to the expected pattern, ID and clauses
describe('Feature: golem-ears, Property 9: Generated valid lines parse to the expected pattern, ID and clauses', () => {
  it('parses every generated valid line to the expected pattern, id, robot and clause texts', () => {
    // **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.8, 3.9, 3.12, 3.14**
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) => arbValidLine(lex).map((line) => ({ lex, line }))),
        ({ lex, line }) => {
          const tok = tokenize(line.text);
          expect(tok.diagnostics).toEqual([]);
          const { ast, diagnostics } = parse(tok.tokens, lex.robotNames, line.text);
          expect(diagnostics).toEqual([]);
          expect(ast).toBeDefined();

          const got = stripOffsets(ast!) as ParsedRequirement;
          expect(got.pattern).toBe(line.pattern);
          expect(got.id).toBe(line.id);
          expect('id' in got).toBe(line.id !== undefined);
          expect(got.robot).toEqual({ name: line.robot });
          // Clause.text is the exact source substring (req 3.14), so read it from the raw AST;
          // stripOffsets normalises layout.
          expect(ast!.condition?.text).toBe(line.condition?.text);
          expect('condition' in got).toBe(line.condition !== undefined);
          expect(ast!.response.text).toBe(line.response.text);

          // Spans slice the input to the clause text; keyword tokens are upper-case.
          const a = ast!;
          expect(line.text.slice(a.response.span.start, a.response.span.end)).toBe(line.response.text);
          expect(a.response.span).toMatchObject(line.spans.response);
          if (line.condition) {
            expect(line.text.slice(a.condition!.span.start, a.condition!.span.end)).toBe(line.condition.text);
            expect(a.condition!.span).toMatchObject(line.spans.condition!);
          }
          expect(a.robot.span).toMatchObject(line.spans.robot);
          for (const t of [...(a.condition?.tokens ?? []), ...a.response.tokens]) {
            if (t.type === 'keyword') expect(t.text).toBe(t.text.toUpperCase());
          }
        },
      ),
      propConfig,
    );
  });
});
