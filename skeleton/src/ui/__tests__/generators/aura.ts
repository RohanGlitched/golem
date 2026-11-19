import fc from 'fast-check';

export interface AuraTrial { angle: number; force: number; robustness: number }

export const arbRobustness = fc.oneof(
  fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(0, -0, Number.NaN, -Infinity, 1e-300, -1e-300),
);

export const arbAuraTrial: fc.Arbitrary<AuraTrial> = fc.record({
  angle: fc.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true }),
  // Integer forces make ties between trials likely.
  force: fc.oneof(fc.integer({ min: 0, max: 300 }), fc.double({ min: 0, max: 300, noNaN: true })),
  robustness: arbRobustness,
});

export const arbAuraTrials = fc.array(arbAuraTrial, { maxLength: 200 });
