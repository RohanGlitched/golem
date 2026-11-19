import { describe, expect, it } from 'vitest';
import type { ScenarioSpace, TrialSpec } from './contract.js';
import { falsify } from './falsifier.js';
import { memoryFileSystem } from './fs.js';
import { deriveSeed } from './prng.js';
import { createSeedDatabase } from './seed-db.js';
import { directPool, syntheticTrialFn } from './testing.js';
import type { PinnedSeedEntry, ProgressEvent } from './types.js';

const space: ScenarioSpace = {
  dims: [
    { name: 'force', kind: 'force', min: 0, max: 200, severity: 'up' },
    { name: 'angle', kind: 'angle', min: 0, max: 2 * Math.PI, severity: 'none', wrap: true },
    { name: 'dur', kind: 'duration', min: 0.2, max: 0.2, severity: 'none' },
  ],
};
const req = { id: 'R2', space };
const holds = syntheticTrialFn(() => 1);
const breaksAbove120 = syntheticTrialFn((s) => 120 - (s['force'] as number));
const base = { appId: 'stagger', searchSeed: 42 };

const pinned = (force: number, robustness: number, seed = 7): PinnedSeedEntry => ({
  reqId: 'R2', scenario: { force, angle: 1, dur: 0.2 }, seed, robustness, shrunk: true, foundAfter: 3,
});
const dbWith = (entries: unknown) => {
  const fs = memoryFileSystem({ '.golem/seeds/stagger/R2.json': JSON.stringify(entries) });
  return { fs, db: createSeedDatabase(fs) };
};

