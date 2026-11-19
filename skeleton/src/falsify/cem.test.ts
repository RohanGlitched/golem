import { describe, expect, it } from 'vitest';
import type { ScenarioSpace } from './contract.js';
import {
  eliteSet, initCem, isLhsPosition, refitCem, sampleCem, sampleGeneration, selectElites, validateCemParams, DEFAULT_CEM,
  type CemState, type Observed,
} from './cem.js';
import { latinHypercube } from './lhs.js';
import { deriveSeed, SALT } from './prng.js';

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
const UNIFORM = [{ kind: 'uniform' }, { kind: 'uniformCircle' }, { kind: 'fixed' }];

describe('cem', () => {
  // golem-falsify-hardening defect 2 supersedes golem-falsify 5.1: no information means uniform, not a
  // normal at the midpoint with 25% of the width.
  it('starts uniform with zero Phase 1 trials', () => {
    expect(initCem(space, [], DEFAULT_CEM).dists).toEqual(UNIFORM);
  });
  it('starts uniform when only one elite exists', () => {
    const s = initCem(space, [obs(10, 10, -1, 0), obs(20, 20, 5, 1)], { ...DEFAULT_CEM, eliteFraction: 0.5 });
    expect(s.dists).toEqual(UNIFORM);
  });
  it('fits tied best observations together and floors sigma at 1% of the width', () => {
    // one slot (0.25 of 4), but the two best tie at 0: both are elites
    const s = initCem(space, [obs(50, 359, 0, 0), obs(50, 1, 0, 1), obs(200, 180, 9, 2), obs(0, 90, 9, 3)], DEFAULT_CEM);
    expect(s.dists[0]).toEqual({ kind: 'normal', mu: 50, sigma: 2 });
    const d1 = s.dists[1];
    expect(d1?.kind === 'wrapped' && Math.min(d1.mu, 360 - d1.mu)).toBeLessThan(1e-6);
  });
  it('excludes NaN trials from elite selection', () => {
    const e = selectElites([obs(1, 1, NaN, 0), obs(2, 2, 3, 1), obs(3, 3, 1, 2)], 1 - 1e-9);
    expect(e.map((x) => x.index)).toEqual([2, 1]);
  });
  it('breaks robustness ties by the lower index in selectElites', () => {
    const e = selectElites([obs(1, 1, 1, 3), obs(2, 2, 1, 1), obs(3, 3, 1, 2)], 0.4);
    expect(e.map((x) => x.index)).toEqual([1, 2]);
  });
  it('keeps the previous state when fewer than 2 usable observations exist', () => {
    const prev = initCem(space, [], DEFAULT_CEM);
    expect(refitCem(space, prev, [obs(1, 1, 0, 0)], DEFAULT_CEM)).toBe(prev);
  });
  it('blends with the previous state when smoothing is below 1', () => {
    const prev: CemState = { dists: [{ kind: 'normal', mu: 100, sigma: 50 }, { kind: 'wrapped', mu: 180, sigma: 90 }, { kind: 'fixed' }], carried: [] };
    const gen = [obs(0, 0, 0, 0), obs(0, 0, 0, 1), obs(0, 0, 1, 2), obs(0, 0, 1, 3)];
    const s = refitCem(space, prev, gen, { ...DEFAULT_CEM, genSize: 4, eliteFraction: 0.5, smoothing: 0.5 });
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
  it('rejects an invalid generation size, elite fraction, smoothing and LHS fraction, naming the value', () => {
    expect(validateCemParams({ ...DEFAULT_CEM, genSize: 1 })).toMatch(/generationSize.*1/);
    expect(validateCemParams({ ...DEFAULT_CEM, genSize: 2.5 })).toMatch(/2\.5/);
    expect(validateCemParams({ ...DEFAULT_CEM, eliteFraction: 0 })).toMatch(/eliteFraction/);
    expect(validateCemParams({ ...DEFAULT_CEM, eliteFraction: 1 })).toMatch(/eliteFraction/);
    expect(validateCemParams({ ...DEFAULT_CEM, smoothing: 0 })).toMatch(/smoothing/);
    expect(validateCemParams({ ...DEFAULT_CEM, lhsFraction: 1 })).toMatch(/lhsFraction.*1/);
    expect(validateCemParams({ ...DEFAULT_CEM, lhsFraction: -0.1 })).toMatch(/lhsFraction/);
    expect(validateCemParams(DEFAULT_CEM)).toBeUndefined();
  });
  it('defaults to generations of 32 with a 20% LHS share', () => {
    expect(DEFAULT_CEM).toEqual({ genSize: 32, eliteFraction: 0.25, smoothing: 1, lhsFraction: 0.2 });
  });
});

describe('cem on flat robustness (golem-falsify-hardening defect 2)', () => {
  const graded: CemState = { dists: [{ kind: 'normal', mu: 30, sigma: 5 }, { kind: 'wrapped', mu: 90, sigma: 10 }, { kind: 'fixed' }], carried: [] };

  it('puts every tie at the threshold in the elite set and flags a flat set as uninformative', () => {
    const tied = [obs(1, 1, 1, 4), obs(2, 2, 1, 0), obs(3, 3, 0, 9), obs(4, 4, 1, 2), obs(5, 5, 7, 1)];
    const r = eliteSet(tied, 2);
    expect(r.elites.map((o) => o.index)).toEqual([9, 0, 2, 4]);
    expect(r.informative).toBe(true);
    const flat = eliteSet([obs(1, 1, 1, 0), obs(2, 2, 1, 1), obs(3, 3, 1, 2)], 1);
    expect(flat.elites).toHaveLength(3);
    expect(flat.informative).toBe(false);
  });

  it('returns the uniform distribution after a flat generation instead of shrinking onto the lowest indices', () => {
    const gen = Array.from({ length: 32 }, (_, i) => obs(i * 6, i * 11, 1, i));
    const s = refitCem(space, graded, gen, DEFAULT_CEM);
    expect(s.dists).toEqual(UNIFORM);
  });

  it('carries the best observations into the next fit, so one bad generation does not lose them', () => {
    const p = { ...DEFAULT_CEM, genSize: 8 }; // 2 slots
    const s1 = refitCem(space, { ...graded, carried: [] }, [obs(10, 10, 0.1, 0), obs(12, 12, 0.1, 1), ...Array.from({ length: 6 }, (_, i) => obs(150, 200, 3 + i, 2 + i))], p);
    expect(s1.carried.map((o) => o.index)).toEqual([0, 1]);
    const bad = Array.from({ length: 8 }, (_, i) => obs(190, 300, 5 + i, 8 + i));
    const s2 = refitCem(space, s1, bad, p);
    const d = s2.dists[0];
    expect(d?.kind === 'normal' && d.mu).toBeCloseTo(11, 9);
    expect(s2.carried.map((o) => o.index)).toEqual([0, 1]);
  });

  it('draws the LHS share at interleaved positions, and a short generation is the prefix of the full one', () => {
    const G = 10;
    const p = 0.2; // m = 2
    const full = sampleGeneration(space, graded, G, G, p, 77, 3);
    const lhs = latinHypercube(space, 2, deriveSeed(77, SALT.cemLhs, 0), 3);
    const pos = Array.from({ length: G }, (_, i) => i).filter((i) => isLhsPosition(i, 2, G));
    expect(pos).toEqual([4, 9]);
    expect(pos.map((i) => full[i])).toEqual(lhs);
    for (let n = 0; n <= G; n++) expect(sampleGeneration(space, graded, G, n, p, 77, 3)).toEqual(full.slice(0, n));
  });

  it('draws a whole generation by LHS when the state is uniform', () => {
    const st = initCem(space, [], DEFAULT_CEM);
    expect(sampleGeneration(space, st, 8, 8, 0.2, 5, 1)).toEqual(latinHypercube(space, 8, deriveSeed(5, SALT.cemLhs, 0), 1));
  });
});
