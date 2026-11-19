// Feature: candy-app, Property 27: Non-finite input gives negative infinity
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lexicon } from '../lexicon';

const bad = fc.constantFrom(NaN, Infinity, -Infinity);

describe('non-finite input', () => {
  it('gives -Infinity for any predicate when any signal value is NaN or infinite', () => {
    fc.assert(fc.property(fc.constantFrom(...lexicon.predicates), bad, fc.integer({ min: 0, max: 3 }), fc.double({ min: 0, max: 5, noNaN: true }), (p, v, which, other) => {
      const s: Record<string, number> = {};
      for (const name of p.signals) s[name] = other;
      s[p.signals[which % p.signals.length]!] = v;
      const slots = { length: 0.1, speed: 1, force: 100, duration: 10 };
      expect(p.margin(s, slots)).toBe(-Infinity);
    }), { numRuns: 500 });
  });

  it('gives -Infinity when a slot value is not finite', () => {
    fc.assert(fc.property(bad, fc.double({ min: 0, max: 5, noNaN: true }), (v, other) => {
      const sig = { min_link_hand_distance: other, fastest_link_speed: other, table_force: other };
      for (const p of lexicon.predicates.filter((x) => /\{(length|speed|force)\}/.test(x.phrase))) {
        expect(p.margin(sig, { length: v, speed: v, force: v })).toBe(-Infinity);
      }
    }), { numRuns: 100 });
  });
});
