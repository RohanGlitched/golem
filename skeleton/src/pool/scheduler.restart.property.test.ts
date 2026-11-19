// Feature: golem-falsify, Property 37: Restart limit and reset
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RestartLimitError, TrialCrashError } from '../falsify/errors.js';
import { rig, spec, track } from './scheduler.testkit.js';

type Outcome = { kind: 'ok' } | { kind: 'crash'; reason: string } | { kind: 'loadFail'; reason: string };

/**
 * Reference model for one slot. Each spec is its own run. `events[k]` decides the k-th event: a dispatch
 * (crash or ok) when the worker is loaded, or the load result of a crash replacement (loadFail or ready).
 */
function model(nRuns: number, events: Outcome[], maxRestarts: number) {
  let k = 0;
  const nextEvent = (): Outcome => events[k++] ?? { kind: 'ok' };
  let restarts = 0;
  let lastReason = '';
  const status: ('ok' | 'crash2' | 'limit')[] = [];
  const queue: { run: number; attempts: number }[] = Array.from({ length: nRuns }, (_, run) => ({ run, attempts: 0 }));
  let failed = false;
  while (queue.length > 0 && !failed) {
    const job = queue.shift()!;
    const e = nextEvent();
    if (e.kind !== 'crash') { restarts = 0; status[job.run] = 'ok'; continue; }
    lastReason = e.reason;
    job.attempts++;
    if (job.attempts >= 2) status[job.run] = 'crash2'; else queue.unshift(job);
    restarts++;
    if (restarts > maxRestarts) { failed = true; break; }
    // The replacement loads; a load failure is one more restart and another replacement.
    for (;;) {
      const l = nextEvent();
      if (l.kind !== 'loadFail') { if (l.kind === 'crash') k--; break; }
      lastReason = l.reason;
      restarts++;
      if (restarts > maxRestarts) { failed = true; break; }
    }
  }
  if (failed) for (let r = 0; r < nRuns; r++) if (status[r] === undefined) status[r] = 'limit';
  return { failed, lastReason, status };
}

describe('Property 37: restart limit and reset', () => {
  it('fails exactly when one slot has more than maxRestarts consecutive restarts, naming slot and last message', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 1, max: 8 }),
        fc.array(fc.constantFrom<'ok' | 'crash' | 'loadFail'>('ok', 'crash', 'crash', 'loadFail'), { maxLength: 30 }),
        async (maxRestarts, nRuns, kinds) => {
          const events: Outcome[] = kinds.map((kd, i) => (kd === 'ok' ? { kind: 'ok' } : { kind: kd, reason: `${kd} #${i}` }));
          const expected = model(nRuns + 1, events, maxRestarts); // the last run is submitted after the others settle

          // Drive the fake worker from the same event list: dispatches and replacement loads consume events in order.
          let k = 0;
          const take = (): Outcome => events[k++] ?? { kind: 'ok' };
          const { pool, drain } = rig({
            size: 1, sched: { maxRestarts },
            script: {
              loadFail: (_slot, generation) => {
                if (generation === 0) return undefined;
                const e = take();
                if (e.kind === 'loadFail') return e.reason;
                if (e.kind === 'crash') k--; // not a load event; leave it for the next dispatch
                return undefined;
              },
              job: () => {
                const e = take();
                return e.kind === 'crash' ? { kind: 'crash', reason: e.reason } : undefined;
              },
            },
          });
          const runs = Array.from({ length: nRuns }, (_, i) => track(pool.run([spec(i)])));
          await drain();
          runs.forEach((r, i) => {
            expect(r.settled()).toBe(true);
            const st = expected.status[i];
            if (st === 'ok') expect(r.error()).toBeUndefined();
            else if (st === 'crash2') expect(r.error()).toBeInstanceOf(TrialCrashError);
            else expect(r.error()).toBeInstanceOf(RestartLimitError);
          });
          const later = track(pool.run([spec(99)]));
          await drain();
          const st = expected.status[nRuns];
          if (st === 'ok') expect(later.error()).toBeUndefined();
          else if (st === 'crash2') expect(later.error()).toBeInstanceOf(TrialCrashError);
          else {
            const err = later.error();
            expect(err).toBeInstanceOf(RestartLimitError);
            expect((err as Error).message).toContain('slot 0');
            expect((err as Error).message).toContain(expected.lastReason);
          }
          if (expected.failed) await expect(pool.run([spec(100)])).rejects.toBeInstanceOf(RestartLimitError);
          await expect(pool.close()).resolves.toBeUndefined();
        },
      ),
      { numRuns: 150 },
    );
  });

  it('a completed trial resets the count, so alternating crash and success never fails', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 12 }), async (size, maxRestarts, n) => {
        const counts = new Map<string, number>();
        const { pool, drain } = rig({
          size, sched: { maxRestarts },
          script: {
            job: (j) => {
              const key = `${j.slot}`;
              const c = (counts.get(key) ?? 0) + 1;
              counts.set(key, c);
              // Per slot: maxRestarts crashes, then a success, repeated.
              return c % (maxRestarts + 1) !== 0 ? { kind: 'crash' } : undefined;
            },
          },
        });
        const ps = Array.from({ length: n }, (_, i) => track(pool.run([spec(i)])));
        await drain();
        for (const p of ps) expect(p.error()).not.toBeInstanceOf(RestartLimitError);
        await pool.close();
      }),
      { numRuns: 60 },
    );
  });
});
