// Feature: golem-falsify, Property 36: Crash retry once, then error
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TrialResult, TrialSpec } from '../falsify/contract.js';
import { TrialCrashError } from '../falsify/errors.js';
import { essentials, pureTrial, rig, spec, track } from './scheduler.testkit.js';

describe('Property 36: crash retry once, then error', () => {
  it('a trial crashing once succeeds with the crash-free result; one crashing twice rejects only its run', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.array(fc.array(fc.constantFrom(0, 0, 0, 1, 2), { minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        async (size, plan, shuffleSeed) => {
          // plan[r][i] = number of times spec i of run r crashes a worker (0, 1 or 2).
          let next = 0;
          const crashes = new Map<number, number>();
          const runs: TrialSpec[][] = plan.map((row, r) => row.map((c) => {
            const s = spec(next++, { reqId: `R${r}` });
            crashes.set(s.seed, c);
            return s;
          }));
          const attempts = new Map<number, number>();
          const sizes: number[] = [];
          const { pool, drain } = rig({
            size,
            sched: { maxRestarts: 1000 },
            script: {
              shuffleSeed, maxDelay: 25,
              job: (j) => {
                sizes.push(pool.size);
                const a = (attempts.get(j.spec.seed) ?? 0) + 1;
                attempts.set(j.spec.seed, a);
                return a <= (crashes.get(j.spec.seed) ?? 0) ? { kind: 'crash', delay: 2, reason: `crash ${j.spec.seed}` } : undefined;
              },
            },
          });
          const ps = runs.map((specs) => track(pool.run(specs)));
          await drain();
          runs.forEach((specs, r) => {
            const p = ps[r]!;
            expect(p.settled()).toBe(true);
            const doomed = specs.find((s) => crashes.get(s.seed) === 2);
            if (doomed === undefined) {
              const res = p.value() as TrialResult[];
              expect(res.map(essentials)).toEqual(specs.map((s) => essentials(pureTrial(s) as TrialResult)));
              res.forEach((x, i) => expect(x.spec).toBe(specs[i]));
              for (const s of specs) expect(attempts.get(s.seed)).toBe((crashes.get(s.seed) ?? 0) + 1);
            } else {
              const err = p.error() as TrialCrashError;
              expect(err).toBeInstanceOf(TrialCrashError);
              expect(err.message).toContain('crashed two workers');
              expect(err.message).toContain('(app a)');
              // The named spec is one of this run's specs that crashes twice.
              const named = specs.filter((s) => crashes.get(s.seed) === 2 && err.message.includes(`seed ${s.seed} `));
              expect(named.length).toBeGreaterThan(0);
              expect(err.message).toContain(`R${r}`);
            }
          });
          for (const v of attempts.values()) expect(v).toBeLessThanOrEqual(2);
          expect(sizes.every((s) => s === size)).toBe(true);
          expect(pool.size).toBe(size);
          await pool.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});
