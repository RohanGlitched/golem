import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ACT_DIM, HIDDEN, OBS_DIM, Policy, elu, linear, lstmStep } from '../controller/policy';
import { packPolicy } from '../scripts/lib/pack.mjs';
import { allocations, functionBody } from './helpers/sourceScan';
import { constantWeights } from './helpers/weights';


describe('Policy building blocks', () => {
  it('computes a single LSTM step by hand', () => {
    // input 1, hidden 1: gates = Wih x + bih + Whh h + bhh for i, f, g, o
    const w = { Wih: new Float64Array([1, 2, 3, 4]), Whh: new Float64Array([0.5, 0.5, 0.5, 0.5]), bih: new Float64Array([0, 0, 0, 0]), bhh: new Float64Array([0.1, 0.2, 0.3, 0.4]), input: 1, hidden: 1 };
    const h = new Float64Array([0.2]), c = new Float64Array([0.3]);
    lstmStep(w, new Float64Array([1]), h, c, new Float64Array(4));
    const sig = (x: number): number => 1 / (1 + Math.exp(-x));
    const gi = 1 + 0.1 + 0.1, gf = 2 + 0.1 + 0.2, gg = 3 + 0.1 + 0.3, go = 4 + 0.1 + 0.4;
    const cn = sig(gf) * 0.3 + sig(gi) * Math.tanh(gg);
    expect(c[0]).toBeCloseTo(cn, 14);
    expect(h[0]).toBeCloseTo(sig(go) * Math.tanh(cn), 14);
  });
  it('applies ELU with alpha 1 to negative inputs and leaves positive inputs unchanged', () => {
    const x = new Float64Array([-1, 0, 2, -0.5]);
    elu(x, 4);
    expect(x[0]).toBeCloseTo(Math.exp(-1) - 1, 15);
    expect(x[1]).toBe(0);
    expect(x[2]).toBe(2);
    expect(x[3]).toBeCloseTo(Math.exp(-0.5) - 1, 15);
  });
  it('computes a linear layer row-major', () => {
    const y = new Float64Array(2);
    linear(new Float64Array([1, 2, 3, 4, 5, 6]), new Float64Array([1, -1]), 2, 3, new Float64Array([1, 1, 1]), y);
    expect(Array.from(y)).toEqual([7, 14]);
  });
});

describe('Policy', () => {
  it('rejects input or output of the wrong length, naming both lengths', () => {
    const p = new Policy(constantWeights(0.01));
    expect(() => p.step(new Float64Array(46), new Float64Array(12))).toThrow('input of length 47 and an output of length 12, got input 46 and output 12');
    expect(() => p.step(new Float64Array(47), new Float64Array(11))).toThrow('got input 47 and output 11');
  });
  it('rejects a policy.bin tensor with the wrong shape, naming the tensor and both shapes', () => {
    const bin = packPolicy(constantWeights(0.01), 'c'.repeat(40));
    const dv = new DataView(bin.buffer);
    const hlen = dv.getUint32(0, true);
    const json = new TextDecoder().decode(bin.subarray(4, 4 + hlen)).replace('"shape":[32,64]', '"shape":[64,32]');
    bin.set(new TextEncoder().encode(json), 4);
    expect(() => Policy.fromBytes(bin)).toThrow('policy tensor W1 has shape [64, 32], expected [32, 64]');
  });
  it('rejects a tensor with the wrong number of values', () => {
    const w = constantWeights(0.01);
    w.b2 = new Float32Array(11);
    expect(() => new Policy(w)).toThrow('policy tensor b2 has 11 values, expected 12');
  });
  it('starts with h and c at zero and reset sets them back to zero', () => {
    const p = new Policy(constantWeights(0.05));
    expect(p.h.every((v) => v === 0) && p.c.every((v) => v === 0)).toBe(true);
    p.step(new Float64Array(OBS_DIM).fill(1), new Float64Array(ACT_DIM));
    expect(p.h.some((v) => v !== 0)).toBe(true);
    p.reset();
    expect(p.h.every((v) => v === 0) && p.c.every((v) => v === 0)).toBe(true);
    expect(p.h.length).toBe(HIDDEN);
  });
  it('loads the committed policy.bin and gives finite actions', () => {
    const p = Policy.fromBytes(readFileSync(new URL('../robot/policy.bin', import.meta.url)));
    const out = new Float64Array(12);
    p.step(new Float64Array(47), out);
    expect(out.every(Number.isFinite)).toBe(true);
  });
  it('allocates nothing inside Policy.step, lstmStep, linear or elu', () => {
    expect(allocations(functionBody('controller/policy.ts', /\n  step\(obs: Float64Array/))).toEqual([]);
    expect(allocations(functionBody('controller/policy.ts', /export function lstmStep\(/))).toEqual([]);
    expect(allocations(functionBody('controller/policy.ts', /export function linear\(/))).toEqual([]);
    expect(allocations(functionBody('controller/policy.ts', /export function elu\(/))).toEqual([]);
  });
});