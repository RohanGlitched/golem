// Feature: golem-falsify, Property 32: Pool results in input order, for every pool kind
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrialPool, TrialResult, TrialSpec } from '../falsify/contract.js';
import { createBrowserPool } from './browser.js';
import { installFakeWorker, restoreBrowserGlobals } from './browser.testkit.js';
import { InProcessPool } from './in-process.js';
import { TrialScheduler } from './scheduler.js';
import { fakeWorkerFactory, FakeTimers, tick } from './testing.js';
import type { TrialFn } from './types.js';

afterEach(restoreBrowserGlobals);

/** An injected trial function drawn by fast-check: an affine map of the scenario and seed. */
const arbTrialFn = fc.record({ a: fc.double({ min: -5, max: 5, noNaN: true }), b: fc.double({ min: -5, max: 5, noNaN: true }), unit: fc.constantFrom('m', 'N', 'rad') })
  .map(({ a, b, unit }): TrialFn => (s) => ({
    spec: s, robustness: a * (s.scenario['x'] as number) + b + (s.seed % 101) / 1000, worstAt: (s.seed % 17) * 0.1, unit, wallMs: 0,
    ...(s.record === 'poses' ? { poses: { fps: 50, nbody: 1, frames: new Float32Array(7).fill((s.seed % 89) / 89) } } : {}),
  }));

const arbRuns = fc.array(
  fc.array(fc.record({ x: fc.double({ min: -10, max: 10, noNaN: true }), seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }), poses: fc.boolean() }), { maxLength: 10 }),
  { minLength: 1, maxLength: 3 },
);

const toSpecs = (runs: { x: number; seed: number; poses: boolean }[][]): TrialSpec[][] =>
  runs.map((r, ri) => r.map((t) => ({ app: 'a', reqId: `R${ri}`, scenario: { x: t.x }, seed: t.seed, ...(t.poses ? { record: 'poses' as const } : {}) })));

const view = (r: TrialResult) => ({ robustness: r.robustness, worstAt: r.worstAt, unit: r.unit, frames: r.poses ? Array.from(r.poses.frames) : null });

async function runAll(pool: TrialPool, runs: TrialSpec[][], drive: () => Promise<void>) {
  const calls = runs.map(() => [] as TrialSpec[]);
  const ps = runs.map((specs, i) => pool.run(specs, (r) => { calls[i]!.push(r.spec); }));
  await drive();
  const results = await Promise.all(ps);
  return { results, calls };
}

describe('Property 32: pool results in input order, for every pool kind', () => {
  it('InProcess, scheduler (Node path) and browser pools agree with each other and with the input order', async () => {
    await fc.assert(
      fc.asyncProperty(arbTrialFn, arbRuns, fc.integer({ min: 1, max: 8 }), fc.integer({ min: 0, max: 2 ** 31 - 1 }), async (trialFn, rawRuns, size, shuffleSeed) => {
        const runs = toSpecs(rawRuns);
        const ref = await runAll(new InProcessPool(trialFn), runs, async () => undefined);

        const kinds: { name: string; make: (timers: FakeTimers) => TrialPool }[] = [
          { name: 'node-scheduler', make: (timers) => new TrialScheduler({ size, factory: fakeWorkerFactory({ trialFn, timers, script: { shuffleSeed, maxDelay: 50 } }).factory, appId: 'a', config: {}, timers }) },
          { name: 'browser', make: (timers) => { installFakeWorker(fakeWorkerFactory({ trialFn, timers, script: { shuffleSeed: shuffleSeed ^ 0x5bd1e995, maxDelay: 50 } })); return createBrowserPool({ appId: 'a', size, timers }); } },
        ];
        for (const kind of kinds) {
          const timers = new FakeTimers();
          const pool = kind.make(timers);
          expect(pool.size).toBe(size);
          const got = await runAll(pool, runs, async () => { await timers.settle(); await tick(); });
          runs.forEach((specs, i) => {
            const res = got.results[i]!;
            expect(res).toHaveLength(specs.length);
            res.forEach((r, j) => expect(r.spec).toBe(specs[j]));
            expect(res.map(view)).toEqual(ref.results[i]!.map(view));
            // onResult: once per spec, only on the submitting call.
            expect([...got.calls[i]!].sort((a, b) => a.seed - b.seed)).toEqual([...specs].sort((a, b) => a.seed - b.seed));
            expect(got.calls[i]!.every((s) => specs.includes(s))).toBe(true);
          });
          await pool.close();
        }
        // InProcess delivers in input order, since it is sequential.
        runs.forEach((specs, i) => expect(ref.calls[i]).toEqual(specs));
      }),
      { numRuns: 100 },
    );
  });
});
