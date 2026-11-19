import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LatencyBuffer, delaySteps } from '../controller/latency';
import { DEFAULT_POSE, buildObservation, gaitPhase, projectedGravity } from '../controller/observation';
import { KD, KP, actionToTarget, pdTorque } from '../controller/pd';
import { POLICY_SHAPES, Policy } from '../controller/policy';
import { Walker } from '../controller/walker';
import { runtimeFor } from '../runtime';
import { constantWeights } from './helpers/weights';
import { stubCtx } from './helpers/stubCtx';

/** Deterministic weights in [-scale, scale] from a seed (xorshift32). */
function randomWeights(seed: number, scale = 0.3): Record<string, Float32Array> {
  let x = seed | 0 || 1;
  const next = (): number => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) / 4294967296) * 2 - 1; };
  const out: Record<string, Float32Array> = {};
  for (const [k, s] of Object.entries(POLICY_SHAPES)) {
    const n = s.reduce((a, b) => a * b, 1);
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = next() * scale;
    out[k] = f;
  }
  return out;
}

/** Naive reference: plain arrays, one gate at a time, written independently of policy.ts. */
function referenceNet(w: Record<string, Float32Array>) {
  const W = (name: string, r: number, c: number, cols: number): number => w[name]![r * cols + c]!;
  let h = new Array(64).fill(0) as number[];
  let c = new Array(64).fill(0) as number[];
  const sig = (v: number): number => 1 / (1 + Math.exp(-v));
  return (x: number[]): number[] => {
    const gate = (g: number, j: number): number => {
      const r = g * 64 + j;
      let s = w.bih![r]! + w.bhh![r]!;
      for (let k = 0; k < 47; k++) s += W('Wih', r, k, 47) * x[k]!;
      for (let k = 0; k < 64; k++) s += W('Whh', r, k, 64) * h[k]!;
      return s;
    };
    const nh: number[] = []; const nc: number[] = [];
    for (let j = 0; j < 64; j++) {
      const i = sig(gate(0, j)), f = sig(gate(1, j)), g = Math.tanh(gate(2, j)), o = sig(gate(3, j));
      nc[j] = f * c[j]! + i * g;
      nh[j] = o * Math.tanh(nc[j]!);
    }
    h = nh; c = nc;
    const y1 = Array.from({ length: 32 }, (_, r) => {
      let s = w.b1![r]!;
      for (let k = 0; k < 64; k++) s += W('W1', r, k, 64) * h[k]!;
      return s > 0 ? s : Math.exp(s) - 1;
    });
    return Array.from({ length: 12 }, (_, r) => {
      let s = w.b2![r]!;
      for (let k = 0; k < 32; k++) s += W('W2', r, k, 32) * y1[k]!;
      return s;
    });
  };
}

const obsArb = fc.array(fc.double({ min: -10, max: 10, noNaN: true }), { minLength: 47, maxLength: 47 });
const relClose = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

describe('Feature: stagger-app, Property 11: The Policy matches a reference network', () => {
  it('equals a naive LSTM, Linear, ELU, Linear in Float64 within 1e-12 relative error', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 2 ** 31 - 1 }), fc.array(obsArb, { minLength: 1, maxLength: 4 }), (seed, seq) => {
      const w = randomWeights(seed);
      const p = new Policy(w);
      const ref = referenceNet(w);
      const out = new Float64Array(12);
      for (const x of seq) {
        p.step(Float64Array.from(x), out);
        const r = ref(x);
        for (let i = 0; i < 12; i++) expect(relClose(out[i]!, r[i]!, 1e-12)).toBe(true);
      }
    }), { numRuns: 100 });
  });
});

describe('Feature: stagger-app, Property 12: Policy output is finite', () => {
  it('returns 12 finite values for finite inputs in [-10, 10]', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 2 ** 31 - 1 }), obsArb, (seed, x) => {
      const out = new Float64Array(12);
      new Policy(randomWeights(seed, 1)).step(Float64Array.from(x), out);
      expect(out.every(Number.isFinite)).toBe(true);
    }), { numRuns: 100 });
  });
});

describe('Feature: stagger-app, Property 13: Policy is deterministic and reset restores the initial state', () => {
  it('gives bit-identical outputs for two instances and for one instance across a reset', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 2 ** 31 - 1 }), fc.array(obsArb, { minLength: 1, maxLength: 5 }), (seed, seq) => {
      const w = randomWeights(seed);
      const run = (p: Policy): number[] => seq.flatMap((x) => { const o = new Float64Array(12); p.step(Float64Array.from(x), o); return Array.from(o); });
      const a = new Policy(w), b = new Policy(w);
      const ra = run(a);
      expect(run(b)).toEqual(ra);
      a.reset();
      expect(a.h.every((v) => v === 0) && a.c.every((v) => v === 0)).toBe(true);
      expect(run(a)).toEqual(ra);
    }), { numRuns: 100 });
  });
});

const finite = fc.double({ min: -100, max: 100, noNaN: true });
const vec = (n: number) => fc.array(finite, { minLength: n, maxLength: n });
const unitQuat = fc.tuple(fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }))
  .filter((q) => Math.hypot(...q) > 0.1).map((q) => { const n = Math.hypot(...q); return q.map((v) => v / n) as [number, number, number, number]; });

