import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ScenarioSpace } from './contract.js';
import { DEFAULT_CEM, initCem, refitCem, sampleCem, type CemState, type DimDist, type Observed } from './cem.js';
import { prevDouble } from './lhs.js';
import { arbSpace } from './testing.js';

const u32 = fc.integer({ min: 0, max: 2 ** 32 - 1 });

function observe(space: ScenarioSpace, fracs: number[][], rs: number[]): Observed[] {
  return fracs.map((fr, i) => {
    const scenario: Record<string, number> = {};
    space.dims.forEach((d, j) => {
      const f = fr[j % fr.length] as number;
      let v = d.min + f * (d.max - d.min);
      if (d.wrap === true && v >= d.max) v = prevDouble(d.max);
      scenario[d.name] = Math.min(d.max, v);
    });
    return { scenario, robustness: rs[i % rs.length] as number, index: i };
  });
}

const arbObs = fc.tuple(
  fc.array(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 6 }), { minLength: 0, maxLength: 24 }),
  fc.array(fc.integer({ min: -5, max: 5 }), { minLength: 1, maxLength: 24 }),
);

describe('cem fit properties', () => {
  // Feature: golem-falsify, Property 7: CEM fit clamps and keeps previous state
  it('fits the elite mean with a 1% sigma floor, keeps fixed dimensions, and keeps the previous state below 2 elites', () => {
    fc.assert(
      fc.property(arbSpace, arbObs, (space, [fracs, rs]) => {
        const obs = observe(space, fracs, rs);
        const state = initCem(space, obs, DEFAULT_CEM);
        const elites = [...obs].sort((a, b) => a.robustness - b.robustness || a.index - b.index).slice(0, Math.ceil(0.25 * obs.length));
        space.dims.forEach((d, i) => {
          const dist = state.dists[i] as DimDist;
          const width = d.max - d.min;
          if (d.min === d.max) { expect(dist.kind).toBe('fixed'); return; }
          if (elites.length < 2) {
            expect(dist).toMatchObject({ mu: d.min + width / 2, sigma: 0.25 * width });
            return;
          }
          if (d.wrap === true) {
            if (dist.kind === 'wrapped') {
              expect(dist.sigma).toBeGreaterThanOrEqual(0.01 * width * (1 - 1e-12));
              expect(dist.mu).toBeGreaterThanOrEqual(d.min);
              expect(dist.mu).toBeLessThan(d.max);
            } else expect(dist.kind).toBe('uniformCircle');
            return;
          }
          const xs = elites.map((e) => e.scenario[d.name] as number);
          const mu = xs.reduce((s, x) => s + x, 0) / xs.length;
          const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / xs.length);
          expect(dist.kind).toBe('normal');
          if (dist.kind !== 'normal') return;
          expect(dist.mu).toBeGreaterThanOrEqual(d.min);
          expect(dist.mu).toBeLessThanOrEqual(d.max);
          expect(dist.mu).toBeCloseTo(Math.min(d.max, Math.max(d.min, mu)), 9);
          expect(dist.sigma).toBeCloseTo(Math.max(sd, 0.01 * width), 9);
        });
        const prev = initCem(space, [], DEFAULT_CEM);
        const one = observe(space, [[0.3]], [1]);
        expect(refitCem(space, prev, one, DEFAULT_CEM)).toBe(prev);
        expect(initCem(space, [], DEFAULT_CEM).dists.every((x) => x.kind !== 'normal' || x.sigma > 0)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: golem-falsify, Property 2: Sampling ranges, wrap-aware (CEM part)
  it('samples inside [min, max] and wrap dimensions inside [min, max), also for degenerate sigma and seam means', () => {
    const arbDist = (space: ScenarioSpace) =>
      fc.tuple(...space.dims.map((d): fc.Arbitrary<DimDist> => {
        if (d.min === d.max) return fc.constant({ kind: 'fixed' });
        const width = d.max - d.min;
        const sigma = fc.oneof(
          fc.constant(0.01 * width), fc.constant(1e-9 * width), fc.double({ min: 0.01 * width, max: 5 * width, noNaN: true }),
        );
        if (d.wrap === true) {
          return fc.oneof(
            fc.constant<DimDist>({ kind: 'uniformCircle' }),
            fc.tuple(
              fc.oneof(fc.constant(d.min), fc.constant(prevDouble(d.max)), fc.double({ min: d.min, max: prevDouble(d.max), noNaN: true })),
              sigma,
            ).map(([mu, s]): DimDist => ({ kind: 'wrapped', mu, sigma: s })),
          );
        }
        return fc.tuple(fc.double({ min: d.min, max: d.max, noNaN: true }), sigma)
          .map(([mu, s]): DimDist => ({ kind: 'normal', mu, sigma: s }));
      }));
    fc.assert(
      fc.property(
        arbSpace.chain((space) => fc.tuple(fc.constant(space), arbDist(space))),
        fc.integer({ min: 0, max: 60 }), u32, fc.integer({ min: 0, max: 100 }),
        ([space, dists], n, seed, g) => {
          const state: CemState = { dists };
          for (const x of sampleCem(space, state, n, seed, g)) {
            for (const d of space.dims) {
              const v = x[d.name] as number;
              expect(v).toBeGreaterThanOrEqual(d.min);
              if (d.wrap === true && d.min !== d.max) expect(v).toBeLessThan(d.max);
              else expect(v).toBeLessThanOrEqual(d.max);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
