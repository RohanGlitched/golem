// Feature: candy-app, Property 35: Trials are deterministic
import fc from 'fast-check';
import { ModelCache, compileRequirement, runTrial } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import candy from '../app';
import { lexicon } from '../lexicon';

const HAND = 'R1. WHEN a hand reaches in from any direction at up to 1.5 m/s THE arm SHALL keep every link at least 0.10 m from the hand for 2 s';
const LAG = 'R2. WHEN the hand tracker lags by up to 0.3 s and a hand reaches in from any direction at up to 1.5 m/s THE arm SHALL keep every link at least 0.10 m from the hand for 2 s';
const WEIGH = 'R3. WHEN the candies weigh 0.005 kg to 0.060 kg THE arm SHALL not drop a candy outside the bowls for 2 s';
const LAND = 'R4. WHEN candies land anywhere on the tray THE arm SHALL drop every candy into the bowl of its colour within 2 s';
const reqs = [HAND, LAG, WEIGH, LAND].map((l) => compileRequirement(l, lexicon).requirement!);
const cache = new ModelCache();
afterAll(() => { cache.dispose(); });

const scenarioOf = (req: (typeof reqs)[number]) =>
  fc.tuple(...req.space.dims.map((d) => fc.double({ min: d.min, max: d.max, noNaN: true, maxExcluded: d.wrap === true && d.max > d.min })))
    .map((vals) => Object.fromEntries(req.space.dims.map((d, i) => [d.name, vals[i]!])));

async function trial(req: (typeof reqs)[number], scenario: Record<string, number>, seed: number) {
  const signals: Record<string, number[]> = {};
  const res = await runTrial(candy, req, { app: 'candy', reqId: req.id, scenario, seed }, {
    cache,
    earlyStop: (trace, n) => {
      if (n === Math.round(req.horizon / candy.controlDt) + 1) {
        for (const [k, v] of Object.entries(trace.signals)) signals[k] = Array.from(v.subarray(0, n));
        signals['t'] = Array.from(trace.t.subarray(0, n));
      }
      return undefined;
    },
  });
  return { res, signals };
}

describe('trial determinism', () => {
  it('returns bit-identical trace, hash, robustness and worstAt for the same TrialSpec in the same runtime', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: reqs.length - 1 }).chain((i) => scenarioOf(reqs[i]!).map((s) => [i, s] as const)), fc.integer({ min: 0, max: 4294967295 }), async ([i, scenario], seed) => {
      const req = reqs[i]!;
      const a = await trial(req, scenario, seed);
      const b = await trial(req, scenario, seed);
      expect(a.res.hash).toBe(b.res.hash);
      expect(a.res.hash).toMatch(/^[0-9a-f]{16}$/);
      expect(Object.is(a.res.robustness, b.res.robustness)).toBe(true);
      expect(Object.is(a.res.worstAt, b.res.worstAt)).toBe(true);
      expect(Object.keys(a.signals).sort()).toEqual(Object.keys(b.signals).sort());
      for (const k of Object.keys(a.signals)) {
        expect(a.signals[k]!.map((v, j) => Object.is(v, b.signals[k]![j]))).not.toContain(false);
      }
      expect(a.signals['t']!.length).toBe(Math.round(req.horizon / candy.controlDt) + 1);
    }), { numRuns: 8 });
  });

  it('gives different hashes for different seeds (the candies start somewhere else)', async () => {
    const req = reqs[0]!;
    const scenario = { 'hand.angle': 1.0, 'hand.speed': 0.5, 'hand.entry': 0.1, 'hand.height': 0.1 };
    const a = await trial(req, scenario, 1), b = await trial(req, scenario, 2);
    expect(a.res.hash).not.toBe(b.res.hash);
  });
});
