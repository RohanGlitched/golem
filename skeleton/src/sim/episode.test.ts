import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTrial } from './episode.js';
import { SimError } from './errors.js';
import { liveHandleCount } from './handles.js';
import { ModelCache } from './model-cache.js';
import { makeTestRequirement, pushCall, testApp } from './test-app.js';
import type { SpyEntry } from './test-fixtures.js';
import { withNaNControl, withSpyTemplate, withThrowingController, withThrowingSignals } from './test-fixtures.js';
import type { CompiledRequirement, RobotApp, Trace, TrialSpec } from './types.js';

export const cache = new ModelCache();
beforeAll(async () => { await cache.getModel(testApp); });
afterAll(() => cache.dispose());

const spec = (over: Partial<TrialSpec> = {}): TrialSpec => ({
  app: 'test', reqId: 'R1', scenario: { 'push.force': 10, 'push.angle': 1 }, seed: 7, ...over,
});
const run = (app: RobotApp, req: CompiledRequirement, s: TrialSpec = spec(), earlyStop?: any) =>
  runTrial(app, req, s, { cache, ...(earlyStop ? { earlyStop } : {}) });

/** Wraps a requirement so the trace its monitor receives is captured. */
function capture(req: CompiledRequirement): { req: CompiledRequirement; traces: Trace[] } {
  const traces: Trace[] = [];
  return { traces, req: { ...req, monitor: (tr) => { traces.push(tr); return req.monitor(tr); } } };
}
const spyCall = (name: string) => ({ template: name, params: {} });
const withSpy = (log: SpyEntry[], extra: RobotApp = testApp) => withSpyTemplate(extra, log);

describe('runTrial setup and warm-up', () => {
  it('calls initState then makeController once each with the same rng', async () => {
    const calls: string[] = [];
    const rngs: unknown[] = [];
    const app: RobotApp = {
      ...testApp,
      initState: (ctx, rng) => { calls.push('init'); rngs.push(rng); testApp.initState!(ctx, rng); },
      makeController: (ctx, rng) => { calls.push('make'); rngs.push(rng); return testApp.makeController(ctx, rng); },
    };
    await run(app, makeTestRequirement({ horizon: 0.2 }));
    expect(calls).toEqual(['init', 'make']);
    expect(rngs[0]).toBe(rngs[1]);
  });
  it('runs round(warmup/controlDt) controller steps and 100 sim steps before the first perturbation call', async () => {
    const log: SpyEntry[] = [];
    let steps = 0;
    const counting: RobotApp = {
      ...testApp,
      makeController: (ctx, rng) => {
        const inner = testApp.makeController(ctx, rng);
        return { step: (c, t) => { steps++; inner.step(c, t); } };
      },
    };
    const app = withSpy(log, counting);
    let stepsAtFirstApply = -1;
    let timeAtFirstApply = -1;
    app.lexicon.perturbations[1]!.apply = ((orig) => (ctx: any, t: number, tt: number, v: any) => {
      if (stepsAtFirstApply < 0) { stepsAtFirstApply = steps; timeAtFirstApply = ctx.data.time; }
      orig(ctx, t, tt, v);
    })(app.lexicon.perturbations[1]!.apply);
    await run(app, makeTestRequirement({ horizon: 0.2, perturbations: [spyCall('spy')] }));
    // 10 warm-up control steps, plus the first active control step's own controller.step.
    expect(stepsAtFirstApply).toBe(10 + 1);
    expect(timeAtFirstApply).toBeCloseTo(0.2, 12);
    expect(log[0]!.t).toBe(100 * 0.002);
  });
  it('makes no perturbation call and writes no xfrc during warm-up', async () => {
    const log: SpyEntry[] = [];
    await run(withSpy(log), makeTestRequirement({ horizon: 0.2, perturbations: [spyCall('spy')] }));
    expect(log.every((e) => e.t >= 0.2 - 1e-12)).toBe(true);
    expect(log.every((e) => e.xfrc.every((x) => x === 0))).toBe(true);
  });
  it('leaves the handle counter unchanged when initState throws', async () => {
    const before = liveHandleCount();
    const app: RobotApp = { ...testApp, initState: () => { throw new Error('init broke'); } };
    await expect(run(app, makeTestRequirement({ horizon: 0.2 }))).rejects.toThrow(/init broke/);
    expect(liveHandleCount()).toBe(before);
  });
  it('leaves the handle counter unchanged when makeController throws', async () => {
    const before = liveHandleCount();
    const app: RobotApp = { ...testApp, makeController: () => { throw new Error('make broke'); } };
    await expect(run(app, makeTestRequirement({ horizon: 0.2 }))).rejects.toThrow(/make broke/);
    expect(liveHandleCount()).toBe(before);
  });
  it('creates no MjData and no model for a validation error', async () => {
    const fresh = new ModelCache();
    const before = liveHandleCount();
    await expect(runTrial(testApp, makeTestRequirement({ horizon: 0.2 }), spec({ seed: -1 }), { cache: fresh })).rejects.toThrow(/Seed/);
    expect(liveHandleCount()).toBe(before);
    expect(fresh.size).toBe(0);
  });
  it('puts app id, requirement id, seed and cause in an error', async () => {
    const cause = new Error('make broke');
    const app: RobotApp = { ...testApp, makeController: () => { throw cause; } };
    const err: any = await run(app, makeTestRequirement({ horizon: 0.2, id: 'R9' }), spec({ seed: 4242 })).catch((e) => e);
    expect(err).toBeInstanceOf(SimError);
    expect(err.message).toBe('Trial failed (app test, requirement R9, seed 4242): make broke');
    expect(err.cause).toBe(cause);
  });
  it('rejects an unknown declared name and deletes MjData', async () => {
    const before = liveHandleCount();
    const app: RobotApp = { ...testApp, names: { body: ['ghost'] } };
    await expect(run(app, makeTestRequirement({ horizon: 0.2 }))).rejects.toThrow(/body named "ghost"/);
    expect(liveHandleCount()).toBe(before);
  });
});