describe('falsify: Phases 0 and 1', () => {
  it('holds with the stated trial count and a rule-of-three bound', async () => {
    const r = await falsify(req, directPool(holds), { ...base, budget: { maxTrials: 50 } });
    expect(r.verdict.status).toBe('held');
    expect(r.verdict.trials).toBe(50);
    expect(r.verdict.randomTrials).toBe(20);
    expect(r.verdict.guidedTrials).toBe(30);
    expect(r.verdict.failureRateUpper95).toBeCloseTo(3 / 20, 12);
    expect(r.verdict.counterexample).toBeUndefined();
    expect(r.meta.phaseTrials).toEqual({ p0: 0, p1: 20, p2: 30, p3: 0 });
    expect(r.meta.mode).toBe('full');
    expect(r.meta.budgetExhausted).toBe(true);
    expect(r.pinEntry).toBeUndefined();
  });

  it('breaks, shrinks to near the boundary, classifies, and builds a pin entry', async () => {
    const r = await falsify(req, directPool(breaksAbove120), { ...base, budget: { maxTrials: 200 } });
    expect(r.verdict.status).toBe('broken');
    const c = r.verdict.counterexample!;
    expect(c.robustness).toBeLessThan(0);
    expect(c.shrunk).toBe(true);
    expect(c.scenario['force']).toBeGreaterThan(120);
    expect(c.scenario['force']).toBeLessThanOrEqual(122 + 1e-9);
    expect(c.foundAfter).toBeGreaterThanOrEqual(1);
    expect(r.meta.classification).toBe('robust');
    expect(r.pinEntry?.verificationSeeds).toHaveLength(3);
    expect(r.verdict.trials).toBe(r.meta.phaseTrials.p0 + r.meta.phaseTrials.p1 + r.meta.phaseTrials.p2 + r.meta.phaseTrials.p3);
    expect(r.meta.p3Detail.verification).toBe(6); // 3 at the original failure, 3 at the shrunk point
    expect(r.verdict.closest.robustness).toBeLessThanOrEqual(c.robustness);
  });

  it('a failing pinned seed skips Phases 1 and 2 and goes to Phase 3', async () => {
    const { db } = dbWith([pinned(190, -70), pinned(10, 5, 8)]);
    const pool = directPool(breaksAbove120);
    const r = await falsify(req, pool, { ...base, budget: { maxTrials: 100 }, seedDb: db });
    expect(r.verdict.status).toBe('broken');
    expect(r.meta.phaseTrials.p0).toBe(1); // lowest stored robustness first, stops at the failure
    expect(r.meta.phaseTrials.p1).toBe(0);
    expect(r.meta.phaseTrials.p2).toBe(0);
    expect(r.meta.pinnedNotRun).toBe(1);
    expect(r.verdict.randomTrials).toBe(0);
    expect(r.verdict.failureRateUpper95).toBeUndefined();
    expect(r.verdict.counterexample?.foundAfter).toBe(1);
  });

  it('lists a pinned seed that now passes as resolved and keeps searching', async () => {
    const { db } = dbWith([pinned(10, -5)]);
    const r = await falsify(req, directPool(holds), { ...base, budget: { maxTrials: 20 }, seedDb: db });
    expect(r.meta.resolvedPinned).toEqual([{ scenario: { force: 10, angle: 1, dur: 0.2 }, seed: 7, robustness: 1 }]);
    expect(r.meta.phaseTrials.p0).toBe(1);
    expect(r.verdict.trials).toBe(20);
    expect(r.verdict.status).toBe('held');
  });

  it('skips an unreadable seed file and out-of-range entries, and says why', async () => {
    const bad = createSeedDatabase(memoryFileSystem({ '.golem/seeds/stagger/R2.json': '{nope' }));
    const r1 = await falsify(req, directPool(holds), { ...base, budget: { maxTrials: 10 }, seedDb: bad });
    expect(r1.meta.skippedSeedFiles).toHaveLength(1);
    expect(r1.meta.skippedSeedFiles[0]!.path).toContain('R2.json');
    expect(r1.verdict.status).toBe('held');
    const { db } = dbWith([pinned(500, -1), { ...pinned(5, -1), scenario: { force: 5, angle: 1 } }]);
    const r2 = await falsify(req, directPool(holds), { ...base, budget: { maxTrials: 10 }, seedDb: db });
    expect(r2.meta.skippedPinned.map((s) => s.index)).toEqual([0, 1]);
    expect(r2.meta.skippedPinned[0]!.reason).toMatch(/outside/);
    expect(r2.meta.phaseTrials.p0).toBe(0);
  });

  it('never writes the seed database', async () => {
    const { db, fs } = dbWith([pinned(190, -70)]);
    await falsify(req, directPool(breaksAbove120), { ...base, budget: { maxTrials: 40 }, seedDb: db });
    expect(fs.count('writeFile', 'rename', 'mkdir', 'remove')).toBe(0);
  });

  it('returns status error when the pool rejects, keeping the counts', async () => {
    const pool = directPool(holds, { rejectRun: (call) => (call === 1 ? new Error('worker pool down') : undefined) });
    const r = await falsify(req, pool, { ...base, budget: { maxTrials: 200 }, phase1GenerationSize: 8 });
    expect(r.verdict.status).toBe('error');
    expect(r.verdict.trials).toBe(9);
    expect(r.verdict.randomTrials).toBe(9);
    expect(r.meta.errors[0]!.message).toBe('worker pool down');
    expect(r.meta.stopReason).toBe('error');
    expect(pool.calls).toHaveLength(2);
  });

  it('reports an error with closest = Infinity when no trial completed', async () => {
    const pool = directPool(holds, { rejectRun: () => new Error('down') });
    const r = await falsify(req, pool, { ...base, budget: { maxTrials: 20 } });
    expect(r.verdict.status).toBe('error');
    expect(r.verdict.closest.robustness).toBe(Infinity);
  });

  it('treats NaN robustness as an error', async () => {
    const r = await falsify(req, directPool(syntheticTrialFn(() => NaN)), { ...base, budget: { maxTrials: 20 } });
    expect(r.verdict.status).toBe('error');
    expect(r.meta.errors.some((e) => /NaN/.test(e.message))).toBe(true);
    expect(r.verdict.failureRateUpper95).toBeUndefined();
  });

  it('runs no later phase when Phase 0 uses the whole budget', async () => {
    const { db } = dbWith([pinned(10, 1, 1), pinned(20, 2, 2), pinned(30, 3, 3)]);
    const r = await falsify(req, directPool(holds), { ...base, budget: { maxTrials: 3 }, seedDb: db });
    expect(r.verdict.status).toBe('held');
    expect(r.verdict.trials).toBe(3);
    expect(r.verdict.randomTrials).toBe(0);
    expect(r.verdict.guidedTrials).toBe(0);
    expect(r.meta.budgetExhausted).toBe(true);
  });

  it('records the pinned seeds not run when Phase 0 exceeds the budget', async () => {
    const { db } = dbWith([pinned(10, 1, 1), pinned(20, 2, 2), pinned(30, 3, 3)]);
    const r = await falsify(req, directPool(holds), { ...base, budget: { maxTrials: 2 }, seedDb: db });
    expect(r.meta.pinnedNotRun).toBe(1);
    expect(r.verdict.trials).toBe(2);
  });

  it('runs Phase 1 as repeated trials of the single scenario for an all-fixed space', async () => {
    const fixed = { id: 'R9', space: { dims: [{ name: 'x', kind: 'force' as const, min: 3, max: 3, severity: 'none' as const }] } };
    const pool = directPool(holds);
    const r = await falsify(fixed, pool, { ...base, budget: { maxTrials: 50 } });
    expect(r.verdict.randomTrials).toBe(20);
    expect(r.verdict.guidedTrials).toBe(0);
    const seeds = new Set(pool.calls.flat().map((s) => s.seed));
    expect(seeds.size).toBe(20);
    for (const s of pool.calls.flat()) expect(s.scenario).toEqual({ x: 3 });
  });

  it('ignores an onResult callback that throws', async () => {
    let n = 0;
    const r = await falsify(req, directPool(holds), {
      ...base, budget: { maxTrials: 20 }, onResult: () => { n++; throw new Error('ui bug'); },
    });
    expect(r.verdict.status).toBe('held');
    expect(n).toBe(20);
  });

  it('rejects an invalid budget before running any trial', async () => {
    const pool = directPool(holds);
    await expect(falsify(req, pool, { ...base, budget: {} })).rejects.toThrow(/maxTrials.*maxWallMs/);
    await expect(falsify(req, pool, { ...base, budget: { maxTrials: 10 }, phase1Fraction: 0.8, phase2Fraction: 0.5 })).rejects.toThrow(/exceeds 1/);
    await expect(falsify(req, pool, { ...base, budget: { maxTrials: 10 }, shrink: { tolerance: 2 } })).rejects.toThrow(/shrink\.tolerance/);
    await expect(falsify(req, pool, { ...base, searchSeed: -1, budget: { maxTrials: 10 } })).rejects.toThrow(/searchSeed/);
    expect(pool.calls).toHaveLength(0);
  });

  it('emits one progress event per phase 0 and per generation, with frozen contents', async () => {
    const events: ProgressEvent[] = [];
    await falsify(req, directPool(holds), { ...base, budget: { maxTrials: 50 }, onProgress: (e) => { events.push(e); } });
    expect(events.map((e) => [e.phase, e.generation])).toEqual([[0, 0], [1, 0], [2, 0], [2, 1]]);
    expect(events[1]!.scenarios).toHaveLength(20);
    expect(events[3]!.scenarios).toHaveLength(14); // last generation shrunk to the grant
    expect(events[3]!.trialsRemaining).toBe(0);
    expect(Object.isFrozen(events[1])).toBe(true);
  });
});

