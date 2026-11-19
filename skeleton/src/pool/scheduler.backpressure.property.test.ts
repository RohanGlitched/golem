// Feature: golem-falsify, Property 33: Backpressure
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TrialResult } from '../falsify/contract.js';
import { instrument, rig, spec, track, type Probe } from './scheduler.testkit.js';

const flushMicrotasks = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('Property 33: backpressure', () => {
  it('never exceeds size in flight nor one job per worker', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.array(fc.integer({ min: 0, max: 12 }), { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        async (size, lengths, shuffleSeed) => {
          let probe: Probe | undefined;
          let next = 0;
          const { pool, drain } = rig({
            size, script: { shuffleSeed, maxDelay: 30 },
            wrap: (fac) => (probe = instrument(fac)).factory,
          });
          const ps = lengths.map((n) => track(pool.run(Array.from({ length: n }, () => spec(next++)))));
          await drain();
          expect(ps.every((p) => p.value() !== undefined)).toBe(true);
          expect(probe?.maxInflight()).toBeLessThanOrEqual(size);
          expect(probe?.maxPerWorker()).toBeLessThanOrEqual(1);
          expect(probe?.dispatches()).toBe(next);
          await pool.close();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('holds pose results waiting for delivery at or below the bound and resumes dispatch in the same turn', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.option(fc.integer({ min: 1, max: 8 }), { nil: undefined }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        fc.array(fc.nat(), { maxLength: 40 }),
        async (size, deliveryBound, n, shuffleSeed, releasePicks) => {
          const bound = deliveryBound ?? 2 * size;
          let probe: Probe | undefined;
          const { pool, drain } = rig({
            size, script: { shuffleSeed, maxDelay: 20 },
            ...(deliveryBound !== undefined ? { sched: { deliveryBound } } : {}),
            wrap: (fac) => (probe = instrument(fac)).factory,
          });
          const pending: (() => void)[] = [];
          let maxWaiting = 0;
          const specs = Array.from({ length: n }, (_, i) => spec(i, { record: 'poses' }));
          const p = track(pool.run(specs, () => new Promise<void>((res) => {
            pending.push(res);
            maxWaiting = Math.max(maxWaiting, pending.length);
          })));
          let picks = 0;
          for (let round = 0; round < 10 * n + 10 && !p.settled(); round++) {
            await drain();
            if (pending.length === 0) continue;
            const pr = probe as Probe;
            const undispatched = n - pr.dispatches();
            const idle = pr.inflight() < size;
            const k = (releasePicks[picks++ % Math.max(1, releasePicks.length)] ?? 0) % pending.length;
            const [release] = pending.splice(k, 1);
            const before = pr.dispatches();
            const freedBelow = pending.length + pr.inflight() < bound;
            release?.();
            await flushMicrotasks(); // no macrotask: same scheduling turn
            if (undispatched > 0 && idle && freedBelow) expect(pr.dispatches()).toBeGreaterThan(before);
          }
          expect(p.settled()).toBe(true);
          expect((p.value() as TrialResult[]).map((r) => r.spec.seed)).toEqual(specs.map((s) => s.seed));
          expect(maxWaiting).toBeLessThanOrEqual(bound);
          expect(probe?.maxInflight()).toBeLessThanOrEqual(size);
          await pool.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});
