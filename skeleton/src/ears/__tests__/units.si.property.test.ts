import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { UNIT_TABLE, parseQuantity, quantityFromTokens } from '../units.js';
import { tokenize } from '../tokenizer.js';
import { arbQuantity, arbUnit } from './generators.js';
import { propConfig } from './support.js';

// Magnitudes 1e-6..1e9 written as plain decimals (String() never uses exponent notation here),
// so no subnormals and no exponent forms. Same domain reasoning as units.property.test.ts.
const arbPlainNumber = fc
  .double({ min: 1e-6, max: 1e9, noNaN: true, noDefaultInfinity: true })
  .map((v) => String(v));
const arbWide = fc
  .tuple(fc.oneof(fc.constant('0'), arbPlainNumber), fc.constantFrom('', ' '), arbUnit)
  .map(([num, sp, unit]) => ({ num, sp, unit, text: `${num}${sp}${unit}` }));

const arbWritten = fc.oneof(
  arbWide,
  arbQuantity().map((q) => {
    const m = /^(\d+(?:\.\d+)?)( ?)(.+)$/.exec(q.text)!;
    return { num: m[1]!, sp: m[2]!, unit: m[3]!, text: q.text };
  }),
);

// Feature: golem-ears, Property 4: Quantities convert to SI with the table kind and preserve text
// **Validates: Requirements 2.1, 2.2, 2.3, 2.12**
describe('quantity SI conversion', () => {
  it('parseQuantity gives si = number x factor, the unit kind, and the exact text', () => {
    fc.assert(
      fc.property(arbWritten, ({ num, unit, text }) => {
        const spec = UNIT_TABLE.find((u) => u.spelling === unit)!;
        const r = parseQuantity(text);
        expect(r.diagnostics).toEqual([]);
        expect(r.quantity).toBeDefined();
        expect(r.quantity!.kind).toBe(spec.kind);
        expect(r.quantity!.si).toBe(Number(num) * spec.factor);
        expect(r.quantity!.text).toBe(text);
      }),
      propConfig,
    );
  });

  it('quantityFromTokens on tokenized text gives the same SI value, kind and text', () => {
    fc.assert(
      fc.property(arbWritten, ({ num, unit, text }) => {
        const spec = UNIT_TABLE.find((u) => u.spelling === unit)!;
        // A leading word keeps a decimal like "607.5 N" from being read as a requirement ID.
        const input = `with ${text}`;
        const { tokens, diagnostics } = tokenize(input);
        expect(diagnostics).toEqual([]);
        expect(tokens.length).toBe(3);
        const [, n, u] = tokens;
        expect(n!.type).toBe('number');
        expect(u!.type).toBe('unit');
        const r = quantityFromTokens(n!, u, spec.kind === 'ratio' ? 'ratio' : spec.kind);
        expect(r.diagnostics).toEqual([]);
        expect(r.quantity!.kind).toBe(spec.kind);
        expect(r.quantity!.si).toBe(Number(num) * spec.factor);
        expect(r.quantity!.text).toBe(text);
        expect(input.slice(n!.start, u!.end)).toBe(r.quantity!.text);
      }),
      propConfig,
    );
  });
});
