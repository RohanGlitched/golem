// Feature: golem-falsify, Property 19: Falsifier determinism and independence from pool and completion order
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TrialPool, TrialSpec } from '../falsify/contract.js';
import { falsify } from '../falsify/falsifier.js';
import { arbRunCase, optionsOf, sameVerdict } from '../falsify/falsifier.testkit.js';
import { makeSynthetic, syntheticTrialFn } from '../falsify/testing.js';
import { InProcessPool } from './in-process.js';
import { TrialScheduler } from './scheduler.js';
import { fakeWorkerFactory, FakeTimers, tick } from './testing.js';

/** Logs the specs of every `run` call in submission order. */
function logged(pool: TrialPool): { pool: TrialPool; specs: TrialSpec[] } {
  const specs: TrialSpec[] = [];
  return {
    specs,
    pool: {
      size: pool.size,
      run: (s, onResult, opts) => { specs.push(...s); return pool.run(s, onResult, opts); },
      close: () => pool.close(),
    },
  };
}

/** Awaits `p` while firing fake timers, since fake workers only answer when their timers fire. */
async function drive<T>(p: Promise<T>, timers: FakeTimers): Promise<T> {
  let done = false;
  const out = p.finally(() => { done = true; });
  out.catch(() => undefined);
  for (let i = 0; i < 100000 && !done; i++) { await timers.settle(); await tick(); }
  return out;
}

describe('Property 19 (pools): falsifier determinism across pools and completion orders', () => {
  it('gives the same scenarios and verdict on InProcessPool and on FakeWorker schedulers of size 1..64', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRunCase,
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        fc.boolean(),
        fc.boolean(),
        async (c, size, shuffleSeed, withCallbacks, cancelFirst) => {
          const req = { id: 'R1', space: c.space };
          const trialFn = syntheticTrialFn(makeSynthetic(c.synth));

          const ref = logged(new InProcessPool(trialFn, { yieldEvery: 1000 }));
          const a = await falsify(req, ref.pool, optionsOf(c));

          const timers = new FakeTimers();
          const sched = new TrialScheduler({
            size, appId: 'app', config: {}, timers,
            factory: fakeWorkerFactory({ trialFn, timers, script: { shuffleSeed, maxDelay: 30 } }).factory,
          });
          if (cancelFirst) {
            // An earlier cancelled run on the same pool must leave no state behind.
            const ac = new AbortController();
            const junk: TrialSpec[] = Array.from({ length: 2 * size + 3 }, (_, i) => ({ app: 'app', reqId: 'R1', scenario: {}, seed: i }));
            const p = sched.run(junk, undefined, { signal: ac.signal });
            p.catch(() => undefined);
            await timers.advance(5);
            ac.abort();
            await drive(p.catch(() => undefined), timers);
          }
          const other = logged(sched);
          const extra = withCallbacks ? { onProgress: () => undefined, onResult: () => undefined } : {};
          const b = await drive(falsify(req, other.pool, optionsOf(c, extra)), timers);
          await sched.close();

          expect(other.specs).toEqual(ref.specs);
          const [va, vb] = sameVerdict(a.verdict, b.verdict);
          expect(vb).toEqual(va);
          expect(Object.is(a.verdict.closest.robustness, b.verdict.closest.robustness)).toBe(true);
        },
      ),
      { numRuns: 60 },
    );
  }, 120000);
});