describe('falsify: Phase 2, Phase 3, random-only and abort', () => {
  it('shrinks a failure found in the last generation of an exhausted budget using the shrink reserve', async () => {
    const T = 20;
    const failSeed = deriveSeed(42, 2, 11); // the last Phase 2 trial
    const trialFn = syntheticTrialFn((_s, seed) => (seed === failSeed ? -1 : 1));
    const pool = directPool((spec: TrialSpec) => trialFn(spec));
    const r = await falsify(req, pool, { ...base, budget: { maxTrials: T } });
    expect(r.verdict.status).toBe('broken');
    expect(r.verdict.counterexample!.foundAfter).toBe(20);
    expect(r.verdict.counterexample!.shrunk).toBe(true);
    expect(r.meta.p3Detail.shrink).toBeGreaterThan(0);
    expect(r.meta.p3Detail.shrink).toBeLessThanOrEqual(r.meta.shrinkReserve!);
    expect(r.meta.p3Detail.verification).toBe(6); // 3 at the original failure, 3 at the shrunk point
    expect(r.verdict.trials).toBeLessThanOrEqual(T + r.meta.shrinkReserve! + 6);
    expect(r.meta.phaseTrials.p1 + r.meta.phaseTrials.p2).toBe(T);
  });

  it('still pins a seed-sensitive counterexample, with its verification data', async () => {
    const failSeed = deriveSeed(42, 1, 3);
    const trialFn = syntheticTrialFn((_s, seed) => (seed === failSeed ? -1 : 1));
    const r = await falsify(req, directPool(trialFn), { ...base, budget: { maxTrials: 50 } });
    expect(r.verdict.status).toBe('broken');
    expect(r.meta.classification).toBe('seed-sensitive');
    expect(r.pinEntry).toMatchObject({ classification: 'seed-sensitive', seed: failSeed });
    expect(r.pinEntry!.verificationRobustness).toEqual([1, 1, 1]);
    expect(r.verdict.counterexample!.seed).toBe(failSeed);
  });

  it('random-only mode spends the whole budget in Phase 1 and records its mode', async () => {
    const r = await falsify(req, directPool(holds), { ...base, budget: { maxTrials: 50 }, mode: 'random-only' });
    expect(r.verdict.guidedTrials).toBe(0);
    expect(r.verdict.randomTrials).toBe(50);
    expect(r.meta.mode).toBe('random-only');
    expect(r.verdict.failureRateUpper95).toBeCloseTo(3 / 50, 12);
  });

  it('random-only mode still shrinks and classifies', async () => {
    const r = await falsify(req, directPool(breaksAbove120), { ...base, budget: { maxTrials: 100 }, mode: 'random-only' });
    expect(r.verdict.status).toBe('broken');
    expect(r.verdict.counterexample!.shrunk).toBe(true);
    expect(r.meta.classification).toBe('robust');
  });

  it('stops by wall time using the injected clock and records trials per phase', async () => {
    let t = 0;
    const pool = directPool((spec) => { t += 10; return holds(spec); });
    const r = await falsify(req, pool, { ...base, budget: { maxWallMs: 1000 }, clock: () => t });
    expect(r.verdict.status).toBe('held');
    expect(r.meta.stopReason).toBe('time-budget');
    expect(r.meta.phaseTrials.p1 + r.meta.phaseTrials.p2).toBe(r.verdict.trials);
    expect(r.verdict.trials * 10).toBeGreaterThanOrEqual(1000);
    expect(r.verdict.ms).toBe(r.verdict.trials * 10);
  });

  it('reports an invalid CEM generation size as an error when nothing failed', async () => {
    const r = await falsify(req, directPool(holds), { ...base, budget: { maxTrials: 50 }, cem: { generationSize: 1 } });
    expect(r.verdict.status).toBe('error');
    expect(r.verdict.guidedTrials).toBe(0);
    expect(r.meta.errors.some((e) => /generationSize/.test(e.message))).toBe(true);
  });

  it('does not report a CEM parameter error when a failure was already seen', async () => {
    const r = await falsify(req, directPool(breaksAbove120), { ...base, budget: { maxTrials: 50 }, cem: { generationSize: 1 } });
    expect(r.verdict.status).toBe('broken');
  });

  it('rejects with AbortError when aborted during Phase 3 and writes nothing', async () => {
    const ac = new AbortController();
    const { db, fs } = dbWith([]);
    let afterFailure = 0;
    const pool = directPool((spec) => {
      const r = breaksAbove120(spec);
      if (r.robustness < 0 && ++afterFailure === 4) ac.abort();
      return r;
    });
    const events: ProgressEvent[] = [];
    await expect(
      falsify(req, pool, { ...base, budget: { maxTrials: 100 }, signal: ac.signal, seedDb: db, onProgress: (e) => { events.push(e); } }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(events.some((e) => e.phase === 3)).toBe(false);
    expect(fs.count('writeFile', 'rename', 'mkdir')).toBe(0);
  });

  it('rejects at once for an already aborted signal without running a trial', async () => {
    const ac = new AbortController(); ac.abort();
    const pool = directPool(holds);
    await expect(falsify(req, pool, { ...base, budget: { maxTrials: 10 }, signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(pool.calls).toHaveLength(0);
  });
});
