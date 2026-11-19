import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { UNIT_TABLE } from '../units.js';
import { tokenize } from '../tokenizer.js';
import { parseRangePhrase, rangeToDimension } from '../ranges.js';
import type { Kind, Quantity } from '../types.js';
import { arbQuantity } from './generators.js';
import { propConfig } from './support.js';

// A leading word keeps a decimal at the very start from being read as a requirement ID.
function parseAfterWord(text: string) {
  const { tokens, diagnostics } = tokenize(`with ${text}`);
  expect(diagnostics).toEqual([]);
  return { tokens, result: parseRangePhrase(tokens, 1) };
}

const arbSeverity = fc.constantFrom<'up' | 'down' | 'none'>('up', 'down', 'none');
const arbName = fc.constantFrom('push.force', 'push.angle', 'push.duration', 'stride.phase', 'x');
const RANGE_KINDS: Kind[] = ['force', 'duration', 'length', 'speed', 'angle', 'mass', 'ratio'];

// Two quantities of the same kind, ordered by SI value (equal values allowed).
const arbOrderedPair: fc.Arbitrary<[Quantity, Quantity]> = fc
  .constantFrom(...RANGE_KINDS)
  .chain((k) => fc.tuple(arbQuantity(k), arbQuantity(k)))
  .map(([a, b]) => (a.si <= b.si ? [a, b] : [b, a]));

const arbNumText = fc.oneof(
  fc.integer({ min: 0, max: 1000 }).map(String),
  fc.tuple(fc.integer({ min: 0, max: 999 }), fc.integer({ min: 0, max: 99 })).map(([i, d]) => `${i}.${d}`),
);

