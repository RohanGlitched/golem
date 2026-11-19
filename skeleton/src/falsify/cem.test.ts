import { describe, expect, it } from 'vitest';
import type { ScenarioSpace } from './contract.js';
import {
  initCem, refitCem, sampleCem, selectElites, validateCemParams, DEFAULT_CEM, type Observed,
} from './cem.js';

const space: ScenarioSpace = {
  dims: [
    { name: 'f', kind: 'force', min: 0, max: 200, severity: 'up' },
    { name: 'a', kind: 'angle', min: 0, max: 360, severity: 'none', wrap: true },
    { name: 'fixed', kind: 'duration', min: 0.2, max: 0.2, severity: 'none' },
  ],
};
const obs = (f: number, a: number, r: number, index: number): Observed => ({
  scenario: { f, a, fixed: 0.2 }, robustness: r, index,
});

describe('cem', () => {
  it('starts from the midpoint and 25% of the width with zero Phase 1 trials', () => {
    const s = initCem(space, [], DEFAULT_CEM);
    expect(s.dists[0]).toEqual({ kind: 'normal', mu: 100, sigma: 50 });
    expect(s.dists[1]).toEqual({ kind: 'wrapped', mu: 180, sigma: 90 });
    expect(s.dists[2]).toEqual({ kind: 'fixed' });
  });
  it('starts from the prior when only one elite exists', () => {
    const s = initCem(space, [obs(10, 10, -1, 0), obs(20, 20, 5, 1)], { ...DEFAULT_CEM, eliteFraction: 0.5 });
    expect(s.dists[0]).toEqual({ kind: 'normal', mu: 100, sigma: 50 });
  });
  it('fits the elites exactly and floors sigma at 1% of the width', () => {
    const s = initCem(space, [obs(50, 359, 0, 0), obs(50, 1, 0, 1), obs(200, 180, 9, 2), obs(0, 90, 9, 3)], DEFAULT_CEM);
    // eliteFraction 0.25 of 4 = 1 elite: prior
    expect(s.dists[0]).toEqual({ kind: 'normal', mu: 100, sigma: 50 });
    const t = initCem(space, [obs(50, 359, 0, 0), obs(50, 1, 0, 1), obs(200, 180, 9, 2), obs(0, 90, 9, 3)], { ...DEFAULT_CEM, eliteFraction: 0.5 });
    const d0 = t.dists[0];
    expect(d0).toEqual({ kind: 'normal', mu: 50, sigma: 2 });
    const d1 = t.dists[1];
    expect(d1?.kind === 'wrapped' && Math.min(d1.mu, 360 - d1.mu)).toBeLessThan(1e-6);
  });
  it('excludes NaN trials from elite selection', () => {
    const e = selectElites([obs(1, 1, NaN, 0), obs(2, 2, 3, 1), obs(3, 3, 1, 2)], 1 - 1e-9);
    expect(e.map((x) => x.index)).toEqual([2, 1]);
  });
  it('breaks robustness ties by the lower index', () => {
    const e = selectElites([obs(1, 1, 1, 3), obs(2, 2, 1, 1), obs(3, 3, 1, 2)], 0.4);
    expect(e.map((x) => x.index)).toEqual([1, 2]);
  });
  it('keeps the previous state when fewer than 2 elites exist', () => {
    const prev = initCem(space, [], DEFAULT_CEM);
    expect(refitCem(space, prev, [obs(1, 1, 0, 0)], DEFAULT_CEM)).toBe(prev);
  });
  it('blends with the previous state when smoothing is below 1', () => {
    const prev = initCem(space, [], DEFAULT_CEM);
    const gen = [obs(0, 0, 0, 0), obs(0, 0, 0, 1), obs(0, 0, 1, 2), obs(0, 0, 1, 3)];
    const s = refitCem(space, prev, gen, { genSize: 4, eliteFraction: 0.5, smoothing: 0.5 });
    const d = s.dists[0];
    expect(d?.kind === 'normal' && d.mu).toBeCloseTo(50, 9);
  });
  it('leaves fixed dimensions fixed when sampling', () => {
    const s = sampleCem(space, initCem(space, [], DEFAULT_CEM), 10, 1, 0);
    for (const x of s) expect(x['fixed']).toBe(0.2);
  });
  it('samples deterministically per (seed, generation)', () => {
    const st = initCem(space, [], DEFAULT_CEM);
    expect(sampleCem(space, st, 5, 9, 2)).toEqual(sampleCem(space, st, 5, 9, 2));
    expect(sampleCem(space, st, 5, 9, 2)).not.toEqual(sampleCem(space, st, 5, 9, 3));
    expect(sampleCem(space, st, 0, 9, 2)).toEqual([]);
  });
  it('rejects an invalid generation size, elite fraction and smoothing, naming the value', () => {
    expect(validateCemParams({ ...DEFAULT_CEM, genSize: 1 })).toMatch(/generationSize.*1/);
    expect(validateCemParams({ ...DEFAULT_CEM, genSize: 2.5 })).toMatch(/2\.5/);
    expect(validateCemParams({ ...DEFAULT_CEM, eliteFraction: 0 })).toMatch(/eliteFraction/);
    expect(validateCemParams({ ...DEFAULT_CEM, eliteFraction: 1 })).toMatch(/eliteFraction/);
    expect(validateCemParams({ ...DEFAULT_CEM, smoothing: 0 })).toMatch(/smoothing/);
    expect(validateCemParams(DEFAULT_CEM)).toBeUndefined();
  });
});
