import fc from 'fast-check';
import { ModelCache, buildContext, compileRequirement, mulberry32, runTrial, type Trace } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import stagger, { drawJointNoise } from '../app';
import { lexicon } from '../lexicon';
import { friction, latency, payload, push, slope, command } from '../perturbations';
import { stubModelCtx } from './helpers/stubModel';

const d = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const scenarioArb = fc.record({
  force: d(0, 300), angle: d(0, 2 * Math.PI), phase: d(0, 0.999), slope: d(0, 0.35), mass: d(0, 20),
  ratio: d(0, 1), latency: d(0, 0.5), speed: d(0, 1),
});
type Sc = { force: number; angle: number; phase: number; slope: number; mass: number; ratio: number; latency: number; speed: number };

function applyAll(ctx: any, t: number, s: Sc): void {
  push.apply(ctx, t, 2, { force: s.force, duration: 0.2, angle: s.angle, phase: s.phase });
  slope.apply(ctx, t, 2, { angle: s.slope });
  payload.apply(ctx, t, 2, { mass: s.mass });
  friction.apply(ctx, t, 2, { ratio: s.ratio });
  latency.apply(ctx, t, 2, { duration: s.latency });
  command.apply(ctx, t, 2, { speed: s.speed });
}

const bytes = (a: Float64Array) => Array.from(new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)));
const snapshot = (model: any) => ({
  gravity: bytes(model.opt.gravity), mass: bytes(model.body_mass), inertia: bytes(model.body_inertia), friction: bytes(model.geom_friction),
});
const autoresetStub = (ctx: any) => { ctx.mj.mjtDisableBit = { mjDSBL_AUTORESET: { value: 1 << 15 } }; ctx.model.opt.disableflags = 1 << 15; ctx.data.qpos = new Float64Array(19); };

describe('Feature: stagger-app, Property 30: Trials leave the cached model unchanged', () => {
  it('restores gravity, mass, inertia and friction byte for byte on endTrial (stub model)', () => {
    fc.assert(fc.property(scenarioArb, (s) => {
      const { ctx } = stubModelCtx();
      autoresetStub(ctx);
      const before = snapshot(ctx.model);
      stagger.initState!(ctx, mulberry32(1));
      for (let k = 0; k < 5; k++) applyAll(ctx, 2 + 0.002 * k, s);
      stagger.endTrial!(ctx);
      expect(snapshot(ctx.model)).toEqual(before);
    }), { numRuns: 100 });
  });

  it('restores an aborted trial in the next initState (stub model)', () => {
    fc.assert(fc.property(scenarioArb, (s) => {
      const { ctx } = stubModelCtx();
      autoresetStub(ctx);
      const before = snapshot(ctx.model);
      stagger.initState!(ctx, mulberry32(1));
      applyAll(ctx, 2, s);
      // no endTrial: the next trial gets a new ctx on the same model
      const next = { ...ctx, data: { ...ctx.data, qpos: new Float64Array(19), qvel: new Float64Array(18) } };
      stagger.initState!(next, mulberry32(2));
      expect(snapshot(ctx.model)).toEqual(before);
    }), { numRuns: 100 });
  });

  describe('on the real model', () => {
    const cache = new ModelCache();
    afterAll(() => cache.dispose());
    it('restores the model after perturbed steps, with and without endTrial', async () => {
      const { mj, model } = await cache.getModel(stagger);
      const before = snapshot(model);
      await fc.assert(fc.asyncProperty(scenarioArb, fc.boolean(), async (s, abort) => {
        const data = new mj.MjData(model);
        try {
          const ctx = buildContext(mj, model, data, stagger.names);
          stagger.initState!(ctx, mulberry32(3));
          const w = stagger.makeController(ctx, mulberry32(3));
          for (let k = 0; k < 10; k++) {
            w.step(ctx, 0.02 * k);
            for (let j = 0; j < 10; j++) { data.xfrc_applied.fill(0); applyAll(ctx, 2 + 0.02 * k + 0.002 * j, s); mj.mj_step(model, data); }
          }
          if (!abort) stagger.endTrial!(ctx);
          else {
            const d2 = new mj.MjData(model);
            try { stagger.initState!(buildContext(mj, model, d2, stagger.names), mulberry32(4)); } finally { d2.delete(); }
          }
        } finally { data.delete(); }
        expect(snapshot(model)).toEqual(before);
      }), { numRuns: 8 });
    });
  });
});

