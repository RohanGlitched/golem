import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeStudioHash, encodeStudioHash } from '../studio-url.js';
import { propConfig } from '../../../test/support/prop.js';

const finite = fc.oneof(
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(-0, 0, 1e-7, -1e-7, 1e21, -1e21, Number.MIN_VALUE, Number.MAX_VALUE),
);
const name = fc.oneof(fc.string({ minLength: 1, maxLength: 10 }), fc.constantFrom('push.force', 'a b', 'x&y=z', '#', '%20', 'ü', '__proto__'));

describe('Property 6: studio hash round trip', () => {
  // Feature: golem-kit, Property 6: Studio hash round trip
  it('decodes what it encodes and encodes the decoded value to the same hash', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1, maxLength: 12 }),
      fc.integer({ min: 0, max: 0xffffffff }),
      fc.array(fc.tuple(name, finite), { maxLength: 6 }),
      (reqId, seed, dims) => {
        const scenario: Record<string, number> = {};
        for (const [k, v] of dims) Object.defineProperty(scenario, k, { value: v, enumerable: true, writable: true, configurable: true });
        const h = { reqId, seed, scenario };
        const hash = encodeStudioHash(h);
        const d = decodeStudioHash(hash);
        expect(d.reqId).toBe(reqId);
        expect(d.seed).toBe(seed);
        expect(Object.keys(d.scenario).sort()).toEqual(Object.keys(scenario).sort());
        for (const k of Object.keys(scenario)) expect(Object.is(d.scenario[k], scenario[k])).toBe(true);
        expect(encodeStudioHash(d)).toBe(hash);
      },
    ), propConfig);
  });
});
