import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { RecordingPool } from '../run/recording-pool.js';
import { FakePool, fakeFalsify, synthPoses } from './fakes.js';
import { runRig } from './generators/run.js';
import { swarmRig } from './generators/swarm.js';
import type { FalsifyFn, TrialPool, TrialResult, TrialSpec } from '../types.js';

const R = { numRuns: 100 };

/** Robustness from the spec seed; every k-th result has no poses. */
function synth(noPoseEvery: number, frames = 8) {
  return (s: TrialSpec): TrialResult => ({
    spec: s, robustness: Math.sin(s.seed * 12.9898) * 10, worstAt: 0.5, unit: 'rad', wallMs: 1,
    ...(s.record === 'poses' && (noPoseEvery === 0 || s.seed % noPoseEvery !== 0) ? { poses: synthPoses(3, frames) } : {}),
  });
}

/** Falsifier that runs the given generation sizes and calls `probe` after each. */
const gens = (sizes: number[], probe?: () => void): FalsifyFn => async (req, pool) => {
  let seed = 1, trials = 0;
  for (const n of sizes) {
    const specs: TrialSpec[] = Array.from({ length: n }, () => ({ app: 'test', reqId: req.id, scenario: { 'push.force': (seed * 37) % 200, 'push.angle': seed % 6 }, seed: seed++ }));
    await pool.run(specs);
    trials += n;
    probe?.();
  }
  return { reqId: req.id, status: 'held', trials, randomTrials: trials, guidedTrials: 0, closest: { robustness: 1, scenario: {}, seed: 0 }, ms: 1 };
};

