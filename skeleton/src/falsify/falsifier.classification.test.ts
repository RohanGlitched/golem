import { describe, expect, it } from 'vitest';
import type { ScenarioSpace } from './contract.js';
import { falsify } from './falsifier.js';
import { directPool, gaussianNoise, syntheticTrialFn } from './testing.js';

// golem-falsify-hardening defect 1: classify at the original failure, report the shrunk point separately.
const space: ScenarioSpace = {
  dims: [
    { name: 'force', kind: 'force', min: 0, max: 250, severity: 'up' },
    { name: 'angle', kind: 'angle', min: 0, max: 360, severity: 'none', wrap: true },
  ],
};
const req = { id: 'R1', space };

describe('falsify: robust versus seed-sensitive', () => {
  it('labels a failure that is robust in the interior robust, although its shrunk point sits on the boundary', async () => {
    // Base margin (150 - force)/250 goes down to -0.4 at 250 N; noise 0.02 (probe 4).
    const fn = syntheticTrialFn((s, seed) => (150 - (s['force'] as number)) / 250 + 0.02 * gaussianNoise(seed));
    const labels: string[] = [];
    for (let k = 1; k <= 30; k++) {
      const r = await falsify(req, directPool(fn), { appId: 'a', budget: { maxTrials: 200 }, searchSeed: k });
      expect(r.verdict.status).toBe('broken');
      labels.push(r.meta.classification ?? 'none');
      const v = r.meta.verification!;
      const b = r.meta.boundaryVerification!;
      // the label comes from the unshrunk failure, the boundary flag from the shrunk point
      expect(v.scenario).not.toEqual(r.verdict.counterexample!.scenario);
      expect(b.scenario).toEqual(r.verdict.counterexample!.scenario);
      expect(b.seeds).toEqual(v.seeds);
      expect(r.meta.boundarySensitive).toBe(b.robustness.some((x) => x! >= 0));
      expect(r.pinEntry!.boundarySensitive).toBe(r.meta.boundarySensitive);
      expect(r.meta.p3Detail.verification).toBe(6);
    }
    expect(labels.filter((l) => l === 'robust').length).toBeGreaterThanOrEqual(28);
  });

  it('runs no extra trials when the shrink changed nothing, and copies the label to boundarySensitive', async () => {
    const noSeverity: ScenarioSpace = { dims: [{ name: 'angle', kind: 'angle', min: 0, max: 360, severity: 'none', wrap: true }] };
    const fn = syntheticTrialFn((s) => (s['angle'] as number) < 180 ? -1 : 1);
    const r = await falsify({ id: 'R1', space: noSeverity }, directPool(fn), { appId: 'a', budget: { maxTrials: 50 }, searchSeed: 3 });
    expect(r.verdict.counterexample!.shrunk).toBe(false);
    expect(r.meta.p3Detail.verification).toBe(3);
    expect(r.meta.boundaryVerification).toBeUndefined();
    expect(r.meta.classification).toBe('robust');
    expect(r.meta.boundarySensitive).toBe(false);
  });

  it('still labels a failure that needs a lucky seed seed-sensitive', async () => {
    // fails in about 11% of seeds anywhere above 200 N (probe 4)
    const fn = syntheticTrialFn((s, seed) => ((s['force'] as number) > 200 ? 0.05 + 0.04 * gaussianNoise(seed) : 1));
    let broken = 0;
    for (let k = 1; k <= 30; k++) {
      const r = await falsify(req, directPool(fn), { appId: 'a', budget: { maxTrials: 400 }, searchSeed: k });
      if (r.verdict.status === 'broken') { broken++; expect(r.meta.classification).toBe('seed-sensitive'); }
    }
    expect(broken).toBeGreaterThanOrEqual(25);
  });
});
