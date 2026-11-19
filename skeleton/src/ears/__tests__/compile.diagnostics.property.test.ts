import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import type { Diagnostic } from '../diagnostics.js';
import { arbLexicon, arbMutation, arbValidLine } from './generators.js';
import { refLineColumn } from './refTokenize.js';
import { propConfig } from './support.js';

const KINDS = new Set([
  'PATTERN_MISMATCH', 'MISSING_UNIT', 'UNKNOWN_PHRASE', 'BAD_RANGE', 'UNKNOWN_ROBOT', 'NON_EARS_LINE',
]);

function checkOutcome(source: string, diagnostics: Diagnostic[], hasRequirement: boolean): void {
  for (const d of diagnostics) {
    expect(KINDS.has(d.kind)).toBe(true);
    expect(['error', 'warning']).toContain(d.severity);
    expect(d.message.length).toBeGreaterThan(0);
    expect(d.line).toBeGreaterThanOrEqual(1);
    expect(d.column).toBeGreaterThanOrEqual(1);
    expect(d.end).toBeGreaterThanOrEqual(d.start);
    expect(d.start).toBeGreaterThanOrEqual(0);
    expect(d.start).toBeLessThanOrEqual(source.length);
    expect(d.end).toBeLessThanOrEqual(source.length);
    const lc = refLineColumn(source, d.start);
    expect({ line: d.line, column: d.column }).toEqual(lc);
  }
  for (let i = 1; i < diagnostics.length; i++) {
    expect(diagnostics[i]!.start).toBeGreaterThanOrEqual(diagnostics[i - 1]!.start);
  }
  const anyError = diagnostics.some((d) => d.severity === 'error');
  expect(hasRequirement).toBe(!anyError);
}

// Feature: golem-ears, Property 28: Diagnostics are well formed, ordered, positioned and decide the outcome
describe('Feature: golem-ears, Property 28: Diagnostics are well formed, ordered, positioned and decide the outcome', () => {
  it('holds for valid lines', () => {
    // **Validates: Requirements 8.1, 8.7, 8.8, 8.11, 8.12**
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) => arbValidLine(lex).map((g) => ({ lex, g }))),
        ({ lex, g }) => {
          const r = compileRequirement(g.text, lex);
          checkOutcome(g.text, r.diagnostics, r.requirement !== undefined);
        },
      ),
      propConfig,
    );
  });

  it('holds for lines with one or several independent mutations', () => {
    // **Validates: Requirements 8.1, 8.7, 8.8, 8.11, 8.12**
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) =>
          arbValidLine(lex).chain((g) =>
            arbMutation(g.text).chain((m1) =>
              arbMutation(m1.text).chain((m2) =>
                arbMutation(m2.text).map((m3) => ({ lex, texts: [m1.text, m2.text, m3.text] })),
              ),
            ),
          ),
        ),
        ({ lex, texts }) => {
          for (const text of texts) {
            const r = compileRequirement(text, lex);
            checkOutcome(text, r.diagnostics, r.requirement !== undefined);
          }
        },
      ),
      propConfig,
    );
  });
});