describe('Feature: stagger-app, Property 33: initState noise is deterministic and in fixed order', () => {
  it('draws 12 values per call, in joint order, equal for equal seeds', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
      const runOnce = () => {
        const { ctx } = stubModelCtx();
        autoresetStub(ctx);
        (ctx.data as any).qvel = new Float64Array(18);
        let draws = 0;
        const r = mulberry32(seed);
        stagger.initState!(ctx, () => { draws++; return r(); });
        return { qpos: Array.from((ctx.data as any).qpos as Float64Array), draws };
      };
      const a = runOnce(), b = runOnce();
      expect(a.draws).toBe(12);
      expect(b).toEqual(a);
      const noise = drawJointNoise(mulberry32(seed));
      expect(a.qpos.slice(0, 7)).toEqual([0, 0, 0.793, 1, 0, 0, 0]);
      for (let j = 0; j < 12; j++) expect(a.qpos[7 + j]! - [-0.1, 0, 0, 0.3, -0.2, 0][j % 6]!).toBeCloseTo(noise[j]!, 15);
    }), { numRuns: 100 });
  });
});

describe('Feature: stagger-app, Property 34: A trial is a deterministic function of scenario and seed', () => {
  const cache = new ModelCache();
  afterAll(() => cache.dispose());
  const req = compileRequirement(
    'R1. WHEN the pelvis is pushed with up to 300 N for 0.2 s from 90 deg at any point in its stride THE robot SHALL stay upright for 1.5 s',
    lexicon,
  ).requirement!;

  async function trial(force: number, phase: number, seed: number) {
    let copy: Record<string, number[]> = {};
    const res = await runTrial(stagger, req, { app: 'stagger', reqId: 'R1', seed, scenario: { 'push.force': force, 'push.angle': Math.PI / 2, 'push.phase': phase }, record: 'poses' }, {
      cache,
      earlyStop: (t: Trace, n: number) => {
        copy = Object.fromEntries(Object.entries(t.signals).map(([k, v]) => [k, Array.from(v.subarray(0, n))]));
        return undefined;
      },
    });
    return { res, copy };
  }

  it('gives bit-identical traces, poses and robustness for the same scenario and seed', async () => {
    expect(req.horizon).toBeLessThanOrEqual(2);
    await fc.assert(fc.asyncProperty(d(0, 300), d(0, 0.999), fc.integer({ min: 0, max: 0xffffffff }), async (f, ph, seed) => {
      const a = await trial(f, ph, seed);
      const b = await trial(f, ph, seed);
      expect(Object.is(a.res.robustness, b.res.robustness)).toBe(true);
      expect(b.copy).toEqual(a.copy);
      expect(Array.from(b.res.poses!.frames)).toEqual(Array.from(a.res.poses!.frames));
    }), { numRuns: 5 });
  });

  it('changes only the initial joint noise when only the seed changes', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 0xffffffff }), fc.integer({ min: 0, max: 0xffffffff }), (s1, s2) => {
      fc.pre(s1 !== s2);
      const st = (seed: number) => {
        const { ctx } = stubModelCtx();
        autoresetStub(ctx);
        (ctx.data as any).qvel = new Float64Array(18);
        stagger.initState!(ctx, mulberry32(seed));
        return Array.from((ctx.data as any).qpos as Float64Array);
      };
      const a = st(s1), b = st(s2);
      expect(a.slice(0, 7)).toEqual(b.slice(0, 7));
      expect(a.slice(7)).not.toEqual(b.slice(7));
    }), { numRuns: 100 });
  });
});
