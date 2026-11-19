import { describe, expect, it } from 'vitest';
import type { ScenarioSpace, TrialResult, TrialSpec } from './contract.js';
import { falsify } from './falsifier.js';
import { replayCounterexample } from './replay.js';
import { directPool } from './testing.js';
import type { ProgressEvent, ResultInfo } from './types.js';

// golem-falsify-hardening defect 10 and item D: what the studio UI needs from a run.
const space: ScenarioSpace = {
  dims: [
    { name: 'force', kind: 'force', min: 0, max: 250, severity: 'up' },
    { name: 'angle', kind: 'angle', min: 0, max: 360, severity: 'none', wrap: true },
    { name: 'dur', kind: 'duration', min: 0.2, max: 0.2, severity: 'none' },
  ],
};
const req = { id: 'R1', space };
const graded = (spec: TrialSpec): TrialResult => ({
  spec, robustness: 1 + Math.abs((spec.scenario['angle'] as number) - 90) / 360 + (250 - (spec.scenario['force'] as number)) / 250, worstAt: 0.5, unit: 'm', wallMs: 0,
});

describe('falsify: progress and result details for the UI', () => {
  it('reports seeds, elapsed time, time fraction and the Phase 2 distribution in progress events', async () => {
    let t = 0;
    const pool = directPool((s) => { t += 2; return graded(s); });
    const events: ProgressEvent[] = [];
    await falsify(req, pool, {
      appId: 'a', budget: { maxTrials: 100, maxWallMs: 10_000 }, searchSeed: 3, clock: () => t, onProgress: (e) => { events.push(e); },
    });
    const ran = pool.calls.flat();
    let k = 0;
    for (const e of events) {
      expect(e.seeds).toHaveLength(e.scenarios.length);
      for (const seed of e.seeds) expect(seed).toBe(ran[k++]!.seed);
      expect(e.elapsedMs).toBe(2 * e.trialsUsed);
      expect(e.timeFraction).toBeCloseTo(e.elapsedMs / 10_000, 12);
      if (e.phase === 2) {
        expect(e.cem!.map((c) => c.name)).toEqual(['force', 'angle', 'dur']);
        expect(e.cem![2]).toEqual({ name: 'dur', kind: 'fixed', mu: null, sigma: null });
        for (const c of e.cem!.slice(0, 2)) {
          if (c.kind === 'normal' || c.kind === 'wrapped') { expect(c.mu).not.toBeNull(); expect(c.sigma).toBeGreaterThan(0); }
        }
      } else {
        expect(e.cem).toBeUndefined();
      }
    }
    expect(events.some((e) => e.phase === 2 && e.cem!.some((c) => c.kind === 'normal'))).toBe(true);
    const untimed: ProgressEvent[] = [];
    await falsify(req, directPool(graded), { appId: 'a', budget: { maxTrials: 40 }, searchSeed: 3, onProgress: (e) => { untimed.push(e); } });
    for (const e of untimed) expect(e.timeFraction).toBeNull();
  });

  it('passes the phase, generation and index of every trial to onResult', async () => {
    const seen: { seed: number; info: ResultInfo }[] = [];
    const events: ProgressEvent[] = [];
    const fails = (spec: TrialSpec): TrialResult => ({ ...graded(spec), robustness: (200 - (spec.scenario['force'] as number)) / 250 });
    await falsify(req, directPool(fails), {
      appId: 'a', budget: { maxTrials: 200 }, searchSeed: 5,
      onResult: (r, info) => { seen.push({ seed: r.spec.seed, info }); },
      onProgress: (e) => { events.push(e); },
    });
    for (const e of events.filter((x) => x.phase === 1 || x.phase === 2)) {
      const mine = seen.filter((s) => s.info.phase === e.phase && s.info.generation === e.generation);
      expect(mine.map((s) => s.info.index)).toEqual(e.seeds.map((_, i) => i));
      expect(mine.map((s) => s.seed)).toEqual([...e.seeds]);
    }
    const p3 = seen.filter((s) => s.info.phase === 3);
    expect(p3.length).toBeGreaterThan(0);
    const verification = p3.filter((s) => s.info.generation === 1);
    expect(verification.map((s) => s.info.index)).toEqual(verification.map((_, i) => i));
    expect([3, 6]).toContain(verification.length);
  });

  it('keeps -0 as the lowest robustness after 0', async () => {
    const values = [0, -0];
    let i = 0;
    const pool = directPool((spec) => ({ spec, robustness: values[i++] ?? 1, worstAt: 0, unit: 'm', wallMs: 0 }));
    const events: ProgressEvent[] = [];
    await falsify(req, pool, { appId: 'a', budget: { maxTrials: 4 }, searchSeed: 1, onProgress: (e) => { events.push(e); } });
    expect(Object.is(events[events.length - 1]!.lowestRobustness, -0)).toBe(true);
  });
});

describe('replayCounterexample', () => {
  it('re-runs a found counterexample with pose recording and reports that it reproduced', async () => {
    const trial = (spec: TrialSpec): TrialResult => ({
      spec, robustness: (200 - (spec.scenario['force'] as number)) / 250 + spec.seed * 0, worstAt: 1, unit: 'm', wallMs: 0,
      ...(spec.record === 'poses' ? { poses: { fps: 30, nbody: 1, frames: new Float32Array(7) } } : {}),
    });
    const r = await falsify(req, directPool(trial), { appId: 'stagger', budget: { maxTrials: 100 }, searchSeed: 2 });
    const cx = r.verdict.counterexample!;
    const pool = directPool(trial);
    const out = await replayCounterexample(pool, cx, { appId: 'stagger' });
    expect(pool.calls).toEqual([[{ app: 'stagger', reqId: 'R1', scenario: cx.scenario, seed: cx.seed, record: 'poses' }]]);
    expect(out.reproduced).toBe(true);
    expect(out.robustness).toBe(cx.robustness);
    expect(out.poses?.frames).toHaveLength(7);
    const other = await replayCounterexample(directPool((s) => ({ ...trial(s), robustness: 5 })), cx, { record: 'none' });
    expect(other.reproduced).toBe(false);
    expect(other.spec.record).toBe('none');
  });
});
