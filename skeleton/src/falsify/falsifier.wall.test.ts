import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ScenarioSpace, TrialPool, TrialResult, TrialSpec } from './contract.js';
import { falsify } from './falsifier.js';
import type { ProgressEvent } from './types.js';

// golem-falsify-hardening defect 4: generations sized to the time left and the pool size.
const space: ScenarioSpace = {
  dims: [
    { name: 'force', kind: 'force', min: 0, max: 250, severity: 'up' },
    { name: 'angle', kind: 'angle', min: 0, max: 360, severity: 'none', wrap: true },
  ],
};
const req = { id: 'R1', space };
const WAVE = 5;

/** A pool of `size` slots on a fake clock: a batch of n trials takes ceil(n / size) waves of 5 ms. */
function wavePool(size: number, fn: (s: TrialSpec) => number) {
  const clock = { t: 0 };
  const log: TrialSpec[] = [];
  const pool: TrialPool = {
    size,
    async run(specs, onResult) {
      clock.t += Math.ceil(specs.length / size) * WAVE;
      const out: TrialResult[] = specs.map((spec) => ({ spec, robustness: fn(spec), worstAt: 0, unit: 'u', wallMs: WAVE }));
      for (const r of out) { log.push(r.spec); await onResult?.(r); }
      return out;
    },
    async close() { /* nothing */ },
  };
  return { pool, clock, log };
}

const holds = (s: TrialSpec): number => 1 + (s.scenario['force'] as number) / 250;

describe('falsify: wall-time budget on small pools', () => {
  for (const size of [1, 4]) {
    for (const G of [32, 64]) {
      it(`ends a held run within one wave of maxWallMs (pool ${size}, generation ${G})`, async () => {
        const p = wavePool(size, holds);
        const events: ProgressEvent[] = [];
        const r = await falsify(req, p.pool, {
          appId: 'a', budget: { maxWallMs: 300 }, searchSeed: 1, clock: () => p.clock.t,
          phase1GenerationSize: G, cem: { generationSize: G }, onProgress: (e) => { events.push(e); },
        });
        expect(r.verdict.status).toBe('held');
        expect(r.meta.stopReason).toBe('time-budget');
        expect(r.verdict.ms).toBeLessThanOrEqual(300 + WAVE);
        expect(r.verdict.ms).toBeGreaterThanOrEqual(300 - WAVE * Math.ceil(G / size)); // and uses the time
        // a generation shortened for time is the last of its phase
        for (const phase of [1, 2] as const) {
          const gens = events.filter((e) => e.phase === phase);
          gens.slice(0, -1).forEach((e) => expect(e.scenarios).toHaveLength(G));
        }
      });
    }
  }

  it('starts a shrink trial only when one more wave fits in the shrink reserve', async () => {
    const p = wavePool(1, (s) => (200 - (s.scenario['force'] as number)) / 250);
    const r = await falsify(req, p.pool, { appId: 'a', budget: { maxWallMs: 300 }, searchSeed: 4, clock: () => p.clock.t });
    expect(r.verdict.status).toBe('broken');
    const verificationMs = r.meta.p3Detail.verification * WAVE;
    expect(r.verdict.ms - verificationMs).toBeLessThanOrEqual(300 * 1.15 + 1e-9);
  });

  it('gives the same trials whatever the clock says when there is no wall limit', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.double({ min: 0, max: 1e6, noNaN: true }), { minLength: 1, maxLength: 50 }), async (times) => {
        let i = 0;
        const a = wavePool(3, holds);
        const b = wavePool(3, holds);
        await falsify(req, a.pool, { appId: 'a', budget: { maxTrials: 150 }, searchSeed: 8 });
        await falsify(req, b.pool, { appId: 'a', budget: { maxTrials: 150 }, searchSeed: 8, clock: () => times[i++ % times.length] as number });
        expect(b.log).toEqual(a.log);
      }),
      { numRuns: 30 },
    );
  });
});
