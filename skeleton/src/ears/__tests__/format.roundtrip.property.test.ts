import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stripOffsets } from '../ast.js';
import { format } from '../format.js';
import { parse } from '../parser.js';
import { tokenize } from '../tokenizer.js';
import { arbLexicon, arbValidLine } from './generators.js';
import { propConfig } from './support.js';

// Feature: golem-ears, Property 31: Parse and format round trip
describe('Feature: golem-ears, Property 31: Parse and format round trip', () => {
  it('re-parses format(parse(line)) to an AST equal to parse(line), ignoring offsets', () => {
    // **Validates: Requirements 10.8, 13.3**
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) => arbValidLine(lex).map((line) => ({ lex, line }))),
        ({ lex, line }) => {
          const tok1 = tokenize(line.text);
          expect(tok1.diagnostics).toEqual([]);
          const first = parse(tok1.tokens, lex.robotNames, line.text);
          expect(first.diagnostics).toEqual([]);
          expect(first.ast).toBeDefined();

          const printed = format(first.ast!);
          const tok2 = tokenize(printed);
          expect(tok2.diagnostics).toEqual([]);
          const second = parse(tok2.tokens, lex.robotNames, printed);
          expect(second.diagnostics).toEqual([]);
          expect(second.ast).toBeDefined();

          expect(stripOffsets(second.ast!)).toEqual(stripOffsets(first.ast!));
        },
      ),
      propConfig,
    );
  });
});
