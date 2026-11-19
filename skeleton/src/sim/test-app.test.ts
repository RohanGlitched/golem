import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildContext } from './context.js';
import { ModelCache } from './model-cache.js';
import { mulberry32 } from './prng.js';
import { makeAlwaysHook, makeEventuallyHook, makePushTemplate, makeTestRequirement, testApp } from './test-app.js';
import type { Mj, SimContext } from './types.js';

let cache: ModelCache;
let mj: Mj;
let model: any;
let compileMs = 0;

beforeAll(async () => {
  cache = new ModelCache();
  const t0 = performance.now();
  ({ mj, model } = await cache.getModel(testApp));
  compileMs = performance.now() - t0;
});
afterAll(() => cache.dispose());

function newCtx(): { ctx: SimContext; data: any } {
  const data = new (mj as any).MjData(model);
  return { ctx: buildContext(mj, model, data, testApp.names), data };
}

describe('testApp', () => {
  it('loads, writes and compiles in 2 s or less (CI budget)', () => {
    expect(compileMs).toBeLessThanOrEqual(2000);
  });
  it('has exactly one file, scene.xml', async () => {
    expect(Object.keys(await testApp.files())).toEqual(['scene.xml']);
  });
  it('declares the documented timings and the model timestep equals simDt', () => {
    expect([testApp.simDt, testApp.controlDt, testApp.warmup]).toEqual([0.002, 0.02, 0.2]);
    expect(model.opt.timestep).toBe(testApp.simDt);
  });
  it('contains box with a free joint, bob, hinge and drive', () => {
    const { ctx, data } = newCtx();
    expect(Object.keys(ctx.ids).sort()).toEqual(['actuator:drive', 'body:bob', 'body:box', 'joint:hinge']);
    const boxJoint = (mj as any).mj_name2id(model, (mj as any).mjtObj.mjOBJ_JOINT.value, 'box_free');
    expect(boxJoint).toBeGreaterThanOrEqual(0);
    expect(model.jnt_type[boxJoint]).toBe(0); // mjJNT_FREE
    data.delete();
  });
  it('gives finite signals without a perturbation', () => {
    const { ctx, data } = newCtx();
    const out: Record<string, number> = {};
    testApp.initState!(ctx, mulberry32(1));
    const ctl = testApp.makeController(ctx, mulberry32(1));
    for (let i = 0; i < 10; i++) { ctl.step(ctx, 0); for (let j = 0; j < 10; j++) (mj as any).mj_step(model, data); }
    testApp.signals(ctx, out);
    expect(Object.keys(out)).toEqual(['box.z', 'bob.angle', 'bob.speed']);
    for (const v of Object.values(out)) expect(Number.isFinite(v)).toBe(true);
    data.delete();
  });
  it('clamps the PD torque to the ctrlrange', () => {
    const { ctx, data } = newCtx();
    const ctl = testApp.makeController(ctx, mulberry32(1));
    const adr = model.jnt_qposadr[ctx.ids['joint:hinge'] as number];
    data.qpos[adr] = 100;
    ctl.step(ctx, 0);
    expect(data.ctrl[0]).toBe(-5);
    data.qpos[adr] = -100;
    ctl.step(ctx, 0);
    expect(data.ctrl[0]).toBe(5);
    data.delete();
  });
  it('draws the PRNG exactly once in initState and stays within 0.1 rad', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { ctx, data } = newCtx();
      let draws = 0;
      const rng = mulberry32(seed);
      testApp.initState!(ctx, () => { draws++; return rng(); });
      const adr = model.jnt_qposadr[ctx.ids['joint:hinge'] as number];
      expect(draws).toBe(1);
      expect(Math.abs(data.qpos[adr])).toBeLessThanOrEqual(0.1);
      data.delete();
    }
  });
  it('reads only angle and speed in the controller (same torque whatever else changes)', () => {
    const { ctx, data } = newCtx();
    const ctl = testApp.makeController(ctx, mulberry32(1));
    ctl.step(ctx, 0);
    const a = data.ctrl[0];
    data.qpos[0] = 5; // box x
    ctl.step(ctx, 1);
    expect(data.ctrl[0]).toBe(a);
    data.delete();
  });
});

describe('push template', () => {
  const push = makePushTemplate();
  const values = { force: 10, duration: 0.2, angle: 0 };
  it('is zero outside [tTrigger, tTrigger + duration) and non-zero inside', () => {
    const { ctx, data } = newCtx();
    const bob = ctx.ids['body:bob'] as number;
    for (const [t, expectPush] of [[0.19, false], [0.2, true], [0.399, true], [0.4, false], [1, false]] as const) {
      data.xfrc_applied.fill(0);
      push.apply(ctx, t, 0.2, values);
      expect(data.xfrc_applied[6 * bob] !== 0).toBe(expectPush);
    }
    data.delete();
  });
  it('writes nothing for a 0 N push', () => {
    const { ctx, data } = newCtx();
    push.apply(ctx, 0.3, 0.2, { ...values, force: 0 });
    expect(Array.from(data.xfrc_applied as Float64Array).every((v) => v === 0)).toBe(true);
    data.delete();
  });
  it('takes its force range from the slot', () => {
    const dims = push.dims!(
      { force: [{ kind: 'force', si: 0, text: '0 N' }, { kind: 'force', si: 150, text: '150 N' }] },
      { force: { kind: 'force', min: 0, max: 150, wrap: false } },
    );
    expect(dims.map((d) => [d.name, d.min, d.max])).toEqual([['push.force', 0, 150], ['push.angle', 0, 2 * Math.PI]]);
  });
});

describe('makeTestRequirement', () => {
  const trace = (angle: number[]) => ({
    t: Float64Array.from(angle.map((_, i) => 0.2 + 0.02 * i)),
    signals: { 'bob.angle': Float64Array.from(angle), 'bob.speed': Float64Array.from(angle) },
    events: [],
  });
  it('always monitor gives bound minus the largest absolute angle', () => {
    const req = makeTestRequirement({ horizon: 1, bound: 0.3 });
    const r = req.monitor(trace([0.1, -0.25, 0.2]));
    expect(r.robustness).toBeCloseTo(0.05, 12);
    expect(r.worstAt).toBeCloseTo(0.22, 12);
  });
  it('hooks decide only in the direction that cannot reverse', () => {
    const always = makeAlwaysHook(makeTestRequirement({ horizon: 1, bound: 0.3 }));
    expect(always(trace([0.1, 0.2]), 2)).toBeUndefined();
    expect(always(trace([0.1, 0.4]), 2)).toBeCloseTo(-0.1, 12);
    const ev = makeEventuallyHook(makeTestRequirement({ horizon: 1, kind: 'eventually-bob-slow', bound: 0.5 }));
    expect(ev(trace([2, 3]), 2)).toBeUndefined();
    expect(ev(trace([2, 0.1]), 2)).toBeCloseTo(0.4, 12);
  });
});