describe('Feature: stagger-app, Property 14: Observation layout', () => {
  it('writes every slice as the deploy script does', () => {
    fc.assert(fc.property(vec(19), vec(18), vec(3), vec(12), fc.double({ min: 0, max: 1000, noNaN: true }), (qpos, qvel, cmd, prev, t) => {
      const obs = new Float64Array(47);
      buildObservation(qpos, qvel, cmd, prev, t, obs);
      for (let i = 0; i < 3; i++) { expect(obs[i]).toBe(0.25 * qvel[3 + i]!); expect(obs[6 + i]).toBe(cmd[i]! * [2, 2, 0.25][i]!); }
      const g = new Float64Array(3); projectedGravity(qpos.slice(3, 7), g, 0);
      expect(Array.from(obs.subarray(3, 6))).toEqual(Array.from(g));
      for (let j = 0; j < 12; j++) {
        expect(obs[9 + j]).toBe(qpos[7 + j]! - DEFAULT_POSE[j]!);
        expect(obs[21 + j]).toBe(0.05 * qvel[6 + j]!);
        expect(obs[33 + j]).toBe(prev[j]!);
      }
      const ph = (t % 0.8) / 0.8;
      expect(gaitPhase(t)).toBeGreaterThanOrEqual(0);
      expect(gaitPhase(t)).toBeLessThan(1);
      expect(obs[45]).toBeCloseTo(Math.sin(2 * Math.PI * ph), 9);
      expect(obs[46]).toBeCloseTo(Math.cos(2 * Math.PI * ph), 9);
    }), { numRuns: 100 });
    expect(gaitPhase(0)).toBe(0);
  });
});

describe('Feature: stagger-app, Property 15: Projected gravity is a unit vector and is yaw invariant', () => {
  it('has norm 1 and does not change under a world-vertical rotation', () => {
    fc.assert(fc.property(unitQuat, fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }), (q, yaw) => {
      const g = new Float64Array(3); projectedGravity(q, g, 0);
      expect(Math.abs(Math.hypot(g[0]!, g[1]!, g[2]!) - 1)).toBeLessThan(1e-12);
      // q' = qz(yaw) * q
      const cw = Math.cos(yaw / 2), sz = Math.sin(yaw / 2);
      const [w, x, y, z] = q;
      const q2 = [cw * w - sz * z, cw * x - sz * y, cw * y + sz * x, cw * z + sz * w];
      const g2 = new Float64Array(3); projectedGravity(q2, g2, 0);
      for (let i = 0; i < 3; i++) expect(Math.abs(g2[i]! - g[i]!)).toBeLessThan(1e-12);
    }), { numRuns: 100 });
    const g = new Float64Array(3); projectedGravity([1, 0, 0, 0], g, 0);
    expect(Array.from(g)).toEqual([0, -0, -1]);
  });
});

describe('Feature: stagger-app, Property 16: PD law and action mapping', () => {
  it('gives target = 0.25 action + default pose and ctrl = (target - q) kp - qd kd', () => {
    fc.assert(fc.property(vec(12), vec(12), vec(12), (action, q, qd) => {
      const target = new Float64Array(12); actionToTarget(action, target);
      const ctrl = new Float64Array(12); pdTorque(target, q, qd, ctrl);
      for (let j = 0; j < 12; j++) {
        expect(target[j]).toBe(action[j]! * 0.25 + DEFAULT_POSE[j]!);
        expect(relClose(ctrl[j]!, (target[j]! - q[j]!) * KP[j]! - qd[j]! * KD[j]!, 1e-12)).toBe(true);
      }
      pdTorque(target, target, new Float64Array(12), ctrl);
      expect(Array.from(ctrl).every((v) => v === 0)).toBe(true);
    }), { numRuns: 100 });
    expect(Array.from(KP.subarray(0, 6))).toEqual([100, 100, 100, 150, 40, 40]);
    expect(Array.from(KD.subarray(0, 6))).toEqual([2, 2, 2, 4, 2, 2]);
  });
});

describe('Feature: stagger-app, Property 17: The Walker evaluates the Policy once per Control_Step and holds its target in data.ctrl', () => {
  it('runs the policy on every call after the first and leaves ctrl equal to the latest target', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 60 }), (calls) => {
      const ctx = stubCtx();
      let n = 0;
      const p = new Policy(constantWeights(0));
      const orig = p.step.bind(p);
      p.step = (o, out) => { n++; orig(o, out); out.fill(n / 100); };
      const w = new Walker(ctx, p, runtimeFor(ctx));
      for (let k = 0; k < calls; k++) {
        w.step(ctx, 0.02 * k);
        expect(n).toBe(k);
        for (let j = 0; j < 12; j++) expect(ctx.data.ctrl[j]).toBe(w.target[j]);
        if (k > 0) for (let j = 0; j < 12; j++) expect(w.previousAction[j]).toBe(k / 100);
      }
    }), { numRuns: 100 });
  });
});

describe('Feature: stagger-app, Property 31: Latency delay is a whole number of Control_Steps', () => {
  it('rounds a duration to steps of 0.02 s and clamps to [0, 25]', () => {
    fc.assert(fc.property(fc.double({ min: -1, max: 2, noNaN: true }), (d) => {
      const k = delaySteps(d);
      expect(Number.isInteger(k)).toBe(true);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(25);
      if (d >= 0 && d <= 0.49) expect(k).toBe(Math.round(d / 0.02) + 0); // + 0 turns -0 into 0
    }), { numRuns: 100 });
  });
});

describe('Feature: stagger-app, Property 32: Latency buffer returns the observation from d steps earlier', () => {
  it('returns push n - 1 - min(d, n - 1, 25)', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 80 }), fc.integer({ min: 0, max: 30 }), (n, d) => {
      const b = new LatencyBuffer();
      const r = new Float64Array(47);
      for (let i = 0; i < n; i++) { r.fill(i); b.push(r); }
      const out = new Float64Array(47);
      b.delayed(d, out);
      const k = Math.min(d, 25, n - 1);
      expect(out.every((v) => v === n - 1 - k)).toBe(true);
    }), { numRuns: 100 });
  });
});