// Feature: golem-ears, Property 12: Range phrases produce the right interval and Dimension
// **Validates: Requirements 4.1, 4.2, 4.6, 4.11, 4.12, 5.8**
describe('range phrases', () => {
  it('`up to <q>` yields [0, q.si] with the quantity kind, not wrapped, not fixed unless zero', () => {
    fc.assert(
      fc.property(arbQuantity(), (q) => {
        const { tokens, result } = parseAfterWord(`up to ${q.text}`);
        expect(result.diagnostics).toEqual([]);
        expect(result.next).toBe(tokens.length);
        const r = result.range!;
        expect(r.kind).toBe(q.kind);
        expect(r.min).toBe(0);
        expect(r.max).toBe(q.si);
        expect(r.min).toBeLessThanOrEqual(r.max);
        expect(r.wrap).toBe(false);
        expect(r.fixed).toBe(q.si === 0);
      }),
      propConfig,
    );
  });

  it('`<q1> to <q2>` yields [q1.si, q2.si] for same-kind quantities, equal values allowed', () => {
    fc.assert(
      fc.property(arbOrderedPair, ([a, b]) => {
        const { tokens, result } = parseAfterWord(`${a.text} to ${b.text}`);
        expect(result.diagnostics).toEqual([]);
        expect(result.next).toBe(tokens.length);
        const r = result.range!;
        expect(r.kind).toBe(a.kind);
        expect(r.min).toBe(a.si);
        expect(r.max).toBe(b.si);
        expect(r.wrap).toBe(false);
        expect(r.fixed).toBe(a.si === b.si);
      }),
      propConfig,
    );
  });

  it('`<n1> to <n2> <unit>` shares the unit between both numbers', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...UNIT_TABLE),
        arbNumText,
        arbNumText,
        fc.constantFrom('', ' '),
        (u, x, y, sp) => {
          const [lo, hi] = Number(x) <= Number(y) ? [x, y] : [y, x];
          const { tokens, result } = parseAfterWord(`${lo} to ${hi}${sp}${u.spelling}`);
          expect(result.diagnostics).toEqual([]);
          expect(result.next).toBe(tokens.length);
          const r = result.range!;
          expect(r.kind).toBe(u.kind);
          expect(r.min).toBe(Number(lo) * u.factor);
          expect(r.max).toBe(Number(hi) * u.factor);
        },
      ),
      propConfig,
    );
  });

  it('a lone quantity yields a fixed value with min === max equal to its SI value', () => {
    fc.assert(
      fc.property(arbQuantity(), (q) => {
        const { tokens, result } = parseAfterWord(q.text);
        expect(result.diagnostics).toEqual([]);
        expect(result.next).toBe(tokens.length);
        const r = result.range!;
        expect(r.kind).toBe(q.kind);
        expect(r.min).toBe(q.si);
        expect(r.max).toBe(q.si);
        expect(r.fixed).toBe(true);
        expect(r.wrap).toBe(false);
      }),
      propConfig,
    );
  });

  it('named ranges give the constant interval and wrap flag', () => {
    const named = [
      { text: 'from any direction', kind: 'angle', min: 0, max: 2 * Math.PI },
      { text: 'from behind', kind: 'angle', min: (3 * Math.PI) / 4, max: (5 * Math.PI) / 4 },
      { text: 'at any point in its stride', kind: 'phase', min: 0, max: 1 },
    ] as const;
    fc.assert(
      fc.property(
        fc.constantFrom(...named),
        fc.constantFrom(' ', '  ', '\t'),
        fc.boolean(),
        (n, sep, upper) => {
          const text = (upper ? n.text.toUpperCase() : n.text).split(' ').join(sep);
          const { tokens, result } = parseAfterWord(text);
          expect(result.diagnostics).toEqual([]);
          expect(result.next).toBe(tokens.length);
          const r = result.range!;
          expect(r.kind).toBe(n.kind);
          expect(r.min).toBe(n.min);
          expect(r.max).toBe(n.max);
          expect(r.wrap).toBe(true);
          expect(r.fixed).toBe(false);
        },
      ),
      propConfig,
    );
  });

  it('each range becomes exactly one Dimension with matching name, kind, min, max and severity', () => {
    const arbText = fc.oneof(
      arbQuantity().map((q) => `up to ${q.text}`),
      arbOrderedPair.map(([a, b]) => `${a.text} to ${b.text}`),
      arbQuantity().map((q) => q.text),
    );
    fc.assert(
      fc.property(arbText, arbName, arbSeverity, (text, name, severity) => {
        const { result } = parseAfterWord(text);
        const r = result.range!;
        const d = rangeToDimension(name, r, severity);
        expect(d.name).toBe(name);
        expect(d.kind).toBe(r.kind);
        expect(d.min).toBe(r.min);
        expect(d.max).toBe(r.max);
        expect(d.severity).toBe(severity);
        expect('wrap' in d).toBe(false);
        if (r.fixed) expect(d.min).toBe(d.max);
      }),
      propConfig,
    );
  });

  it('wrap is set on the Dimension only for named angle and phase ranges, and a fixed value has min === max', () => {
    const named = ['from any direction', 'from behind', 'at any point in its stride'];
    fc.assert(
      fc.property(fc.constantFrom(...named), arbName, arbSeverity, (text, name, severity) => {
        const { result } = parseAfterWord(text);
        const r = result.range!;
        const d = rangeToDimension(name, r, severity);
        expect(d.wrap).toBe(true);
        expect(['angle', 'phase']).toContain(d.kind);
        expect(d.min).toBe(r.min);
        expect(d.max).toBe(r.max);
        expect(d.severity).toBe(severity);
      }),
      propConfig,
    );
    fc.assert(
      fc.property(arbQuantity('angle'), arbName, arbSeverity, (q, name, severity) => {
        const { result } = parseAfterWord(`up to ${q.text}`);
        const d = rangeToDimension(name, result.range!, severity);
        expect(d.wrap).toBeUndefined();
      }),
      propConfig,
    );
    fc.assert(
      fc.property(arbQuantity(), arbName, arbSeverity, (q, name, severity) => {
        const { result } = parseAfterWord(q.text);
        const d = rangeToDimension(name, result.range!, severity);
        expect(d.min).toBe(d.max);
        expect(d.min).toBe(q.si);
      }),
      propConfig,
    );
  });
});
