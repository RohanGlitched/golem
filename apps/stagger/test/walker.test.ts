import { describe, expect, it } from 'vitest';
import { DEFAULT_POSE } from '../controller/observation';
import { Policy } from '../controller/policy';
import { Walker } from '../controller/walker';
import { runtimeFor } from '../runtime';
import { allocations, functionBody } from './helpers/sourceScan';
import { constantWeights } from './helpers/weights';
import { stubCtx } from './helpers/stubCtx';


class CountingPolicy extends Policy {
  calls = 0; resets = 0;
  constructor() { super(constantWeights(0)); }
  override reset(): void { this.resets++; super.reset(); }
  override step(obs: Float64Array, out: Float64Array): void { this.calls++; out.fill(this.calls); }
}

describe('Walker', () => {
  it('holds the default pose on the first call, then runs the policy once per call', () => {
    const ctx = stubCtx();
    const p = new CountingPolicy();
    const w = new Walker(ctx, p, runtimeFor(ctx));
    w.step(ctx, 0);
    expect(p.calls).toBe(0);
    expect(Array.from(ctx.data.ctrl)).toEqual(Array.from(DEFAULT_POSE));
    for (let k = 1; k <= 9; k++) w.step(ctx, 0.02 * k);
    expect(p.calls).toBe(9);
    expect(w.policyCalls).toBe(9);
  });
  it('writes target = action * 0.25 + default pose to ctrl and keeps the action as previous action', () => {
    const ctx = stubCtx();
    const p = new CountingPolicy();
    const w = new Walker(ctx, p, runtimeFor(ctx));
    w.step(ctx, 0); w.step(ctx, 0.02);
    for (let j = 0; j < 12; j++) expect(ctx.data.ctrl[j]).toBeCloseTo(DEFAULT_POSE[j]! + 0.25, 15);
    expect(Array.from(w.previousAction)).toEqual(new Array(12).fill(1));
  });
  it('resets the policy, the previous action and the target when constructed', () => {
    const ctx = stubCtx();
    const p = new CountingPolicy();
    const w = new Walker(ctx, p, runtimeFor(ctx));
    expect(p.resets).toBe(1);
    expect(Array.from(w.target)).toEqual(Array.from(DEFAULT_POSE));
    expect(Array.from(w.previousAction)).toEqual(new Array(12).fill(0));
  });
  it('allocates nothing inside step', () => {
    expect(allocations(functionBody('controller/walker.ts', /\n  step\(ctx: SimContext, t: number\): void/))).toEqual([]);
  });
});