describe('run properties', () => {
  // Feature: golem-studio-ui, Property 18: Counts cover all trials
  it('counts every received result in the trial counter and the aura, at least the ghosts shown', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 150 }), { minLength: 1, maxLength: 4 }), fc.integer({ min: 0, max: 4 }), async (sizes, k) => {
      const { swarm } = swarmRig();
      const results: TrialResult[] = [];
      const fn = synth(k);
      const pool = new FakePool((s) => { const r = fn(s); results.push(r); return r; });
      let rcRef: ReturnType<typeof runRig>['rc'] | undefined;
      const checks: (() => void)[] = [];
      const r = runRig({
        pool, deps: { swarm: () => swarm },
        falsify: gens(sizes, () => { if (results.length > 0) checks.push(((min, cl) => () => expect(cl).toBe(min))(Math.min(...results.map((x) => x.robustness)), rcRef!.closestCall?.robustness)); }),
      });
      rcRef = r.rc;
      await r.rc.start('1.1');
      const total = sizes.reduce((a, b) => a + b, 0);
      expect(r.line('1.1').progress?.trials).toBe(total);
      expect(r.rc.auras.get('1.1')!.total).toBe(total);
      expect(r.store.getState().aura.total).toBe(total);
      expect(total).toBeGreaterThanOrEqual(swarm.shown);
      for (const c of checks) if (results.length > 0) c();
    }), R);
  });

  // Feature: golem-studio-ui, Property 19: Pose retention is bounded
  it('holds poses for at most the current generation plus two retained trials', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.integer({ min: 1, max: 64 }), { minLength: 1, maxLength: 6 }), fc.integer({ min: 2, max: 40 }), async (sizes, frames) => {
      const fn = synth(0, frames);
      const pool = new FakePool(fn);
      let i = 0;
      const ref: { rc?: ReturnType<typeof runRig>['rc'] } = {};
      const r = runRig({
        pool,
        falsify: gens(sizes, () => {
          const held = ref.rc!.heldPoseCount();
          expect(held).toBeLessThanOrEqual(sizes[i]! + 2);
          const horizon = (frames - 2) / 30;
          expect(held * 28 * 3 * frames).toBeLessThanOrEqual(28 * 3 * (Math.floor(horizon * 30 + 1e-9) + 2) * 66);
          i++;
        }),
      });
      ref.rc = r.rc;
      await r.rc.start('1.1');
      expect(i).toBe(sizes.length);
    }), R);
  });

  // Feature: golem-studio-ui, Property 20: RecordingPool preserves results and records poses
  it('forwards chunks of at most 64 with poses, returns results in order without poses and ingests each once', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 300 }), async (n) => {
      const inner = new FakePool(synth(3));
      let ingested = 0, begins = 0, commits = 0;
      const rp = new RecordingPool(inner, { beginGeneration: () => { begins++; }, ingest: () => { ingested++; }, commit: () => { commits++; } });
      const specs: TrialSpec[] = Array.from({ length: n }, (_, i) => ({ app: 'test', reqId: 'R1', scenario: { x: i }, seed: i }));
      const out = await rp.run(specs);
      expect(inner.calls.every((c) => c.length <= 64)).toBe(true);
      expect(inner.calls.flat().map((s) => s.seed)).toEqual(specs.map((s) => s.seed));
      expect(inner.calls.flat().every((s) => s.record === 'poses')).toBe(true);
      expect(out.map((r) => r.spec.seed)).toEqual(specs.map((s) => s.seed));
      expect(out.some((r) => 'poses' in r)).toBe(false);
      expect(ingested).toBe(n);
      expect(begins).toBe(Math.ceil(n / 64));
      expect(commits).toBe(begins);
      await rp.close();
      expect(inner.closed).toBe(false);
    }), R);
  });

  // Feature: golem-studio-ui, Property 21: Stale runs change nothing
  it('ignores every callback of a cancelled run, so the state equals the current run alone', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 4 }), fc.integer({ min: 1, max: 80 }), async (staleSizes, n) => {
      let maxInFlight = 0;
      const ref: { rc?: ReturnType<typeof runRig>['rc'] } = {};
      const later: (() => Promise<void>)[] = [];
      // The stale falsifier rejects on abort at once but keeps calling the pool and onProgress afterwards.
      const stale: FalsifyFn = (req, pool, _b, _s, o) => new Promise((_res, rej) => {
        o.signal?.addEventListener('abort', () => {
          later.push(async () => {
            let seed = 1000;
            for (const k of staleSizes) {
              await pool.run(Array.from({ length: k }, () => ({ app: 'test', reqId: req.id, scenario: { 'push.force': 199, 'push.angle': 1 }, seed: seed++ })));
              o.onProgress?.({ phase: 1, generation: 99, trials: 999 });
            }
          });
          rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
      const current = fakeFalsify(n, 7);
      let calls = 0;
      const fal: FalsifyFn = async (...a) => {
        calls++;
        maxInFlight = Math.max(maxInFlight, ref.rc!.inFlight);
        return calls === 1 ? stale(...a) : current(...a);
      };
      const pool: TrialPool = new FakePool(synth(0));
      const r = runRig({ falsify: fal, pool });
      ref.rc = r.rc;
      const first = r.rc.start('1.1');
      await Promise.resolve();
      const second = r.rc.start('1.1');
      await first;
      await second;
      for (const f of later) await f();
      const alone = runRig({ falsify: fakeFalsify(n, 7), pool: new FakePool(synth(0)) });
      await alone.rc.start('1.1');
      const a = r.line('1.1'), b = alone.line('1.1');
      expect(a.status).toBe(b.status);
      expect(a.progress).toEqual(b.progress);
      expect(a.verdict?.trials).toBe(b.verdict?.trials);
      expect(a.verdict?.counterexample).toEqual(b.verdict?.counterexample);
      expect(r.rc.auras.get('1.1')!.total).toBe(alone.rc.auras.get('1.1')!.total);
      expect([...r.rc.auras.get('1.1')!.broke]).toEqual([...alone.rc.auras.get('1.1')!.broke]);
      expect(r.store.getState().run).toBeUndefined();
      expect(maxInFlight).toBeLessThanOrEqual(1);
    }), { numRuns: 100 });
  });
});
