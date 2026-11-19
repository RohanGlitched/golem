import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseQuantity, quantityFromTokens } from '../units.js';
import type { Kind, SlotKind, Token } from '../types.js';
import { propConfig } from './support.js';

// Feature: golem-ears, Property 7: Bare numbers are accepted only for count and in-range ratio
// **Validates: Requirements 2.5, 2.6, 2.7, 2.8**
describe('bare numbers', () => {
  const digits = (min: number, max: number) =>
    fc.array(fc.constantFrom(...'0123456789'), { minLength: min, maxLength: max }).map((a) => a.join(''));

  // Decimal numbers with optional sign, fraction and exponent. All finite.
  const arbNumberText = fc
    .record({
      sign: fc.constantFrom('', '+', '-'),
      int: digits(1, 8),
      frac: fc.option(digits(1, 8), { nil: undefined }),
      exp: fc.option(fc.integer({ min: -20, max: 20 }), { nil: undefined }),
      expMark: fc.constantFrom('e', 'E'),
    })
    .map(
      (r) =>
        r.sign + r.int + (r.frac !== undefined ? '.' + r.frac : '') +
        (r.exp !== undefined ? r.expMark + String(r.exp) : ''),
    );

  // Numbers biased towards the ratio interval and its edges.
  const arbRatioish = fc.oneof(
    arbNumberText,
    fc.double({ min: 0, max: 1, noNaN: true }).map((x) => String(x)),
    fc.constantFrom('0', '1', '0.0', '1.0', '1.0000001', '0.9999999', '-0.5', '2', '00.5'),
  );

  const arbOtherKind = fc.constantFrom<SlotKind>(
    'force', 'duration', 'length', 'speed', 'angle', 'mass', 'phase', 'direction', 'range',
  );

  const arbPos = fc.record({
    line: fc.integer({ min: 1, max: 50 }),
    column: fc.integer({ min: 1, max: 200 }),
    start: fc.integer({ min: 0, max: 1000 }),
  });

  function numToken(text: string, p: { line: number; column: number; start: number }): Token {
    return { type: 'number', text, start: p.start, end: p.start + text.length, line: p.line, column: p.column };
  }

  it('a count slot accepts a bare number exactly when it is an unsigned integer', () => {
    fc.assert(
      fc.property(arbNumberText, arbPos, (text, p) => {
        const r = quantityFromTokens(numToken(text, p), undefined, 'count');
        if (/^\d+$/.test(text)) {
          return (
            r.diagnostics.length === 0 &&
            r.quantity?.kind === 'count' &&
            r.quantity.si === Number(text)
          );
        }
        const d = r.diagnostics[0];
        return r.quantity === undefined && r.diagnostics.length === 1 && d!.kind === 'BAD_RANGE' &&
          d!.line === p.line && d!.column === p.column;
      }),
      propConfig,
    );
  });

  it('a ratio slot accepts a bare number exactly when it lies in [0, 1], else BAD_RANGE at the number', () => {
    fc.assert(
      fc.property(arbRatioish, arbPos, (text, p) => {
        const v = Number(text);
        const r = quantityFromTokens(numToken(text, p), undefined, 'ratio');
        if (v >= 0 && v <= 1) {
          return r.diagnostics.length === 0 && r.quantity?.kind === 'ratio' && r.quantity.si === v;
        }
        const d = r.diagnostics[0];
        return r.quantity === undefined && r.diagnostics.length === 1 && d!.kind === 'BAD_RANGE' &&
          d!.line === p.line && d!.column === p.column && d!.message.includes('[0, 1]');
      }),
      propConfig,
    );
  });

  it('every other slot reports MISSING_UNIT at the number and returns no Quantity', () => {
    fc.assert(
      fc.property(arbNumberText, arbOtherKind, arbPos, (text, slot, p) => {
        const r = quantityFromTokens(numToken(text, p), undefined, slot);
        const d = r.diagnostics[0];
        return r.quantity === undefined && r.diagnostics.length === 1 && d!.kind === 'MISSING_UNIT' &&
          d!.line === p.line && d!.column === p.column;
      }),
      propConfig,
    );
  });

  it('parseQuantity applies the same rules to text and locates the number after leading spaces', () => {
    const arbSlot = fc.constantFrom<SlotKind>('count', 'ratio', 'force', 'length', 'phase');
    fc.assert(
      fc.property(arbNumberText, arbSlot, fc.integer({ min: 0, max: 5 }), (text, slot, lead) => {
        const input = ' '.repeat(lead) + text;
        const r = parseQuantity(input, slot);
        const v = Number(text);
        const ok =
          slot === 'count' ? /^\d+$/.test(text) : slot === 'ratio' ? v >= 0 && v <= 1 : false;
        if (ok) {
          const k: Kind = slot as Kind;
          return r.diagnostics.length === 0 && r.quantity?.kind === k && r.quantity.si === v;
        }
        const d = r.diagnostics[0];
        const expected = slot === 'count' || slot === 'ratio' ? 'BAD_RANGE' : 'MISSING_UNIT';
        return r.quantity === undefined && d?.kind === expected && d.line === 1 && d.column === lead + 1;
      }),
      propConfig,
    );
  });

  it('rejects a bare 1.5 for a ratio and a bare 2.5 for a count', () => {
    expect(parseQuantity('1.5', 'ratio').diagnostics[0]?.kind).toBe('BAD_RANGE');
    expect(parseQuantity('2.5', 'count').diagnostics[0]?.kind).toBe('BAD_RANGE');
    expect(parseQuantity('3', 'count').quantity?.si).toBe(3);
  });
});
