import { describe, expect, it } from 'vitest';
import type { CompiledRequirement, FalsifyOptions, TrialPool, TrialResult } from 'golem-spec';
import { planFalsifier, runOne, type FalsifyFn } from './falsifier.js';
import type { FalsifierRecord } from './core/falsifier-summary.js';

const space = { dims: [{ name: 'push.force', kind: 'force' as const, min: 0, max: 200, severity: 'up' as const }] };
const req = { id: '1.2', space } as unknown as CompiledRequirement;
const pool = {} as TrialPool;
let t = 0;
const now = (): number => (t += 5);

/** A fake falsifier that reports failing trials at 150 N and 100 N in Phase 1, then shrinks to 60 N. */
const fake: FalsifyFn = async (_r, _p, o: FalsifyOptions) => {
  const mk = (f: number): TrialResult => ({ spec: { app: 'a', reqId: '1.2', scenario: { 'push.force': f }, seed: 1 }, robustness: 90 - f, worstAt: 1, unit: 'm', wallMs: 0 });
  o.onResult?.(mk(150), { phase: 1, generation: 0, index: 0 });
  o.onResult?.(mk(100), { phase: 1, generation: 0, index: 1 });
  o.onResult?.(mk(10), { phase: 3, generation: 0, index: 2 });
  return {
    verdict: {
      reqId: '1.2', status: 'broken', trials: 40, randomTrials: 32, guidedTrials: 0,
      closest: { robustness: -50, scenario: { 'push.force': 150 }, seed: 1 }, ms: 1,
      counterexample: { reqId: '1.2', scenario: { 'push.force': 60 }, seed: 1, robustness: -0.1, shrunk: o.mode === 'full', foundAfter: 7 },
    },
    meta: { stopReason: 'failure-found', phaseTrials: { p0: 0, p1: 32, p2: 0, p3: 8 }, errors: [] },
  } as unknown as Awaited<ReturnType<FalsifyFn>>;
};

describe('runOne', () => {
  it('records the first-failure count, the mildest failing search severity and the shrunk severity', async () => {
    const r = await runOne({ app: 'stagger', req, arm: 'guided', searchSeed: 3, attempt: 1, budget: 96, falsify: fake, pool, now });
    expect(r).toMatchObject({ found: true, status: 'broken', trialsToFirst: 7, sevFound: 0.5, sevShrunk: 0.3, searchSeed: 3, arm: 'guided' });
  });
  it('leaves the shrunk severity empty for the random arm and passes the registered options', async () => {
    let seen: FalsifyOptions | undefined;
    const spy: FalsifyFn = (r, p, o) => { seen = o; return fake(r, p, o); };
    const r = await runOne({ app: 'stagger', req, arm: 'random', searchSeed: 4, attempt: 1, budget: 96, falsify: spy, pool, now });
    expect(r.sevShrunk).toBeNull();
    expect(seen).toMatchObject({ appId: 'stagger', budget: { maxTrials: 96 }, searchSeed: 4, mode: 'random-only' });
    expect(seen?.seedDb).toBeUndefined();
  });
  it('turns a throw into an error record instead of failing the campaign', async () => {
    const boom: FalsifyFn = async () => { throw new Error('pool died'); };
    const r = await runOne({ app: 'stagger', req, arm: 'guided', searchSeed: 1, attempt: 1, budget: 96, falsify: boom, pool, now });
    expect(r).toMatchObject({ status: 'error', found: null, errors: ['pool died'] });
  });
});

describe('planFalsifier', () => {
  const done = (o: Partial<FalsifierRecord>): FalsifierRecord => ({
    app: 'stagger', reqId: '1.2', arm: 'guided', searchSeed: 1, attempt: 1, budget: 96, status: 'broken', found: true,
    trialsToFirst: 1, sevFound: 0, sevShrunk: null, robustness: 0, trials: 1, wallMs: 1, ...o,
  });
  it('plans every run when nothing exists, guided before random', () => {
    const p = planFalsifier(['1.2', '4.2'], [1, 2], 'stagger', []);
    expect(p).toHaveLength(8);
    expect(p[0]).toEqual({ reqId: '1.2', arm: 'guided', searchSeed: 1, attempt: 1 });
    expect(p[1]).toEqual({ reqId: '1.2', arm: 'random', searchSeed: 1, attempt: 1 });
  });
  it('plans nothing for finished runs, and one retry for a first error only', () => {
    expect(planFalsifier(['1.2'], [1], 'stagger', [done({}), done({ arm: 'random' })])).toEqual([]);
    const err = done({ found: null, status: 'error' });
    expect(planFalsifier(['1.2'], [1], 'stagger', [err, done({ arm: 'random' })])).toEqual([{ reqId: '1.2', arm: 'guided', searchSeed: 1, attempt: 2 }]);
    expect(planFalsifier(['1.2'], [1], 'stagger', [err, { ...err, attempt: 2 }, done({ arm: 'random' })])).toEqual([]);
  });
});