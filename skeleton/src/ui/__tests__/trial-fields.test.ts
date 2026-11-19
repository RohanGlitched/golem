import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { syntheticDiagnostics, syntheticHash, syntheticTrialFields } from '../core/trial-fields.js';
import { synthPoses } from './fakes.js';
import type { TrialSpec } from '../types.js';

const spec = (seed: number, scenario: Record<string, number> = { 'push.force': 5 }): TrialSpec => ({ app: 'test', reqId: 'R1', scenario, seed });

describe('synthetic trial fields', () => {
  it('gives a 16-digit hex hash that is the same for the same trial and differs for another seed or pose', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 2 ** 31 }), fc.integer({ min: 0, max: 200 }), (seed, force) => {
      const s = spec(seed, { 'push.force': force });
      const h = syntheticHash(s);
      expect(h).toMatch(/^[0-9a-f]{16}$/);
      expect(syntheticHash({ ...s, scenario: { ...s.scenario } })).toBe(h);
      expect(syntheticHash(spec(seed + 1, { 'push.force': force }))).not.toBe(h);
    }), { numRuns: 100 });
    const a = synthPoses(3, 5), b = synthPoses(3, 5);
    expect(syntheticHash(spec(1), a)).toBe(syntheticHash(spec(2), b));
    b.frames[8] = 7;
    expect(syntheticHash(spec(1), b)).not.toBe(syntheticHash(spec(1), a));
  });
  it('describes a clean trial: horizon from the poses, steps from the timestep, nothing diverged', () => {
    const poses = synthPoses(3, 31, 30); // 30 intervals at 30 fps
    const { diagnostics } = syntheticTrialFields(spec(1), poses, { warmup: 0.2, timestep: 0.002 });
    expect(diagnostics.horizon).toBeCloseTo(1, 12);
    expect(diagnostics.simSteps).toBe(600);
    expect(diagnostics.numerical).toBe(false);
    expect(diagnostics.diverged).toBeUndefined();
    expect(syntheticDiagnostics().simSteps).toBe(0);
  });
});
