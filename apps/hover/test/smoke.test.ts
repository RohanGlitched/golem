// Trials through the real Episode_Runner: a smoke trial, handle hygiene, determinism, and the monitor's sign.
import fc from 'fast-check';
import { ModelCache, compileRequirement, liveHandleCount, runTrial } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import hover from '../app';
import { lexicon } from '../lexicon';

const GUST = 'R1. WHEN a gust of up to 20 N hits it for 0.5 s from any direction THE drone SHALL stay within 1.0 m of its hover point for 1.5 s';
const SMALL = 'R2. WHEN a gust of up to 2 N hits it for 0.5 s from any direction THE drone SHALL stay within 0.25 m of its hover point for 1.5 s';
const SAG = 'R3. WHEN the battery sags to 60% to 100% THE drone SHALL stay above 0.5 m for 1.5 s';
const LAG = 'R4. WHEN a gust of up to 2 N hits it for 0.5 s from any direction while the position estimate lags by up to 0.3 s THE drone SHALL keep its tilt below 30 deg for 1.5 s';
const reqs = [GUST, SMALL, SAG, LAG].map((l) => compileRequirement(l, lexicon).requirement!);
const cache = new ModelCache();
afterAll(() => { cache.dispose(); });

const spec = (req: (typeof reqs)[number], scenario: Record<string, number>, seed: number) => ({ app: 'hover', reqId: req.id, scenario, seed });
const scenarioOf = (req: (typeof reqs)[number]) =>
  fc.tuple(...req.space.dims.map((d) => fc.double({ min: d.min, max: d.max, noNaN: true, maxExcluded: d.wrap === true && d.max > d.min })))
    .map((vals) => Object.fromEntries(req.space.dims.map((d, i) => [d.name, vals[i]!])));

describe('smoke trial', () => {
  it('compiles the four lines without a diagnostic and with a horizon of the gust plus the window', () => {
    for (const l of [GUST, SMALL, SAG, LAG]) expect(compileRequirement(l, lexicon).diagnostics, l).toEqual([]);
    expect(reqs[0]!.horizon).toBeCloseTo(2, 12);
    expect(reqs[2]!.horizon).toBeCloseTo(1.5, 12);
  });

  it('runs 2 s after the 2 s warm-up with a finite robustness, no numerical trouble, and no handle left over', async () => {
    const before = liveHandleCount();
    let samples = -1;
    const res = await runTrial(hover, reqs[0]!, spec(reqs[0]!, { 'gust.force': 20, 'gust.angle': 1 }, 7), { cache, earlyStop: (_t, n) => { samples = n; return undefined; } });
    expect(Number.isFinite(res.robustness)).toBe(true);
    expect(res.unit).toBe('m');
    expect(samples).toBe(Math.round(reqs[0]!.horizon / hover.controlDt) + 1);
    expect(res.diagnostics.numerical).toBe(false);
    expect(liveHandleCount()).toBe(before + 1);          // only the cached model
    cache.dispose();
    expect(liveHandleCount()).toBe(before);
  });

  it('breaks a 1 m ball with a 20 N gust and holds a 0.25 m ball with a 2 N gust: the sign of the robustness is the verdict', async () => {
    const strong = await runTrial(hover, reqs[0]!, spec(reqs[0]!, { 'gust.force': 20, 'gust.angle': 2 }, 3), { cache });
    const weak = await runTrial(hover, reqs[1]!, spec(reqs[1]!, { 'gust.force': 2, 'gust.angle': 2 }, 3), { cache });
    expect(strong.robustness).toBeLessThan(-0.5);
    expect(weak.robustness).toBeGreaterThan(0.05);
  });

  it('reports a worse margin for a stronger gust, from the same direction and seed', async () => {
    const margins: number[] = [];
    for (const force of [0, 5, 10, 20]) {
      margins.push((await runTrial(hover, reqs[0]!, spec(reqs[0]!, { 'gust.force': force, 'gust.angle': 0.7 }, 11), { cache })).robustness);
    }
    for (let i = 1; i < margins.length; i++) expect(margins[i]!).toBeLessThan(margins[i - 1]!);
  });

  it('restores the battery after the trial: a later trial without a sag sees the full thrust', async () => {
    const sag = await runTrial(hover, reqs[2]!, spec(reqs[2]!, { 'battery.ratio': 0.6 }, 5), { cache });
    const full = await runTrial(hover, reqs[2]!, spec(reqs[2]!, { 'battery.ratio': 1 }, 5), { cache });
    const again = await runTrial(hover, reqs[2]!, spec(reqs[2]!, { 'battery.ratio': 1 }, 5), { cache });
    expect(sag.robustness).toBeLessThan(full.robustness);
    expect(full.hash).toBe(again.hash);
  });
});

describe('trial determinism', () => {
  it('returns the same hash, robustness and worstAt for the same TrialSpec', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: reqs.length - 1 }).chain((i) => scenarioOf(reqs[i]!).map((s) => [i, s] as const)), fc.integer({ min: 0, max: 4294967295 }), async ([i, scenario], seed) => {
      const req = reqs[i]!;
      const a = await runTrial(hover, req, spec(req, scenario, seed), { cache });
      const b = await runTrial(hover, req, spec(req, scenario, seed), { cache });
      expect(a.hash).toBe(b.hash);
      expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
      expect(Object.is(a.robustness, b.robustness)).toBe(true);
      expect(Object.is(a.worstAt, b.worstAt)).toBe(true);
    }), { numRuns: 8 });
  });
  it('gives different hashes for different seeds (the drone starts somewhere else)', async () => {
    const s = { 'gust.force': 1.5, 'gust.angle': 1 };
    const a = await runTrial(hover, reqs[1]!, spec(reqs[1]!, s, 1), { cache });
    const b = await runTrial(hover, reqs[1]!, spec(reqs[1]!, s, 2), { cache });
    expect(a.hash).not.toBe(b.hash);
  });
  it('gives a bounded robustness for the whole scenario space of every line', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: reqs.length - 1 }).chain((i) => scenarioOf(reqs[i]!).map((s) => [i, s] as const)), async ([i, scenario]) => {
      const res = await runTrial(hover, reqs[i]!, spec(reqs[i]!, scenario, 1), { cache });
      expect(Number.isNaN(res.robustness)).toBe(false);
      expect(res.diagnostics.numerical).toBe(false);
    }), { numRuns: 8 });
  });
});
