import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { tokenize } from '../tokenizer.js';
import { propConfig } from './support.js';

const KEYWORDS = ['WHEN', 'WHILE', 'IF', 'THEN', 'WHERE', 'THE', 'SHALL'] as const;

const arbKeyword = fc.constantFrom(...KEYWORDS);
const arbLetters = fc.stringMatching(/^[A-Za-z]{1,6}$/);

/** A keyword with each letter independently upper- or lower-cased. */
const arbCased = arbKeyword.chain((kw) =>
  fc
    .array(fc.boolean(), { minLength: kw.length, maxLength: kw.length })
    .map((flags) => [...kw].map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase())).join('')),
);

describe('tokenizer keyword recognition', () => {
  it('Feature: golem-ears, Property 3: Keyword recognition ignores case and whole-word only (case variants)', () => {
    // **Validates: Requirements 1.6, 1.7**
    fc.assert(
      fc.property(arbCased, (text) => {
        const { tokens, diagnostics } = tokenize(text);
        expect(diagnostics).toEqual([]);
        expect(tokens).toHaveLength(1);
        expect(tokens[0]?.type).toBe('keyword');
        expect(tokens[0]?.text).toBe(text);
      }),
      propConfig,
    );
  });

  it('Feature: golem-ears, Property 3: Keyword recognition ignores case and whole-word only (words containing keywords)', () => {
    // **Validates: Requirements 1.6, 1.7**
    const arbAffixed = fc
      .tuple(arbCased, fc.oneof(arbLetters, fc.constant('')), fc.oneof(arbLetters, fc.constant('')))
      .filter(([, pre, suf]) => pre.length + suf.length > 0)
      .map(([kw, pre, suf]) => pre + kw + suf);
    fc.assert(
      fc.property(arbAffixed, (text) => {
        const { tokens, diagnostics } = tokenize(text);
        expect(diagnostics).toEqual([]);
        expect(tokens).toHaveLength(1);
        expect(tokens[0]?.type).toBe('word');
        expect(tokens[0]?.text).toBe(text);
      }),
      propConfig,
    );
  });

  it('treats THENCE, IFFY and SHALLOW as plain words', () => {
    for (const w of ['THENCE', 'IFFY', 'SHALLOW']) {
      expect(tokenize(w).tokens.map((t) => [t.type, t.text])).toEqual([['word', w]]);
    }
  });
});
