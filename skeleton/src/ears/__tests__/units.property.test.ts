import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ACCEPTED_UNITS, fromSI, toSI } from '../units.js';
import { propConfig } from './support.js';

// Feature: golem-ears, Property 5: Unit conversion is the identity
// **Validates: Requirements 2.11, 13.4**
describe('unit conversion', () => {
  const arbUnit = fc.constantFrom(...ACCEPTED_UNITS);
  // Zero or magnitudes 1e-100..1e9. Subnormal doubles (below ~2e-308) lose precision in any
  // IEEE-754 multiply, so a 1e-12 relative bound cannot hold there for any implementation.
  const arbValue = fc.oneof(
    fc.constant(0),
    fc.double({ min: 1e-100, max: 1e9, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 1e-100, max: 1e9, noNaN: true, noDefaultInfinity: true }).map((v) => -v),
  );

  it('fromSI(toSI(x, u), u) equals x within 1e-12 relative error for every accepted unit', () => {
    fc.assert(
      fc.property(arbValue, arbUnit, (x, u) => {
        const back = fromSI(toSI(x, u), u);
        if (x === 0) return back === 0;
        return Math.abs(back - x) <= 1e-12 * Math.abs(x);
      }),
      propConfig,
    );
  });

  it('returns exactly 0 for 0 in every accepted unit', () => {
    for (const u of ACCEPTED_UNITS) {
      expect(fromSI(toSI(0, u), u)).toBe(0);
    }
  });
});
