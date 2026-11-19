import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { falsify } from './falsifier.js';
import { arbPinnedRows, arbRunCase, loggingPool, optionsOf, pinnedEntries, seedDbOf } from './falsifier.testkit.js';
import type { ProgressEvent } from './types.js';

import { arbSpace } from './testing.js';

describe('falsifier random-only prefix', () => {
  // Feature: golem-falsify, Property 5: Random-only Phase 1 prefix equals full-mode Phase 1
  it('full and random-only mode run identical Phase 1 scenarios and seeds', async () => {
    await fc.assert(
      fc.asyncProperty(arbSpace, fc.integer({ min: 0, max: 2 ** 32 - 1 }), fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 80 }), async (space, searchSeed, g1, n) => {
        const base = { appId: 'app', searchSeed, phase1GenerationSize: g1 };
        const full = loggingPool({ kind: 'const', value: 1 });
        const only = loggingPool({ kind: 'const', value: 1 });
        // full: quota1 = floor(0.5 * 2n) = n. random-only: all n trials are Phase 1.
        await falsify({ id: 'R1', space }, full.pool, { ...base, budget: { maxTrials: 2 * n }, phase1Fraction: 0.5, phase2Fraction: 0.5 });
        await falsify({ id: 'R1', space }, only.pool, { ...base, budget: { maxTrials: n }, mode: 'random-only' });
        expect(full.log.slice(0, n).map((t) => t.spec)).toEqual(only.log.slice(0, n).map((t) => t.spec));
        expect(only.log.length).toBe(n);
      }),
      { numRuns: 150 },
    );
  });
});