import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ParsedRequirement } from '../ast.js';
import { format } from '../format.js';
import { parse } from '../parser.js';
import { tokenize } from '../tokenizer.js';
import type { Lexicon } from '../types.js';
import { arbLexicon, arbValidLine } from './generators.js';
import { deepFreeze, propConfig } from './support.js';

function parseLine(text: string, lex: Lexicon): ParsedRequirement {
  const tok = tokenize(text);
  expect(tok.diagnostics).toEqual([]);
  const { ast, diagnostics } = parse(tok.tokens, lex.robotNames, text);
  expect(diagnostics).toEqual([]);
  expect(ast).toBeDefined();
  return ast!;
}

/**
 * The formatter prints one space between adjacent tokens (Requirement 10.1), and the tokenizer
 * splits `200N` into the number `200` and the unit `N`. So a quantity written without a space
 * comes back with one space; digits and unit spelling stay unchanged (Requirement 10.5).
 */
const withTokenSpacing = (s: string): string => s.replace(/(\d)(?=[A-Za-z°%])/g, '$1 ');

// Feature: golem-ears, Property 32: Canonical text layout and idempotence
describe('Feature: golem-ears, Property 32: Canonical text layout and idempotence', () => {
  it('prints canonical layout for every generated valid line and is idempotent', () => {
    // **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.10**
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) => arbValidLine(lex).map((line) => ({ lex, line }))),
        ({ lex, line }) => {
          const ast = deepFreeze(parseLine(line.text, lex));
          // Formatting a deep-frozen AST must not throw (no mutation, Requirement 10.10).
          const out = format(ast);

          // 10.1 layout
          expect(out).not.toMatch(/[\r\n]/);
          expect(out).toBe(out.trim());
          expect(out).not.toMatch(/ {2}/);
          expect(out).not.toMatch(/\s,/); // comma attached to the previous token
          expect(out).not.toMatch(/,(?! )/); // one space after a comma
          expect(out).not.toMatch(/,,/);

          // 10.4 ID then one space. NOTE: format.ts does not print the ID byte-for-byte as stored
          // (stored `R2` has no trailing period); it restores the period so the output re-parses:
          // `R2` -> `R2.`, `2` -> `2.`, `2.1` stays `2.1`. That equals the ID as written.
          let rest = out;
          if (line.idText !== undefined) {
            expect(out.startsWith(`${line.idText} `)).toBe(true);
            rest = out.slice(line.idText.length + 1);
          } else {
            expect(ast.id).toBeUndefined();
            expect(out).not.toMatch(/^\s/);
          }

          // 10.2, 10.3, 10.6: canonical shape per pattern, keywords upper case.
          const cond = line.condition ? withTokenSpacing(line.condition.text) : '';
          const resp = withTokenSpacing(line.response.text);
          const tail = `THE ${line.robot} SHALL ${resp}`;
          const expected: Record<typeof line.pattern, string> = {
            ubiquitous: tail,
            event: `WHEN ${cond}, ${tail}`,
            state: `WHILE ${cond}, ${tail}`,
            unwanted: `IF ${cond}, THEN ${tail}`,
            optional: `WHERE ${cond}, ${tail}`,
          };
          // 10.5: this equality also proves quantity spellings are unchanged (never `0.2 kN`).
          expect(rest).toBe(expected[line.pattern]);

          for (const t of tokenize(out).tokens) {
            if (t.type === 'keyword') expect(t.text).toBe(t.text.toUpperCase());
          }

          // 10.7: idempotence.
          const again = format(parseLine(out, lex));
          expect(again).toBe(out);
        },
      ),
      propConfig,
    );
  });
});
