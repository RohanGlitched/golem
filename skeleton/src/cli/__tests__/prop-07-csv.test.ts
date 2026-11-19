import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { traceToCsv } from '../csv.js';
import { propConfig } from '../../../test/support/prop.js';

const num = fc.oneof(fc.double({ noNaN: false }), fc.constantFrom(-0, 0, 1e-7, 1e21));

describe('Property 7: replay CSV is exact and deterministic', () => {
  // Feature: golem-kit, Property 7: Replay CSV is exact and deterministic
  it('has the right header and rows, every cell parses back to the identical number, and two calls agree', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 30 }),
      fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9_.]{0,6}$/), { minLength: 0, maxLength: 4 }),
      fc.infiniteStream(num),
      (n, names, stream) => {
        const it = stream[Symbol.iterator]();
        const next = (): number => it.next().value as number;
        const t = Float64Array.from({ length: n }, next);
        const signals: Record<string, Float64Array> = {};
        for (const k of names) signals[k] = Float64Array.from({ length: n }, next);
        const trace = { t, signals, events: [] };
        const csv = traceToCsv(trace);
        expect(traceToCsv(trace)).toBe(csv);
        const lines = csv.split('\n');
        expect(lines.pop()).toBe('');
        expect(lines[0]).toBe(['t', ...Object.keys(signals)].join(','));
        expect(lines).toHaveLength(n + 1);
        for (let i = 0; i < n; i++) {
          const cells = (lines[i + 1] as string).split(',');
          expect(cells).toHaveLength(1 + names.length);
          expect(Object.is(Number(cells[0]), t[i])).toBe(true);
          names.forEach((k, j) => expect(Object.is(Number(cells[j + 1]), (signals[k] as Float64Array)[i])).toBe(true));
        }
      },
    ), propConfig);
  });
});
