// Feature: golem-falsify, Property 38: Close semantics
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CancelledError, PoolClosedError } from '../falsify/errors.js';
import { InProcessPool } from './in-process.js';
import { pureTrial, rig, spec, track } from './scheduler.testkit.js';

describe('Property 38: close semantics', () => {
  it('close resolves from any state, repeats safely, cancels pending runs and silences onResult', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.array(fc.integer({ min: 0, max: 8 }), { maxLength: 4 }),
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        fc.constantFrom('normal', 'crashy', 'slowLoad', 'loadFail', 'asyncOnResult'),
        fc.integer({ min: 1, max: 4 }),
        async (size, lengths, closeAt, shuffleSeed, mode, closeCalls) => {
          let next = 0;
          const { pool, drain, timers, f } = rig({
            size,
            sched: { maxRestarts: 2 },
            script: {
              shuffleSeed, maxDelay: 50,
              ...(mode === 'slowLoad' ? { loadDelay: () => 60 } : {}),
              ...(mode === 'loadFail' ? { loadFail: (s: number) => (s === 0 ? 'load failed' : undefined) } : {}),
              ...(mode === 'crashy' ? { job: (j: { runIndex: number }) => (j.runIndex % 3 === 0 ? { kind: 'crash' as const, delay: 5 } : undefined) } : {}),
            },
          });
          let closedResolved = false;
          let callsAfterClose = 0;
          const onResult = (): void | Promise<void> => {
            if (closedResolved) callsAfterClose++;
            if (mode === 'asyncOnResult') return new Promise<void>((r) => { timers.setTimeout(r, 7); });
            return undefined;
          };
          const runs = lengths.map((n) => track(pool.run(Array.from({ length: n }, () => spec(next++)), onResult)));
          await timers.advance(closeAt);
          const settledBefore = runs.map((r) => r.settled());
          const closes = Array.from({ length: closeCalls }, () => pool.close());
          for (const c of closes) expect(c).toBe(closes[0]);
          await Promise.all(closes);
          closedResolved = true;
          await drain();
          expect(callsAfterClose).toBe(0);
          runs.forEach((r, i) => {
            expect(r.settled()).toBe(true);
            if (!settledBefore[i] && r.error() !== undefined && mode !== 'loadFail' && mode !== 'crashy') {
              expect(r.error()).toBeInstanceOf(CancelledError);
            }
          });
          expect(f.alive()).toBe(0);
          await expect(pool.run([spec(1000)])).rejects.toBeInstanceOf(PoolClosedError);
          await expect(pool.close()).resolves.toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a pending run rejects with CancelledError when close lands mid-run', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 2, max: 10 }), async (size, n) => {
        const { pool, timers } = rig({ size, script: { job: () => ({ kind: 'ok', delay: 10 }) } });
        const p = track(pool.run(Array.from({ length: n * size }, (_, i) => spec(i))));
        await timers.advance(5);
        await pool.close();
        await Promise.resolve();
        expect(p.error()).toBeInstanceOf(CancelledError);
      }),
      { numRuns: 30 },
    );
  });

  it('InProcessPool: close repeats safely and later runs reject as closed', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (k) => {
        const pool = new InProcessPool(pureTrial);
        for (let i = 0; i < k; i++) await expect(pool.close()).resolves.toBeUndefined();
        await expect(pool.run([spec(1)])).rejects.toBeInstanceOf(PoolClosedError);
      }),
      { numRuns: 10 },
    );
  });
});
