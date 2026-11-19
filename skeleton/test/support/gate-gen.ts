// Generators shared by the gate counter properties.
import fc from 'fast-check';
import type { GateState } from '../../src/cli/types.js';

export const arbSession = fc.oneof(fc.constantFrom('default', 's1', 's2', 's3', '__proto__', 'constructor'), fc.string({ minLength: 1, maxLength: 6 }));
export const arbIso = fc.integer({ min: Date.parse('2026-01-01T00:00:00Z'), max: Date.parse('2027-01-01T00:00:00Z') }).map((t) => new Date(t).toISOString());
export const arbEntry = fc.record({ count: fc.integer({ min: 0, max: 5 }), updatedAt: arbIso });
export const arbState: fc.Arbitrary<GateState> = fc.array(fc.tuple(arbSession, arbEntry), { maxLength: 5 }).map((kv) => {
  const s: GateState = {};
  for (const [k, v] of kv) Object.defineProperty(s, k, { value: v, enumerable: true, writable: true, configurable: true });
  return s;
});
/** Elapsed seconds that never dedupe. */
export const arbOutside = fc.oneof(fc.constant(undefined), fc.double({ min: 2, max: 1e6, noNaN: true }), fc.double({ min: -1e6, max: -1e-9, noNaN: true }));
/** Elapsed seconds inside the dedupe window. */
export const arbInside = fc.double({ min: 0, max: 1.999, noNaN: true });