describe('runTrial trigger, perturbations, sampling and result', () => {
  it('puts the trigger event at the warm-up time, also with no perturbations', async () => {
    const c = capture(makeTestRequirement({ horizon: 0.2, perturbations: [] }));
    await run(testApp, c.req);
    expect(c.traces[0]!.events).toEqual([{ name: 'trigger', t: 0.2 }]);
  });
  it('starts the trace at the warm-up time with round(horizon/controlDt)+1 samples', async () => {
    const c = capture(makeTestRequirement({ horizon: 0.5 }));
    await run(testApp, c.req);
    const tr = c.traces[0]!;
    expect(tr.t.length).toBe(26);
    expect(tr.t[0]).toBe(0.2);
    expect(tr.t[25]).toBe(0.2 + 25 * 0.02);
    expect(Object.keys(tr.signals)).toEqual(['box.z', 'bob.angle', 'bob.speed']);
  });
  it('keeps ctrl bit-identical across the sim steps of a control step and calls signals once before them', async () => {
    const log: SpyEntry[] = [];
    const ctrls: number[] = [];
    let signalsCalls = 0;
    const base = withSpy(log);
    const app: RobotApp = {
      ...base,
      signals: (ctx, out) => { signalsCalls++; base.signals(ctx, out); },
    };
    const callCounts: number[] = [];
    const orig = app.lexicon.perturbations[1]!.apply;
    app.lexicon.perturbations[1]!.apply = (ctx, t, tt, v) => {
      ctrls.push(ctx.data.ctrl[0]); callCounts.push(signalsCalls); orig(ctx, t, tt, v);
    };
    await run(app, makeTestRequirement({ horizon: 0.2, perturbations: [spyCall('spy')] }));
    expect(ctrls).toHaveLength(100);
    for (let c = 0; c < 10; c++) {
      const group = ctrls.slice(c * 10, c * 10 + 10);
      expect(group.every((x) => Object.is(x, group[0]))).toBe(true);
      expect(callCounts.slice(c * 10, c * 10 + 10).every((x) => x === c + 1)).toBe(true);
    }
    expect(signalsCalls).toBe(11);
  });
  it('stores non-finite signal values unchanged', async () => {
    const app: RobotApp = { ...testApp, signals: (ctx, out) => { testApp.signals(ctx, out); out['bob.angle'] = NaN; } };
    const c = capture(makeTestRequirement({ horizon: 0.1, kind: 'eventually-bob-slow' }));
    await run(app, c.req);
    expect(Array.from(c.traces[0]!.signals['bob.angle']!).every(Number.isNaN)).toBe(true);
  });
  it.each([
    ['apply', (a: RobotApp) => { a.lexicon.perturbations[0]!.apply = () => { throw new Error('apply broke'); }; return a; }, /apply broke/],
    ['signals', (a: RobotApp) => withThrowingSignals(a, 3), /signals failed/],
    ['controller', (a: RobotApp) => withThrowingController(a, 15), /controller failed/],
  ])('rejects with the cause and leaks no handle when %s throws', async (_n, wrap, re) => {
    const app = wrap({ ...testApp, lexicon: { ...testApp.lexicon, perturbations: [{ ...testApp.lexicon.perturbations[0]! }] } });
    const before = liveHandleCount();
    await expect(run(app, makeTestRequirement({ horizon: 0.4 }))).rejects.toThrow(re);
    expect(liveHandleCount()).toBe(before);
  });
  it('rejects with the cause and leaks no handle when the monitor throws', async () => {
    const before = liveHandleCount();
    const req = { ...makeTestRequirement({ horizon: 0.2 }), monitor: () => { throw new Error('monitor broke'); } };
    await expect(run(testApp, req)).rejects.toThrow(/monitor broke/);
    expect(liveHandleCount()).toBe(before);
  });
  it('returns the input spec object and a finite wallMs', async () => {
    const s = spec();
    const r = await run(testApp, makeTestRequirement({ horizon: 0.2 }), s);
    expect(r.spec).toBe(s);
    expect(Number.isFinite(r.wallMs) && r.wallMs >= 0).toBe(true);
    expect(r.unit).toBe('rad');
    expect(r.poses).toBeUndefined();
  });
  it('applies the push only from the trigger for its duration', async () => {
    const quiet = await run(testApp, makeTestRequirement({ horizon: 0.6 }), spec({ scenario: { 'push.force': 0, 'push.angle': 0 } }));
    const pushed = await run(testApp, makeTestRequirement({ horizon: 0.6 }), spec({ scenario: { 'push.force': 20, 'push.angle': 0 } }));
    expect(pushed.robustness).toBeLessThan(quiet.robustness);
    expect(pushCall().params).toMatchObject({ duration: 0.2 });
  });
});

