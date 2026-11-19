import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { selectReplay } from '../replay-target.js';
import type { Counterexample } from '../sibling-types.js';
import { propConfig } from '../../../test/support/prop.js';

const arbCe: fc.Arbitrary<Counterexample> = fc.record({
  reqId: fc.constant('R1'),
  scenario: fc.dictionary(fc.constantFrom('a', 'b'), fc.double({ noNaN: true, noDefaultInfinity: true }), { minKeys: 1 }),
  seed: fc.integer({ min: 0, max: 50 }),
  robustness: fc.double({ noNaN: true, noDefaultInfinity: true }),
  shrunk: fc.boolean(),
  foundAfter: fc.nat(),
});
const arbClosest = fc.option(fc.record({ scenario: fc.dictionary(fc.constantFrom('a'), fc.double({ noNaN: true, noDefaultInfinity: true })), seed: fc.nat() }), { nil: undefined });
const arbSeed = fc.option(fc.integer({ min: 0, max: 60 }), { nil: undefined });

describe('Property 8: replay target selection', () => {
  // Feature: golem-kit, Property 8: Replay target selection
  it('CLI mode picks the last pinned entry, or the closest scenario with --seed', () => {
    fc.assert(fc.property(fc.array(arbCe, { maxLength: 6 }), arbClosest, arbSeed, (pinned, closest, seed) => {
      const r = selectReplay(pinned, closest, { cli: true, ...(seed !== undefined ? { seed } : {}) });
      const last = pinned[pinned.length - 1];
      if (r.ok) {
        if (last !== undefined) {
          expect(r.source).toBe('pinned');
          expect(r.scenario).toEqual(last.scenario);
          expect(r.seed).toBe(seed ?? last.seed);
        } else {
          expect(seed).toBeDefined();
          expect(closest).toBeDefined();
          expect(r.source).toBe('closest');
          expect(r.scenario).toEqual((closest as NonNullable<typeof closest>).scenario);
          expect(r.seed).toBe(seed);
        }
      } else {
        expect(last).toBeUndefined();
        expect(seed === undefined || closest === undefined).toBe(true);
        expect(r.reason).toBe('none-pinned');
      }
    }), propConfig);
  });

  it('MCP mode picks exactly the entry whose seed matches and lists pinned seeds on a miss', () => {
    fc.assert(fc.property(fc.array(arbCe, { maxLength: 6 }), arbSeed, (pinned, seed) => {
      const r = selectReplay(pinned, undefined, { cli: false, ...(seed !== undefined ? { seed } : {}) });
      if (pinned.length === 0) { expect(r).toEqual({ ok: false, reason: 'none-pinned', pinnedSeeds: [] }); return; }
      if (seed === undefined) {
        const last = pinned[pinned.length - 1] as Counterexample;
        expect(r).toEqual({ ok: true, source: 'pinned', scenario: last.scenario, seed: last.seed });
        return;
      }
      const hits = pinned.filter((p) => p.seed === seed);
      if (hits.length > 0) {
        const hit = hits[hits.length - 1] as Counterexample;
        expect(r).toEqual({ ok: true, source: 'pinned', scenario: hit.scenario, seed });
      } else {
        expect(r).toEqual({ ok: false, reason: 'seed-not-pinned', pinnedSeeds: pinned.map((p) => p.seed) });
      }
    }), propConfig);
  });
});
