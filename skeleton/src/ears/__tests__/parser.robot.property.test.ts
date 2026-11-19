import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse } from '../parser.js';
import { tokenize } from '../tokenizer.js';
import { arbLexicon, arbValidLine } from './generators.js';
import { propConfig } from './support.js';

const UNKNOWN_NAMES = ['human', 'gremlin', 'zombie', 'ghoul', 'Q7', 'witch', 'mummy', 'bot9'];

// Feature: golem-ears, Property 11: Unknown robot names are rejected and listed
describe('Feature: golem-ears, Property 11: Unknown robot names are rejected and listed', () => {
  it('rejects a name outside robotNames with UNKNOWN_ROBOT at that word and lists every allowed name', () => {
    // **Validates: Requirements 3.11, 8.6**
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) =>
          fc.tuple(
            arbValidLine(lex),
            fc.constantFrom(...UNKNOWN_NAMES.filter((n) => !lex.robotNames.some((r) => r.toLowerCase() === n.toLowerCase()))),
          ).map(([line, bad]) => ({ lex, line, bad })),
        ),
        ({ lex, line, bad }) => {
          const { start, end } = line.spans.robot;
          const text = line.text.slice(0, start) + bad + line.text.slice(end);

          const tok = tokenize(text);
          expect(tok.diagnostics).toEqual([]);
          const { ast, diagnostics } = parse(tok.tokens, lex.robotNames, text);

          expect(ast).toBeUndefined();
          const errs = diagnostics.filter((d) => d.kind === 'UNKNOWN_ROBOT');
          expect(errs).toHaveLength(1);
          const d = errs[0]!;
          expect(d.severity).toBe('error');
          expect(d.start).toBe(start);
          expect(d.end).toBe(start + bad.length);
          expect(d.line).toBe(1);
          expect(d.column).toBe(start + 1);
          expect(d.message).toContain(bad);
          for (const name of lex.robotNames) {
            expect(d.message).toContain(name);
            expect(d.suggestion).toContain(name);
          }
        },
      ),
      propConfig,
    );
  });
});