describe('runTrial early stop, divergence and poses', () => {
  const req = () => makeTestRequirement({ horizon: 1 });
  it.each([[NaN], ['x'], [{}], [Infinity], [null]])('rejects a hook that returns %s and deletes MjData', async (bad) => {
    const before = liveHandleCount();
    await expect(run(testApp, req(), spec(), () => bad)).rejects.toThrow(/Early-stop hook returned/);
    expect(liveHandleCount()).toBe(before);
  });
  it('rejects a throwing hook without calling the monitor', async () => {
    const c = capture(req());
    await expect(run(testApp, c.req, spec(), () => { throw new Error('hook broke'); })).rejects.toThrow(/hook broke/);
    expect(c.traces).toHaveLength(0);
  });
  it('ends the trial at the sample where the hook decides, with no further sim step', async () => {
    const c = capture(req());
    let calls = 0;
    await run(testApp, c.req, spec(), (_t: Trace, n: number) => { calls++; return n === 4 ? -1 : undefined; });
    expect(c.traces).toHaveLength(1);
    expect(c.traces[0]!.t.length).toBe(4);
    expect(calls).toBe(4);
  });
  it('lets a decided value at the final sample end the trial there', async () => {
    const c = capture(makeTestRequirement({ horizon: 0.2 }));
    await run(testApp, c.req, spec(), (_t: Trace, n: number) => (n === 11 ? 1 : undefined));
    expect(c.traces[0]!.t.length).toBe(11);
  });
  it('reports divergence: -Infinity, worstAt = divergence time, one diverged event, prefix trace', async () => {
    const c = capture(req());
    const r = await run(withNaNControl(testApp, 12), c.req);
    const tr = c.traces[0]!;
    expect(r.robustness).toBe(-Infinity);
    expect(tr.events.map((e) => e.name)).toEqual(['trigger', 'diverged']);
    expect(r.worstAt).toBe(tr.events[1]!.t);
    expect(r.worstAt).toBeCloseTo((100 + 20 + 1) * 0.002, 12);
    expect(tr.t.length).toBe(3);
  });
  it('restores model flags changed by an app after a diverged trial', async () => {
    const { model } = await cache.getModel(testApp);
    const before = model.opt.disableflags;
    await run(withNaNControl(testApp, 12), req());
    expect(model.opt.disableflags).toBe(before);
  });
  it('records poses only when asked, with the right frame count', async () => {
    const none = await run(testApp, req(), spec({ record: 'none' }));
    expect(none.poses).toBeUndefined();
    const rec = await run(testApp, req(), spec({ record: 'poses' }));
    const p = rec.poses!;
    expect(p.fps).toBe(30);
    expect(p.nbody).toBe(3);
    expect(p.frames.length % (3 * 7)).toBe(0);
    // 1 s at 50 Hz sampling, frames at least 1/30 s apart: every 2nd sample, so 26 frames.
    expect(p.frames.length / 21).toBe(26);
  });
});

