import fc from 'fast-check';
import type { WildToken } from '../editDistance.js';

type Item = string | WildToken;

/** Small alphabet so that equal tokens, case variants and wildcards collide often. */
const arbToken: fc.Arbitrary<Item> = fc.oneof(
  fc.constantFrom('push', 'PUSH', 'Push', 'stay', 'STAY', 'keep', 'the'),
  fc.constantFrom('push', 'stay', 'keep').map((word): Item => ({ word })),
  fc
    .constantFrom<Array<'force' | 'duration' | 'length' | 'range' | 'direction'>>('force', 'duration', 'length', 'range', 'direction')
    .map((wild): Item => ({ wild })),
);

/** Token sequences of length 0 to `maxLen` (default 8) over a small alphabet. */
export function arbTokenSeq(maxLen = 8): fc.Arbitrary<Item[]> {
  return fc.array(arbToken, { minLength: 0, maxLength: maxLen });
}
