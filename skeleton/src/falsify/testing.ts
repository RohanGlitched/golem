// Test-only helpers (separate entry). Never imported by engine code.
import fc from 'fast-check';
import type { Dimension, ScenarioSpace } from './contract.js';

export const arbDimension = (name: string): fc.Arbitrary<Dimension> =>
  fc.oneof(
    // fixed
    fc.record({ min: fc.double({ min: -100, max: 100, noNaN: true }) }).map(
      ({ min }): Dimension => ({ name, kind: 'length', min, max: min, severity: 'none' }),
    ),
    // ranged, optionally wrapping
    fc.record({
      min: fc.double({ min: -100, max: 100, noNaN: true }),
      width: fc.double({ min: 0.01, max: 100, noNaN: true }),
      severity: fc.constantFrom('up' as const, 'down' as const, 'none' as const),
      wrap: fc.boolean(),
    }).map(({ min, width, severity, wrap }): Dimension => ({
      name,
      kind: wrap ? 'angle' : 'force',
      min,
      max: min + width,
      severity,
      ...(wrap ? { wrap: true } : {}),
    })),
  );

/** 1 to 6 dimensions mixing fixed, up, down, none and wrap. */
export const arbSpace: fc.Arbitrary<ScenarioSpace> = fc
  .integer({ min: 1, max: 6 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => arbDimension(`d${i}`))))
  .map((dims) => ({ dims }));
