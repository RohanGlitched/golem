// Feature: golem-falsify, Property 34: Run ordering across concurrent calls
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TrialSpec } from '../falsify/contract.js';
import { rig, spec, track } from './scheduler.testkit.js';

describe('Property 34: run ordering across concurrent calls', () => {
  it('dispatches in call order then input order, with crash retries at the front', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 4 }),
        async (size, lengths, shuffleSeed, crashOnce) => {
          let next = 0;
          const runs: TrialSpec[][] = lengths.map((n, r) => Array.from({ length: n }, () => spec(next++, { reqId: `R${r}` })));
          const crashSet = new Set(crashOnce);
          const attempts = new Map<number, number>();
          const { pool, drain, dispatched } = rig({
            size,
            script: {
              shuffleSeed, maxDelay: 40,
              job: (j) => {
                const a = (attempts.get(j.spec.seed) ?? 0) + 1;
                attempts.set(j.spec.seed, a);
                return crashSet.has(j.spec.seed) && a === 1 ? { kind: 'crash', delay: 3 } : undefined;
              },
            },
          });
          const ps = runs.map((specs) => track(pool.run(specs)));
          await drain();
          expect(ps.every((p) => p.settled() && p.error() === undefined)).toBe(true);

          const order = dispatched().map((d) => d.seed);
          // First dispatch of every spec follows call order, then input order.
          const firsts = order.filter((s, i) => order.indexOf(s) === i);
          expect(firsts).toEqual(runs.flat().map((s) => s.seed));
          // Every spec that crashed once was dispatched exactly twice (the retry); others once.
          for (const s of runs.flat()) {
            expect(order.filter((x) => x === s.seed)).toHaveLength(crashSet.has(s.seed) ? 2 : 1);
          }
          await pool.close();
        },
      ),
      { numRuns: 80 },
    );
  });

  it('puts a crash retry ahead of every undispatched job (size 1)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 0, max: 19 }),
        async (lengths, crashSeed) => {
          let next = 0;
          const runs = lengths.map((n) => Array.from({ length: n }, () => spec(next++)));
          let crashed = false;
          const { pool, drain, dispatched } = rig({
            size: 1,
            script: { job: (j) => (j.spec.seed === crashSeed && !crashed ? ((crashed = true), { kind: 'crash' }) : undefined) },
          });
          runs.forEach((specs) => { void pool.run(specs); });
          await drain();
          const expected = runs.flat().map((s) => s.seed).flatMap((s) => (s === crashSeed ? [s, s] : [s]));
          expect(dispatched().map((d) => d.seed)).toEqual(expected);
          await pool.close();
        },
      ),
      { numRuns: 80 },
    );
  });
});
