import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { tokenize } from '../tokenizer.js';
import { ACCEPTED_UNITS } from '../units.js';
import { arbLexicon, arbValidLine, propConfig } from './generators.js';

const NUMBER_FULL = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const ID_FULL = /^(?:R\d+\.|\d+\.\d*)$/;
const WS_ONLY = /^[ \t\r\n]*$/;

const arbPiece = fc.oneof(
  fc.constantFrom('\n', '\r\n', '\r', '\t', ' ', '😀', '𝒳', 'é', '#', ',', 'THE', 'robot', '200 N', '0.2 s',
    '5 mx', '3 m/s', '90°', '50 %', 'R3.', '2.1', '-1e3 kN', 'SHALL', '\u0000', '\u2028'),
  fc.string({ maxLength: 4 }),
  fc.string({ unit: 'binary', maxLength: 4 }),
);
const arbArbitrary = fc.array(arbPiece, { maxLength: 20 }).map((a) => a.join(''));
const arbValidText = arbLexicon.chain((lex) => arbValidLine(lex)).map((l) => l.text);

/** Checks every coverage and offset invariant for one input. */
function checkCoverage(input: string): void {
  const { tokens, diagnostics } = tokenize(input);
  // Items (tokens and error characters) in ascending, non-overlapping order.
  const items = [
    ...tokens.map((t) => ({ start: t.start, end: t.end, text: t.text, error: false })),
    ...diagnostics.map((d) => ({ start: d.start, end: d.end, text: input.slice(d.start, d.end), error: true })),
  ].sort((a, b) => a.start - b.start);

  let cursor = 0;
  let rebuilt = '';
  for (const it of items) {
    expect(it.start).toBeGreaterThanOrEqual(cursor); // no overlap
    expect(it.end).toBeGreaterThan(it.start);
    expect(it.end).toBeLessThanOrEqual(input.length);
    const gap = input.slice(cursor, it.start);
    expect(WS_ONLY.test(gap)).toBe(true); // gaps are whitespace only
    rebuilt += gap + it.text;
    cursor = it.end;
  }
  const tail = input.slice(cursor);
  expect(WS_ONLY.test(tail)).toBe(true);
  expect(rebuilt + tail).toBe(input);

  // Tokens: exact text, monotone offsets.
  let prevEnd = 0;
  for (const t of tokens) {
    expect(input.slice(t.start, t.end)).toBe(t.text);
    expect(t.end - t.start).toBe(t.text.length);
    expect(t.start).toBeGreaterThanOrEqual(prevEnd);
    prevEnd = t.end;
    if (t.type === 'number') expect(NUMBER_FULL.test(t.text)).toBe(true);
    if (t.type === 'unit') expect(ACCEPTED_UNITS).toContain(t.text);
    if (t.type === 'requirementId') expect(ID_FULL.test(t.text)).toBe(true);
    if (t.type === 'comma') expect(t.text).toBe(',');
  }
  // Diagnostics are a single code point each.
  for (const d of diagnostics) {
    expect([...input.slice(d.start, d.end)].length).toBe(1);
  }
  // Units directly follow a number token, separated by at most one space.
  tokens.forEach((t, i) => {
    if (t.type !== 'unit') return;
    const prev = tokens[i - 1];
    expect(prev?.type).toBe('number');
    expect(input.slice(prev!.end, t.start)).toMatch(/^ ?$/);
  });
  // An ID can only be the first token and starts the input after whitespace.
  tokens.forEach((t, i) => {
    if (t.type === 'requirementId') {
      expect(i).toBe(0);
      expect(diagnostics.every((d) => d.start > t.start)).toBe(true);
    }
  });
}

describe('tokenizer coverage and offsets', () => {
  it('Feature: golem-ears, Property 1: Tokenizer coverage and offsets (arbitrary strings)', () => {
    // **Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.10, 13.9**
    fc.assert(fc.property(arbArbitrary, checkCoverage), propConfig);
  });

  it('Feature: golem-ears, Property 1: Tokenizer coverage and offsets (valid lines)', () => {
    // **Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.10, 13.9**
    fc.assert(
      fc.property(arbValidText, (text) => {
        checkCoverage(text);
        expect(tokenize(text).diagnostics).toEqual([]);
      }),
      propConfig,
    );
  });

  it('Feature: golem-ears, Property 1: padding shifts offsets and keeps token texts', () => {
    // **Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.10, 13.9**
    const arbPad = fc.array(fc.constantFrom(' ', '\t', '\n', '\r\n'), { maxLength: 6 }).map((a) => a.join(''));
    fc.assert(
      fc.property(fc.oneof(arbValidText, arbArbitrary), arbPad, arbPad, (text, lead, trail) => {
        const base = tokenize(text);
        const padded = tokenize(lead + text + trail);
        expect(padded.tokens.map((t) => [t.type, t.text])).toEqual(base.tokens.map((t) => [t.type, t.text]));
        expect(padded.tokens.map((t) => t.start)).toEqual(base.tokens.map((t) => t.start + lead.length));
        expect(padded.diagnostics.map((d) => d.start)).toEqual(base.diagnostics.map((d) => d.start + lead.length));
      }),
      propConfig,
    );
  });

  it('covers a concrete mixed input with an illegal character and CRLF', () => {
    checkCoverage('R3. WHEN\r\n  the # robot 200 N, 5 mx 😀');
  });
});
