import { describe, expect, it } from 'vitest';
import type { Scenario, ScenarioSpace } from './contract.js';
import { falsify } from './falsifier.js';
import { normalCdf } from './normal.js';
import { directPool, gaussianNoise, syntheticTrialFn } from './testing.js';

// golem-falsify-hardening item B: calibration of the robust / seed-sensitive label on synthetic noise.
// Robustness is base(scenario) + sigma * N(0, 1) with N drawn from the trial seed, so the true failure
// probability at the labelled scenario is p = Phi(-base / sigma). Truth: robust when p >= 0.99,
// seed-sensitive when p <= 0.5. The label "all three verification seeds fail" is robust with
// probability p^3, so the expected recalls are at least 0.97 and 0.875.
const space: ScenarioSpace = {
  dims: [
    { name: 'force', kind: 'force', min: 0, max: 250, severity: 'up' },
    { name: 'angle', kind: 'angle', min: 0, max: 360, severity: 'none', wrap: true },
  ],
};

interface NoiseCase { label: string; base: (s: Scenario) => number; sigma: number }
const cases: NoiseCase[] = [];
for (const sigma of [0.01, 0.02, 0.05, 0.1]) {
  for (const theta of [150, 200, 240]) {
    cases.push({ label: `(${theta} - force)/250 + ${sigma} N`, base: (s) => (theta - (s['force'] as number)) / 250, sigma });
  }
}
// genuinely seed-sensitive: fails in about 11% of seeds anywhere above 200 N (probe 4)
cases.push({ label: 'force > 200: 0.05 + 0.04 N', base: (s) => ((s['force'] as number) > 200 ? 0.05 : 1), sigma: 0.04 });

describe('classification calibration', () => {
  it('labels truly robust failures robust and truly seed-sensitive ones seed-sensitive', async () => {
    const m = { robust: { robust: 0, 'seed-sensitive': 0 }, 'seed-sensitive': { robust: 0, 'seed-sensitive': 0 } };
    // the label the unfixed code gave (verification at the shrunk point), against the same truth
    const old = { robust: { robust: 0, 'seed-sensitive': 0 }, 'seed-sensitive': { robust: 0, 'seed-sensitive': 0 } };
    let middle = 0;
    for (const c of cases) {
      const fn = syntheticTrialFn((s, seed) => c.base(s) + c.sigma * gaussianNoise(seed));
      for (let k = 1; k <= 25; k++) {
        const r = await falsify({ id: 'R1', space }, directPool(fn), { appId: 'a', budget: { maxTrials: 200 }, searchSeed: k * 7919 });
        if (r.meta.classification === undefined) continue;
        const p = normalCdf(-c.base(r.meta.verification!.scenario) / c.sigma);
        const truth = p >= 0.99 ? 'robust' : p <= 0.5 ? 'seed-sensitive' : undefined;
        if (truth === undefined) { middle++; continue; }
        m[truth][r.meta.classification]++;
        if (r.meta.boundarySensitive !== undefined) old[truth][r.meta.boundarySensitive ? 'seed-sensitive' : 'robust']++;
      }
    }
    const robustN = m.robust.robust + m.robust['seed-sensitive'];
    const sensitiveN = m['seed-sensitive'].robust + m['seed-sensitive']['seed-sensitive'];
    console.log(`calibration confusion (rows truth, columns label): ${JSON.stringify(m)}; 0.5 < p < 0.99 excluded: ${middle}; label at the shrunk point (before the fix): ${JSON.stringify(old)}`);
    expect(robustN).toBeGreaterThanOrEqual(50);
    expect(sensitiveN).toBeGreaterThanOrEqual(20);
    expect(m.robust.robust / robustN).toBeGreaterThanOrEqual(0.9);
    expect(m['seed-sensitive']['seed-sensitive'] / sensitiveN).toBeGreaterThanOrEqual(0.85);
  }, 60000);
});
