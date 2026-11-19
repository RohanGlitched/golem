import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { tokenize } from '../tokenizer.js';
import { parseRangePhrase } from '../ranges.js';
import type { Kind, Quantity } from '../types.js';
import { arbQuantity } from './generators.js';
import { propConfig } from './support.js';

const PREFIX = 'with ';
const RANGE_KINDS: Kind[] = ['force', 'duration', 'length', 'speed', 'angle', 'mass', 'ratio'];
const NON_NEGATIVE_KINDS: Kind[] = ['force', 'duration', 'length', 'speed', 'mass'];

// The prefix word keeps a leading decimal from being read as a requirement ID.
function parseAfterWord(body: string) {
  const { tokens, diagnostics } = tokenize(PREFIX + body);
  expect(diagnostics).toEqual([]);
  return { tokens, result: parseRangePhrase(tokens, 1) };
}

// Column (1-based) where `offset` of `body` lands on the single line `PREFIX + body`.
const columnOf = (offsetInBody: number) => PREFIX.length + offsetInBody + 1;

const arbStrictlyOrdered: fc.Arbitrary<[Quantity, Quantity]> = fc
  .constantFrom(...RANGE_KINDS)
  .chain((k) => fc.tuple(arbQuantity(k), arbQuantity(k)))
  .filter(([a, b]) => a.si !== b.si)
  .map(([a, b]) => (a.si > b.si ? [a, b] : [b, a]));

const arbMixedKinds: fc.Arbitrary<[Quantity, Quantity]> = fc
  .tuple(fc.constantFrom(...RANGE_KINDS), fc.constantFrom(...RANGE_KINDS))
  .filter(([k1, k2]) => k1 !== k2)
  .chain(([k1, k2]) => fc.tuple(arbQuantity(k1), arbQuantity(k2)));

const arbNegative: fc.Arbitrary<Quantity> = fc
  .constantFrom(...NON_NEGATIVE_KINDS)
  .chain((k) => arbQuantity(k))
  .filter((q) => q.si > 0)
  .map((q) => ({ kind: q.kind, si: -q.si, text: `-${q.text}` }));

// Feature: golem-ears, Property 13: Invalid ranges are rejected with BAD_RANGE
// **Validates: Requirements 4.7, 4.8, 4.9**
describe('invalid range phrases', () => {
  it('rejects a minimum above the maximum with BAD_RANGE at the second quantity', () => {
    fc.assert(
      fc.property(arbStrictlyOrdered, ([hi, lo]) => {
        const body = `${hi.text} to ${lo.text}`;
        const { result } = parseAfterWord(body);
        expect(result.range).toBeUndefined();
        expect(result.diagnostics).toHaveLength(1);
        const d = result.diagnostics[0]!;
        expect(d.kind).toBe('BAD_RANGE');
        expect(d.severity).toBe('error');
        expect(d.line).toBe(1);
        const secondAt = hi.text.length + ' to '.length;
        expect(d.column).toBe(columnOf(secondAt));
        expect(d.start).toBe(PREFIX.length + secondAt);
      }),
      propConfig,
    );
  });

  it('rejects a range that mixes kinds with BAD_RANGE at the second quantity', () => {
    fc.assert(
      fc.property(arbMixedKinds, ([a, b]) => {
        const body = `${a.text} to ${b.text}`;
        const { result } = parseAfterWord(body);
        expect(result.range).toBeUndefined();
        expect(result.diagnostics).toHaveLength(1);
        const d = result.diagnostics[0]!;
        expect(d.kind).toBe('BAD_RANGE');
        expect(d.line).toBe(1);
        expect(d.column).toBe(columnOf(a.text.length + ' to '.length));
      }),
      propConfig,
    );
  });

  it('rejects a negative force, duration, length, speed or mass with BAD_RANGE at the quantity', () => {
    fc.assert(
      fc.property(arbNegative, (neg) => {
        const { result: lone } = parseAfterWord(neg.text);
        expect(lone.range).toBeUndefined();
        expect(lone.diagnostics).toHaveLength(1);
        expect(lone.diagnostics[0]!.kind).toBe('BAD_RANGE');
        expect(lone.diagnostics[0]!.column).toBe(columnOf(0));

        const upTo = 'up to ';
        const { result: up } = parseAfterWord(`${upTo}${neg.text}`);
        expect(up.range).toBeUndefined();
        expect(up.diagnostics).toHaveLength(1);
        expect(up.diagnostics[0]!.kind).toBe('BAD_RANGE');
        expect(up.diagnostics[0]!.column).toBe(columnOf(upTo.length));
      }),
      propConfig,
    );
  });

  it('rejects a negative bound in a `<q> to <q>` range with BAD_RANGE at that bound', () => {
    fc.assert(
      fc.property(
        arbNegative.chain((neg) => fc.tuple(fc.constant(neg), arbQuantity(neg.kind))),
        ([neg, pos]) => {
          const first = parseAfterWord(`${neg.text} to ${pos.text}`).result;
          expect(first.range).toBeUndefined();
          expect(first.diagnostics.length).toBeGreaterThanOrEqual(1);
          expect(first.diagnostics.every((d) => d.kind === 'BAD_RANGE')).toBe(true);
          expect(first.diagnostics[0]!.column).toBe(columnOf(0));

          const second = parseAfterWord(`${pos.text} to ${neg.text}`).result;
          expect(second.range).toBeUndefined();
          expect(second.diagnostics.length).toBeGreaterThanOrEqual(1);
          expect(second.diagnostics.every((d) => d.kind === 'BAD_RANGE')).toBe(true);
          expect(second.diagnostics[0]!.column).toBe(columnOf(pos.text.length + ' to '.length));
        },
      ),
      propConfig,
    );
  });

  it('rejects a mixed-kind example with BAD_RANGE', () => {
    const { result } = parseAfterWord('5 N to 3 s');
    expect(result.range).toBeUndefined();
    expect(result.diagnostics[0]!.kind).toBe('BAD_RANGE');
    expect(result.diagnostics[0]!.column).toBe(columnOf('5 N to '.length));
  });
});
