import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import type { TrialSpec } from './contract.js';
import { arbSpace, arbSynthetic, directPool, makeSynthetic, scenarioFromFractions, syntheticTrialFn } from './testing.js';
import { latinHypercube } from './lhs.js';

const spec = (i: number): TrialSpec => ({ app: 'a', reqId: 'R1', scenario: { x: i }, seed: i });
const fn = syntheticTrialFn((s) => 10 - (s['x'] as number));

describe('synthetic robustness functions', () => {
  it('half-space margins are pure and change sign at the threshold', () => {
    const f = makeSynthetic({ kind: 'halfspace', dim: 'x', threshold: 5, failAbove: true });
    expect(f({ x: 4 }, 1)).toBe(1);
    expect(f({ x: 4 }, 1)).toBe(1);
    expect(f({ x: 6 }, 1)).toBe(-1);
  });
  it('a box is negative inside and positive outside', () => {
    const f = makeSynthetic({ kind: 'boxes', boxes: [{ bounds: { x: [2, 4] } }] });
    expect(f({ x: 3 }, 0)).toBe(-1);
    expect(f({ x: 5 }, 0)).toBe(1);
  });
  it('noise depends on the seed only', () => {
    const f = makeSynthetic({ kind: 'noisy', base: { kind: 'const', value: 0 }, amplitude: 1 });
    expect(f({}, 7)).toBe(f({}, 7));
    expect(f({}, 7)).not.toBe(f({}, 8));
  });
  it('generated functions are pure and finite', () => {
    fc.assert(
      fc.property(arbSpace.chain((sp) => fc.tuple(fc.constant(sp), arbSynthetic(sp))), fc.integer({ min: 0, max: 2 ** 32 - 1 }), ([sp, s], seed) => {
        const f = makeSynthetic(s);
        const x = scenarioFromFractions(sp, [0.3, 0.7, 0.1]);
        expect(f(x, seed)).toBe(f(x, seed));
        expect(Number.isFinite(f(x, seed))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe('directPool', () => {
  it('returns results in input order with spec equal to the input spec, even with shuffled completion', async () => {
    const pool = directPool(fn, { shuffleSeed: 3 });
    const specs = [0, 1, 2, 3, 4, 5].map(spec);
    const order: number[] = [];
    const res = await pool.run(specs, (r) => { order.push(r.spec.seed); });
    expect(res.map((r) => r.spec)).toEqual(specs);
    expect([...order].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(order).not.toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('rejects with AbortError when the signal is already aborted', async () => {
    const ac = new AbortController(); ac.abort();
    await expect(directPool(fn).run([spec(1)], undefined, { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('can reject a chosen run', async () => {
    const pool = directPool(fn, { rejectRun: (call) => (call === 1 ? new Error('pool down') : undefined) });
    await pool.run([spec(1)]);
    await expect(pool.run([spec(2)])).rejects.toThrow('pool down');
  });
  it('never calls Math.random in the engine and helpers', async () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random called'); });
    try {
      latinHypercube({ dims: [{ name: 'x', kind: 'force', min: 0, max: 1, severity: 'up' }] }, 8, 1, 0);
      await directPool(fn, { shuffleSeed: 1 }).run([spec(1), spec(2)]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
