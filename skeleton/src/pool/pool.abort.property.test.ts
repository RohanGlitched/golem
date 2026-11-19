// Feature: golem-falsify, Property 35: Abort leaves pool reusable and database unchanged (pool part)
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TrialResult, TrialSpec } from '../falsify/contract.js';
import { AbortError } from '../falsify/errors.js';
import { InProcessPool } from './in-process.js';
import { essentials, pureTrial, rig, spec, track } from './scheduler.testkit.js';

const specsOf = (n: number, base: number): TrialSpec[] => Array.from({ length: n }, (_, i) => spec(base + i, { x: (i * 7) % 11 }));
const expected = (specs: TrialSpec[]) => specs.map((s) => essentials(pureTrial(s) as TrialResult));

describe('Property 35 (pool part): abort leaves the pool reusable', () => {
  it('scheduler with FakeWorker: AbortError, no onResult after abort, queued run resolves, later run equals a fresh pool', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: -1, max: 80 }), // -1 = aborted before the call
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        fc.boolean(),
        async (size, nA, nB, abortAt, shuffleSeed, stuck) => {
          const { pool, drain, timers } = rig({
            size, sched: { abortGraceMs: 100 },
            script: {
              shuffleSeed, maxDelay: 40,
              // A stuck trial never answers; the grace timer must replace its worker.
              ...(stuck ? { job: (j: { spec: TrialSpec; generation: number }) => (j.spec.seed === 1 && j.generation === 0 ? { kind: 'hang' as const } : undefined) } : {}),
            },
          });
          const ac = new AbortController();
          if (abortAt < 0) ac.abort();
          let aborted = abortAt < 0;
          let lateCalls = 0;
          const a = track(pool.run(specsOf(nA, 0), () => { if (aborted) lateCalls++; }, { signal: ac.signal }));
          const bSpecs = specsOf(nB, 100);
          const b = track(pool.run(bSpecs));
          if (abortAt >= 0) {
            await timers.advance(abortAt);
            const settledBefore = a.settled();
            ac.abort();
            aborted = true;
            await Promise.resolve();
            if (!settledBefore) expect(a.error()).toBeInstanceOf(AbortError);
          } else {
            await Promise.resolve();
            expect(a.error()).toBeInstanceOf(AbortError);
          }
          await drain();
          expect(lateCalls).toBe(0);
          expect(a.settled()).toBe(true);
          if (a.error() === undefined) expect(a.value()).toHaveLength(nA);
          expect((b.value() as TrialResult[]).map(essentials)).toEqual(expected(bSpecs));
          const later = specsOf(6, 200);
          const c = track(pool.run(later));
          await drain();
          expect((c.value() as TrialResult[]).map(essentials)).toEqual(expected(later));
          expect(pool.size).toBe(size);
          await pool.close();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('InProcessPool: AbortError, only finished trials reported, later run equals a fresh pool', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 12 }), fc.integer({ min: -1, max: 12 }), async (n, abortAfter) => {
        const ac = new AbortController();
        if (abortAfter < 0) ac.abort();
        let calls = 0;
        const pool = new InProcessPool((s) => { if (++calls === abortAfter) ac.abort(); return pureTrial(s); });
        const seen: number[] = [];
        let aborted = abortAfter < 0;
        const specs = specsOf(n, 0);
        const out = await pool.run(specs, (r) => { if (aborted) throw new Error('late'); seen.push(r.spec.seed); }, { signal: ac.signal })
          .then((v) => ({ v }), (e: unknown) => ({ e }));
        aborted = true;
        if ('e' in out) {
          expect(out.e).toBeInstanceOf(AbortError);
          expect(seen).toEqual(specs.slice(0, seen.length).map((s) => s.seed));
          if (abortAfter >= 1) expect(seen).toHaveLength(Math.min(n, abortAfter - 1));
        } else {
          expect(out.v).toHaveLength(n);
        }
        const later = specsOf(5, 300);
        expect((await pool.run(later)).map(essentials)).toEqual((await new InProcessPool(pureTrial).run(later)).map(essentials));
      }),
      { numRuns: 100 },
    );
  });
});
