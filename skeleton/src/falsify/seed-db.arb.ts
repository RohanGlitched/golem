// Test-only generators for seed database properties.
import fc from 'fast-check';
import type { PinnedSeedEntry } from './types.js';

const num = fc.double({ min: -1e6, max: 1e6, noNaN: true }).map((x) => (x === 0 ? 0 : x));
const dimName = fc.constantFrom('push.force', 'push.angle', 'push.duration', 'stride.phase', 'hand.speed');

export const arbEntry: fc.Arbitrary<PinnedSeedEntry> = fc
  .record({
    reqId: fc.constantFrom('R1', 'R2'),
    scenario: fc.dictionary(dimName, num, { minKeys: 1, maxKeys: 4 }),
    seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
    robustness: num,
    shrunk: fc.boolean(),
    foundAfter: fc.nat(10000),
    extra: fc.option(
      fc.record({
        classification: fc.constantFrom('robust' as const, 'seed-sensitive' as const),
        verificationSeeds: fc.tuple(fc.nat(2 ** 31), fc.nat(2 ** 31), fc.nat(2 ** 31)).map((t) => [...t]),
        verificationRobustness: fc.tuple(fc.option(num, { nil: null }), fc.option(num, { nil: null }), fc.option(num, { nil: null })).map((t) => [...t]),
      }),
      { nil: undefined },
    ),
  })
  .map(({ extra, ...base }): PinnedSeedEntry => ({ ...base, ...(extra ?? {}) }));
