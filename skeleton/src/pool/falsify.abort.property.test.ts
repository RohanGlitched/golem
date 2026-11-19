// Feature: golem-falsify, Property 35: Abort leaves pool reusable and database unchanged (falsifier part)
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TrialPool } from '../falsify/contract.js';
import { falsify } from '../falsify/falsifier.js';
import { arbPinnedRows, arbRunCase, optionsOf, pinnedEntries, seedDbOf } from '../falsify/falsifier.testkit.js';
import { makeSynthetic, syntheticTrialFn } from '../falsify/testing.js';
import { InProcessPool } from './in-process.js';
import { TrialScheduler } from './scheduler.js';
import { fakeWorkerFactory } from './testing.js';

const snapshot = (files: Map<string, string>) => new Map(files);

describe('Property 35 (falsifier part): abort rejects, stops progress and leaves seed files untouched', () => {
  it('aborts before the first dispatch, mid-generation or during Phase 3', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRunCase,
        arbPinnedRows,
        fc.constantFrom('before', 'anywhere', 'phase3'),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.boolean(),
        async (c, rows, where, frac, useScheduler) => {
          const req = { id: 'R1', space: c.space };
          const fn = syntheticTrialFn(makeSynthetic(c.synth));
          const entries = pinnedEntries(c.space, rows);

          // A reference run without abort tells how many trials each phase used.
          const ref = await falsify(req, new InProcessPool(fn, { yieldEvery: 1000 }), optionsOf(c, { seedDb: seedDbOf(entries).db }));
          const total = ref.meta.phaseTrials.p0 + ref.meta.phaseTrials.p1 + ref.meta.phaseTrials.p2 + ref.meta.phaseTrials.p3;
          const p3Start = total - ref.meta.phaseTrials.p3;
          let abortAfter: number; // abort while trial number `abortAfter` (0-based) runs; -1 = before the call
          if (where === 'before') abortAfter = -1;
          else if (where === 'phase3' && ref.meta.phaseTrials.p3 > 0) abortAfter = p3Start + Math.floor(frac * ref.meta.phaseTrials.p3);
          else abortAfter = Math.floor(frac * total);

          const ac = new AbortController();
          if (abortAfter < 0) ac.abort();
          let trials = 0;
          const trialFn = (s: Parameters<typeof fn>[0]) => {
            if (trials++ === abortAfter) ac.abort();
            return fn(s);
          };
          const pool: TrialPool = useScheduler
            ? new TrialScheduler({ size: 3, appId: 'app', config: {}, factory: fakeWorkerFactory({ trialFn }).factory })
            : new InProcessPool(trialFn, { yieldEvery: 1000 });
          const { db, fs } = seedDbOf(entries);
          const before = snapshot(fs.files);
          let aborted = abortAfter < 0;
          ac.signal.addEventListener('abort', () => { aborted = true; });
          let lateEvents = 0;
          const out = await falsify(req, pool, optionsOf(c, { seedDb: db, signal: ac.signal, onProgress: () => { if (aborted) lateEvents++; } }))
            .then((r) => ({ r }), (e: unknown) => ({ e }));
          await pool.close();

          if (abortAfter < total) {
            // The abort landed inside the run.
            expect('e' in out).toBe(true);
            expect((out as { e: Error }).e.name).toBe('AbortError');
          } else {
            expect('r' in out).toBe(true);
          }
          expect(lateEvents).toBe(0);
          expect(fs.files).toEqual(before);
          expect(fs.count('writeFile', 'rename', 'mkdir', 'remove')).toBe(0);
        },
      ),
      { numRuns: 120 },
    );
  }, 120000);
});
