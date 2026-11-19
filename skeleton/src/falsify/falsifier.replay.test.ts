import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ScenarioSpace, TrialSpec } from './contract.js';
import { falsify } from './falsifier.js';
import { loggingPool, pinnedEntries, seedDbOf } from './falsifier.testkit.js';
import { arbSpace, directPool, syntheticTrialFn } from './testing.js';
import type { FalsifyOptions } from './types.js';

// golem-falsify-hardening defect 5: replayable timed runs, no trial lost to flooring, generation prefix.
const space: ScenarioSpace = {
  dims: [
    { name: 'force', kind: 'force', min: 0, max: 250, severity: 'up' },
    { name: 'angle', kind: 'angle', min: 0, max: 360, severity: 'none', wrap: true },
  ],
};
const req = { id: 'R1', space };

/** A pool whose trials advance a fake clock by `ms` each; logs every spec. */
function timedPool(fn: (s: TrialSpec) => number, ms: number) {
  const clock = { t: 0 };
  const log: TrialSpec[] = [];
  const pool = directPool((spec) => { clock.t += ms; log.push(spec); return { spec, robustness: fn(spec), worstAt: 0, unit: 'u', wallMs: ms }; });
  return { pool, log, clock };
}

async function replayMatches(fn: (s: TrialSpec) => number, opts: Omit<FalsifyOptions, 'clock'>, ms: number, seedEntries?: unknown[]) {
  const a = timedPool(fn, ms);
  const db = seedEntries ? seedDbOf(seedEntries).db : undefined;
  const timed = await falsify(req, a.pool, { ...opts, clock: () => a.clock.t, ...(db ? { seedDb: db } : {}) });
  const b = timedPool(fn, 0);
  const replay = await falsify(req, b.pool, { ...timed.meta.replayOptions, ...(db ? { seedDb: db } : {}) });
  expect(timed.meta.replayOptions.budget).toEqual({ maxTrials: timed.meta.phaseTrials.p0 + timed.meta.phaseTrials.p1 + timed.meta.phaseTrials.p2 });
  expect(b.log).toEqual(a.log);
  expect({ ...replay.verdict, ms: 0 }).toEqual({ ...timed.verdict, ms: 0 });
  expect(replay.meta.phaseTrials).toEqual(timed.meta.phaseTrials);
  return timed;
}

describe('falsify: replay options and quotas', () => {
  it('replays a held timed run trial for trial from meta.replayOptions', async () => {
    const holds = (s: TrialSpec) => 1 + (s.scenario['force'] as number) / 250;
    for (const W of [97, 250, 1000]) {
      const r = await replayMatches(holds, { appId: 'a', budget: { maxWallMs: W }, searchSeed: 9 }, 3);
      expect(r.verdict.status).toBe('held');
    }
  });

  it('replays a broken timed run whose shrink was cut by the wall reserve', async () => {
    const fn = (s: TrialSpec) => (200 - (s.scenario['force'] as number)) / 250;
    const r = await replayMatches(fn, { appId: 'a', budget: { maxWallMs: 200 }, searchSeed: 4, phase1GenerationSize: 8 }, 3);
    expect(r.verdict.status).toBe('broken');
    expect(r.meta.p3Detail.shrink).toBeGreaterThan(0);
  });

  it('replays a timed run that ran out of time in Phase 0, using maxPinned', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ fracs: [i / 40, 0.5], robustness: 1, seed: i }));
    const entries = pinnedEntries(space, rows);
    const r = await replayMatches(() => 1, { appId: 'app', budget: { maxWallMs: 60 }, searchSeed: 2 }, 3, entries);
    expect(r.meta.pinnedNotRun).toBeGreaterThan(0);
    expect(r.meta.replayOptions.maxPinned).toBe(r.meta.phaseTrials.p0);
  });

  it('caps Phase 0 with maxPinned', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ fracs: [0.1 * i, 0.5], robustness: 1, seed: i }));
    const { db } = seedDbOf(pinnedEntries(space, rows));
    const r = await falsify(req, directPool(syntheticTrialFn(() => 1)), { appId: 'app', budget: { maxTrials: 50 }, searchSeed: 1, seedDb: db, maxPinned: 2 });
    expect(r.meta.phaseTrials.p0).toBe(2);
    expect(r.meta.pinnedNotRun).toBe(3);
    await expect(falsify(req, directPool(syntheticTrialFn(() => 1)), { appId: 'a', budget: { maxTrials: 5 }, searchSeed: 1, maxPinned: -1 })).rejects.toThrow(/maxPinned.*-1/);
  });

  it('spends every search trial with the default fractions (no trial lost to flooring)', async () => {
    for (const T of [7, 9, 13, 101]) {
      const r = await falsify(req, directPool(syntheticTrialFn(() => 1)), { appId: 'a', budget: { maxTrials: T }, searchSeed: 1 });
      expect(r.meta.phaseTrials.p1 + r.meta.phaseTrials.p2).toBe(T);
    }
  });

  // Feature: golem-falsify, Property 5 (strengthened by golem-falsify-hardening 5.5): full-mode Phase 1 is a
  // prefix of random-only Phase 1 for every Phase 1 size, because a shortened generation is a prefix.
  it('runs a full-mode Phase 1 that is a prefix of random-only Phase 1 for any budget', async () => {
    await fc.assert(
      fc.asyncProperty(arbSpace, fc.integer({ min: 0, max: 2 ** 32 - 1 }), fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 150 }), async (sp, searchSeed, g1, T) => {
        const base = { appId: 'app', searchSeed, phase1GenerationSize: g1, budget: { maxTrials: T } };
        const full = loggingPool({ kind: 'const', value: 1 });
        const only = loggingPool({ kind: 'const', value: 1 });
        const rf = await falsify({ id: 'R1', space: sp }, full.pool, base);
        await falsify({ id: 'R1', space: sp }, only.pool, { ...base, mode: 'random-only' });
        const n1 = rf.meta.phaseTrials.p1;
        expect(full.log.slice(0, n1).map((t) => t.spec)).toEqual(only.log.slice(0, n1).map((t) => t.spec));
      }),
      { numRuns: 150 },
    );
  });
});
