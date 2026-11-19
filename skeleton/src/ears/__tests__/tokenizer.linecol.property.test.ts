import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { tokenize } from '../tokenizer.js';
import { propConfig } from './support.js';
import { refLineColumn } from './refTokenize.js';

// Pieces that stress breaks, tabs, non-BMP characters, illegal characters and real tokens.
const arbPiece = fc.oneof(
  fc.constantFrom('\n', '\r\n', '\r', '\t', ' ', '😀', '𝒳', 'é', '#', ',', 'THE', 'robot', '200 N', '0.2 s', 'R3.', '2.1', 'SHALL'),
  fc.string({ maxLength: 4 }),
);
const arbInput = fc.array(arbPiece, { maxLength: 20 }).map((a) => a.join(''));

describe('refLineColumn', () => {
  it('counts \\r\\n as one break and non-BMP characters as two columns', () => {
    expect(refLineColumn('a\r\nb', 3)).toEqual({ line: 2, column: 1 });
    expect(refLineColumn('😀x', 2)).toEqual({ line: 1, column: 3 });
    expect(refLineColumn('\t\tx', 2)).toEqual({ line: 1, column: 3 });
  });
});

describe('tokenizer line and column', () => {
  it('Feature: golem-ears, Property 2: Tokenizer line and column agree with an independent calculation', () => {
    // **Validates: Requirements 1.8, 8.9**
    fc.assert(
      fc.property(arbInput, (input) => {
        const { tokens, diagnostics } = tokenize(input);
        for (const x of [...tokens, ...diagnostics]) {
          const ref = refLineColumn(input, x.start);
          expect({ line: x.line, column: x.column }).toEqual(ref);
        }
      }),
      propConfig,
    );
  });
});
