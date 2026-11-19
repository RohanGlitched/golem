// Runner properties (Test_App, at most 2 s simulated per trial, 25 cases each, fixed logged seed).
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTrial } from './episode.js';
import { SimError } from './errors.js';
import { liveHandleCount } from './handles.js';
import { ModelCache } from './model-cache.js';
import {
  makeAlwaysHook, makeEventuallyHook, makeTestRequirement, pushCall, testApp, type TestRequirement,
} from './test-app.js';
import {
  type SpyEntry, withModelAlteringTemplate, withNaNControl, withNoDraws, withSpyTemplate,
  withThrowingController, withThrowingSignals,
} from './test-fixtures.js';
import { PHYSICS_RUNS, PURE_RUNS, SEED, describeTrial } from './test-support.js';
import type { CompiledRequirement, EarlyStopHook, RobotApp, Trace, TrialResult, TrialSpec } from './types.js';
import { normaliseScenario } from './validate.js';

const cache = new ModelCache();
let model: any;
beforeAll(async () => { ({ model } = await cache.getModel(testApp)); });
afterAll(() => cache.dispose());

const cfg = { numRuns: PHYSICS_RUNS, seed: SEED, verbose: true as const };

// ---------------------------------------------------------------- helpers

const copyTrace = (t: Trace): Trace => ({
  t: t.t.slice(),
  signals: Object.fromEntries(Object.entries(t.signals).map(([k, v]) => [k, v.slice()])),
  events: t.events.map((e) => ({ ...e })),
});
const bytesEq = (a: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number },
  b: typeof a): boolean =>
  a.byteLength === b.byteLength
  && Buffer.compare(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), new Uint8Array(b.buffer, b.byteOffset, b.byteLength)) === 0;
const traceEq = (a: Trace, b: Trace): boolean => {
  const ka = Object.keys(a.signals), kb = Object.keys(b.signals);
  return bytesEq(a.t, b.t) && ka.join() === kb.join() && ka.every((k) => bytesEq(a.signals[k]!, b.signals[k]!))
    && a.events.length === b.events.length
    && a.events.every((e, i) => e.name === b.events[i]!.name && Object.is(e.t, b.events[i]!.t));
};

interface Captured { result: TrialResult; trace: Trace }
async function runCaptured(
  app: RobotApp, req: CompiledRequirement, spec: TrialSpec, earlyStop?: EarlyStopHook, c: ModelCache = cache,
): Promise<Captured> {
  let trace: Trace | undefined;
  const wrapped = { ...req, monitor: (t: Trace) => { trace = copyTrace(t); return req.monitor(t); } };
  const result = await runTrial(app, wrapped, spec, { cache: c, ...(earlyStop ? { earlyStop } : {}) });
  return { result, trace: trace as Trace };
}

const mkSpec = (scenario: Record<string, number>, seed: number, record?: 'none' | 'poses', reqId = 'R1'): TrialSpec => ({
  app: 'test', reqId, scenario, seed, ...(record ? { record } : {}),
});

const arbScenario = fc.record({
  'push.force': fc.double({ min: 0, max: 20, noNaN: true }),
  'push.angle': fc.double({ min: -20, max: 20, noNaN: true }),
});
const arbSeed = fc.integer({ min: 0, max: 4294967295 });
const arbRecord = fc.constantFrom<'none' | 'poses' | undefined>('none', 'poses', undefined);
/** Horizon in control steps of 0.02 s (0.2 s .. maxSteps * 0.02 s). */
const arbSteps = (max: number) => fc.integer({ min: 10, max });
const horizonOf = (steps: number) => steps * 0.02;
const reqFor = (steps: number, over: Parameters<typeof makeTestRequirement>[0] extends infer O ? Partial<O> : never = {}) =>
  makeTestRequirement({ horizon: horizonOf(steps), ...over });

const FULL = 'always-bob-angle' as const;
void FULL;

// ---------------------------------------------------------------- properties 1 to 5

describe('runTrial properties', () => {
  // Feature: golem-sim, Property 1: Determinism
  it('Property 1: the same TrialSpec gives bit-identical results, whatever ran in between', async () => {
    await fc.assert(fc.asyncProperty(arbScenario, arbSeed, arbSeed, arbRecord, arbSteps(40), async (sc, seed, other, rec, steps) => {
      const req = reqFor(steps);
      const spec = mkSpec(sc, seed, rec);
      const a = await runCaptured(testApp, req, spec);
      await runCaptured(testApp, reqFor(15, { kind: 'eventually-bob-slow', id: 'R2' }), mkSpec({ 'push.force': 20, 'push.angle': 1 }, other, 'poses', 'R2'));
      const b = await runCaptured(testApp, req, spec);
      const posesSame = (a.result.poses === undefined) === (b.result.poses === undefined)
        && (a.result.poses === undefined || bytesEq(a.result.poses.frames, b.result.poses!.frames));
      return traceEq(a.trace, b.trace) && Object.is(a.result.robustness, b.result.robustness)
        && Object.is(a.result.worstAt, b.result.worstAt) && a.result.unit === b.result.unit && posesSame;
    }), cfg);
  });

  // Feature: golem-sim, Property 2: Trace length
  it('Property 2: a full trial has round(horizon/controlDt)+1 samples in every array', async () => {
    await fc.assert(fc.asyncProperty(arbScenario, arbSeed, arbSteps(75), async (sc, seed, steps) => {
      const { trace } = await runCaptured(testApp, reqFor(steps), mkSpec(sc, seed));
      return trace.t.length === steps + 1 && Object.values(trace.signals).every((s) => s.length === trace.t.length);
    }), cfg);
  });

  // Feature: golem-sim, Property 3: Time axis is exact
  it('Property 3: t[k] is bit-identical to warmup + k * controlDt for any valid timing', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 10 }), fc.integer({ min: 2, max: 30 }), arbSeed,
      async (m, w, steps, seed) => {
        const controlDt = 0.002 * m;
        const app: RobotApp = { ...testApp, controlDt, warmup: controlDt * w };
        const req = makeTestRequirement({ horizon: controlDt * steps });
        const { trace } = await runCaptured(app, req, mkSpec({ 'push.force': 5, 'push.angle': 0 }, seed));
        if (trace.t.length !== steps + 1 || trace.t[0] !== app.warmup) return false;
        for (let k = 0; k < trace.t.length; k++) if (trace.t[k] !== app.warmup + k * controlDt) return false;
        return true;
      }), cfg);
  });

  // Feature: golem-sim, Property 4: Trigger event
  it('Property 4: exactly one trigger event at the warm-up time, whatever way the trial ends', async () => {
    await fc.assert(fc.asyncProperty(
      arbScenario, arbSeed, arbSteps(30), fc.constantFrom('normal', 'early', 'diverge', 'empty'), fc.integer({ min: 0, max: 8 }),
      async (sc, seed, steps, mode, j) => {
        let app = testApp;
        let req: TestRequirement = reqFor(steps);
        let hook: EarlyStopHook | undefined;
        if (mode === 'early') hook = (_t, n) => (n === j + 1 ? 1 : undefined);
        if (mode === 'diverge') app = withNaNControl(testApp, 10 + j);
        if (mode === 'empty') req = reqFor(steps, { perturbations: [] });
        const { trace } = await runCaptured(app, req, mkSpec(sc, seed), hook);
        const trig = trace.events.filter((e) => e.name === 'trigger');
        const divIdx = trace.events.findIndex((e) => e.name === 'diverged');
        return trig.length === 1 && trig[0]!.t === 0.2 && trace.events[0]!.name === 'trigger'
          && (mode !== 'diverge' || divIdx === 1);
      }), cfg);
  });

  // Feature: golem-sim, Property 5: Warm-up isolation and step counts
  it('Property 5: warm-up has no perturbation call, no xfrc and the exact step counts', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 10 }), arbScenario, arbSeed,
      async (m, w, sc, seed) => {
        const controlDt = 0.002 * m;
        const base: RobotApp = { ...testApp, controlDt, warmup: controlDt * w };
        let steps = 0;
        const withCount: RobotApp = {
          ...base,
          makeController: (ctx, rng) => {
            const inner = base.makeController(ctx, rng);
            return { step: (c, t) => { steps++; inner.step(c, t); } };
          },
        };
        const log: SpyEntry[] = [];
        let stepsAtFirst = -1;
        const app = withSpyTemplate(withCount, log);
        const spy = app.lexicon.perturbations[1]!;
        const orig = spy.apply;
        spy.apply = (c, t, tt, v) => { if (stepsAtFirst < 0) stepsAtFirst = steps; orig(c, t, tt, v); };
        const req = makeTestRequirement({ horizon: controlDt * 5, perturbations: [{ template: 'spy', params: {} }, pushCall()] });
        await runTrial(app, req, mkSpec(sc, seed), { cache });
        const warmSteps = Math.round(base.warmup / 0.002);
        return log.length === 5 * m && stepsAtFirst === w + 1
          && Math.abs(log[0]!.simTime - warmSteps * 0.002) < 1e-9 && log.every((e) => e.simTime >= base.warmup - 1e-9)
          && log[0]!.xfrc.every((x) => x === 0);
      }), cfg);
  });

  // Feature: golem-sim, Property 6: Early stop is sound
  it('Property 6: an early-stopped trial has the same verdict sign and no further sim step', async () => {
    await fc.assert(fc.asyncProperty(
      arbScenario, arbSeed, arbSteps(40), fc.boolean(), fc.double({ min: 0.02, max: 1, noNaN: true }),
      async (sc, seed, steps, always, boundRaw) => {
        const req = reqFor(steps, always
          ? { kind: 'always-bob-angle', bound: boundRaw * 0.5 }
          : { kind: 'eventually-bob-slow', bound: boundRaw * 3 });
        const base = always ? makeAlwaysHook(req) : makeEventuallyHook(req);
        let calls = 0;
        let decided: number | undefined;
        let decidedCalls = -1;
        const hook: EarlyStopHook = (t, n) => { calls++; const r = base(t, n); if (r !== undefined && decided === undefined) { decided = r; decidedCalls = calls; } return r; };
        const spec = mkSpec(sc, seed);
        const full = await runCaptured(testApp, req, spec);
        const hooked = await runCaptured(testApp, req, spec, hook);
        if (decided === undefined) {
          return calls === steps + 1 && Object.is(hooked.result.robustness, full.result.robustness);
        }
        const v = decided;
        const sameSign = Math.sign(hooked.result.robustness) === Math.sign(full.result.robustness);
        const bounded = always
          ? hooked.result.robustness <= v && full.result.robustness <= v
          : hooked.result.robustness >= v && full.result.robustness >= v;
        // The hook is not called after it decides, and the trace ends at that sample.
        return sameSign && bounded && calls === decidedCalls && hooked.trace.t.length === decidedCalls && calls <= steps + 1;
      }), cfg);
  });

  it('Property 6 (witness): a decision does happen, and it ends the trial early', async () => {
    const req = reqFor(40, { kind: 'always-bob-angle', bound: 0.05 });
    const hook = makeAlwaysHook(req);
    let calls = 0;
    const r = await runCaptured(testApp, req, mkSpec({ 'push.force': 20, 'push.angle': 0 }, 5), (t, n) => { calls++; return hook(t, n); });
    expect(r.result.robustness).toBeLessThan(0);
    expect(calls).toBeLessThan(41);
    expect(r.trace.t.length).toBe(calls);
  });

  // Feature: golem-sim, Property 7: Perturbation calls are ordered, fresh and stable
  it('Property 7: calls are in array order at every sim step with a stable values object', async () => {
    await fc.assert(fc.asyncProperty(arbScenario, arbSeed, fc.integer({ min: 10, max: 20 }), async (sc, seed, steps) => {
      const log: SpyEntry[] = [];
      const app = withSpyTemplate(withSpyTemplate(testApp, log, 'spyA'), log, 'spyB');
      const req = reqFor(steps, {
        perturbations: [
          { template: 'spyA', params: { x: 'push.force', y: 'push.angle', k: 3 } },
          pushCall(),
          { template: 'spyB', params: { x: 'push.force' } },
        ],
      });
      const spec = mkSpec(sc, seed);
      await runTrial(app, req, spec, { cache });
      const first = log.map((e) => e.t);
      const total = steps * 10;
      if (log.length !== 2 * total) return false;
      const angleDim = req.space.dims[1]!;
      const forceDim = req.space.dims[0]!;
      const aVals = log[0]!.values, bVals = log[1]!.values;
      for (let i = 0; i < total; i++) {
        const a = log[2 * i]!, b = log[2 * i + 1]!;
        const expectT = (100 + i) * 0.002;
        if (a.name !== 'spyA' || b.name !== 'spyB' || a.t !== expectT || b.t !== expectT) return false;
        if (a.tTrigger !== 0.2 || b.tTrigger !== 0.2 || a.simTime !== b.simTime) return false;
        if (a.values !== aVals || b.values !== bVals) return false;
        if (!a.xfrc.every((x) => x === 0)) return false;
      }
      if (aVals['x'] !== normaliseScenario(forceDim, sc['push.force']!)
        || aVals['y'] !== normaliseScenario(angleDim, sc['push.angle']!) || aVals['k'] !== 3
        || bVals['x'] !== aVals['x']) return false;
      log.length = 0;
      await runTrial(app, req, spec, { cache });
      return log.map((e) => e.t).every((t, i) => t === first[i]);
    }), cfg);
  });
});

// ---------------------------------------------------------------- properties 8, 9, 11, 14: faults

type Mode = 'ok' | 'initState' | 'makeController' | 'controller' | 'signals' | 'apply' | 'hook' | 'hookNaN'
  | 'monitor' | 'diverge' | 'early' | 'badSeed' | 'badScenario' | 'unknownName';
const MODES: Mode[] = ['ok', 'initState', 'makeController', 'controller', 'signals', 'apply', 'hook', 'hookNaN',
  'monitor', 'diverge', 'early', 'badSeed', 'badScenario', 'unknownName'];

interface Plan { app: RobotApp; req: TestRequirement; spec: TrialSpec; hook?: EarlyStopHook; rejects: boolean; cause?: Error }

function plan(mode: Mode, sc: Record<string, number>, seed: number, steps: number, j: number, reqId = 'R1'): Plan {
  const boom = new Error(`${mode} broke`);
  const req = reqFor(steps, { id: reqId });
  const spec = mkSpec(sc, seed, undefined, reqId);
  const base: Plan = { app: testApp, req, spec, rejects: false };
  switch (mode) {
    case 'initState': return { ...base, app: { ...testApp, initState: () => { throw boom; } }, rejects: true, cause: boom };
    case 'makeController': return { ...base, app: { ...testApp, makeController: () => { throw boom; } }, rejects: true, cause: boom };
    case 'controller': {
      const app = withThrowingController(testApp, 10 + (j % 10));
      const innerMake = app.makeController;
      return { ...base, app: { ...app, makeController: (c, r) => { const k = innerMake(c, r); return { step: (cc, t) => { try { k.step(cc, t); } catch (e) { throw boom; } } }; } }, rejects: true, cause: boom };
    }
    case 'signals': {
      const app = withThrowingSignals(testApp, j % 10);
      return { ...base, app: { ...app, signals: (c, o) => { try { app.signals(c, o); } catch { throw boom; } } }, rejects: true, cause: boom };
    }
    case 'apply': {
      const push = { ...testApp.lexicon.perturbations[0]!, apply: () => { throw boom; } };
      return { ...base, app: { ...testApp, lexicon: { ...testApp.lexicon, perturbations: [push] } }, rejects: true, cause: boom };
    }
    case 'hook': return { ...base, hook: () => { throw boom; }, rejects: true, cause: boom };
    case 'hookNaN': return { ...base, hook: () => NaN, rejects: true };
    case 'monitor': return { ...base, req: { ...req, monitor: () => { throw boom; } }, rejects: true, cause: boom };
    case 'diverge': return { ...base, app: withNaNControl(testApp, 10 + (j % 10)) };
    case 'early': return { ...base, hook: (_t, n) => (n === (j % 10) + 1 ? 1 : undefined) };
    case 'badSeed': return { ...base, spec: { ...spec, seed: -1 - seed }, rejects: true };
    case 'badScenario': return { ...base, spec: { ...spec, scenario: { ...sc, 'push.force': 500 } }, rejects: true };
    case 'unknownName': return { ...base, app: { ...testApp, names: { body: ['ghost'] } }, rejects: true };
    default: return base;
  }
}

const arbMode = fc.constantFrom(...MODES);

describe('fault properties', () => {
  // Feature: golem-sim, Property 8: No handle leaks
  it('Property 8: the handle counter returns to its starting value on every path', async () => {
    await fc.assert(fc.asyncProperty(arbMode, arbScenario, arbSeed, arbSteps(25), fc.nat(40), async (mode, sc, seed, steps, j) => {
      const p = plan(mode, sc, seed, steps, j);
      const before = liveHandleCount();
      let rejected = false;
      try { await runTrial(p.app, p.req, p.spec, { cache, ...(p.hook ? { earlyStop: p.hook } : {}) }); } catch { rejected = true; }
      if (rejected !== p.rejects || liveHandleCount() !== before) return false;
      // With a fresh cache the model handle is the only addition, and dispose removes it.
      const fresh = new ModelCache();
      try { await runTrial(p.app, p.req, p.spec, { cache: fresh, ...(p.hook ? { earlyStop: p.hook } : {}) }); } catch { /* expected */ }
      const added = fresh.size > 0 && liveHandleCount() === before + 1;
      fresh.dispose();
      return (fresh.size === 0) && liveHandleCount() === before && (added || liveHandleCount() === before);
    }), { ...cfg, numRuns: PHYSICS_RUNS });
  });

  // Feature: golem-sim, Property 9: Failed trials report their identity
  it('Property 9: a rejected trial names app id, requirement id, decimal seed and keeps the cause', async () => {
    const failing = MODES.filter((m) => !['ok', 'diverge', 'early'].includes(m));
    await fc.assert(fc.asyncProperty(
      fc.constantFrom(...failing), arbScenario, arbSeed, arbSteps(20), fc.nat(40), fc.integer({ min: 1, max: 9999 }),
      async (mode, sc, seed, steps, j, n) => {
        const p = plan(mode, sc, seed, steps, j, `R${n}`);
        const err: any = await runTrial(p.app, p.req, p.spec, { cache, ...(p.hook ? { earlyStop: p.hook } : {}) }).then(() => undefined, (e) => e);
        if (!(err instanceof SimError)) return false;
        const seedText = String(p.spec.seed);
        return err.message.startsWith(`Trial failed (app test, requirement R${n}, seed ${seedText}): `)
          && !/\n\s+at /.test(err.message)
          && err.cause !== undefined && (p.cause === undefined || err.cause === p.cause);
      }), cfg);
  });

  // Feature: golem-sim, Property 11: Finite robustness unless diverged
  it('Property 11: robustness is finite unless the trace diverged, and then it is -Infinity at the divergence time', async () => {
    await fc.assert(fc.asyncProperty(fc.boolean(), arbScenario, arbSeed, arbSteps(30), fc.nat(40), async (diverge, sc, seed, steps, j) => {
      const p = plan(diverge ? 'diverge' : 'ok', sc, seed, steps, j);
      const { result, trace } = await runCaptured(p.app, p.req, p.spec);
      const divs = trace.events.filter((e) => e.name === 'diverged');
      if (divs.length === 0) return !diverge && Number.isFinite(result.robustness);
      const lastSample = trace.t[trace.t.length - 1]!;
      return divs.length === 1 && result.robustness === -Infinity && result.worstAt === divs[0]!.t
        && divs[0]!.t > lastSample && Object.values(trace.signals).every((s) => s.length === trace.t.length);
    }), cfg);
  });

  // Feature: golem-sim, Property 14: The cached model is unchanged by trials
  it('Property 14: guarded model arrays are byte-equal before and after every trial', async () => {
    const guarded = () => {
      const m = model;
      return [m.body_mass, m.body_inertia, m.geom_friction, m.geom_size, m.actuator_gainprm, m.actuator_biasprm,
        m.dof_damping, m.dof_frictionloss, m.opt.gravity, m.opt.wind]
        .map((a: Float64Array) => Float64Array.from(a))
        .concat([Float64Array.of(m.opt.timestep, m.opt.density, m.opt.viscosity, m.opt.impratio, m.opt.tolerance, m.opt.iterations, m.opt.disableflags)]);
    };
    await fc.assert(fc.asyncProperty(
      fc.array(fc.tuple(arbMode, arbScenario, arbSeed, arbSteps(20), fc.nat(40), fc.boolean()), { minLength: 1, maxLength: 3 }),
      async (items) => {
        const before = guarded();
        for (const [mode, sc, seed, steps, j, alter] of items) {
          const p = plan(mode, sc, seed, steps, j);
          let app = p.app;
          let req: CompiledRequirement = p.req;
          if (alter) {
            app = withModelAlteringTemplate(app);
            req = { ...req, perturbations: [...req.perturbations, { template: 'alter', params: {} }] };
          }
          await runTrial(app, req, p.spec, { cache, ...(p.hook ? { earlyStop: p.hook } : {}) }).catch(() => undefined);
          const after = guarded();
          if (!after.every((a, i) => bytesEq(a, before[i]!))) return false;
        }
        return true;
      }), cfg);
  });
});

// ---------------------------------------------------------------- poses and seeds

describe('pose and seed properties', () => {
  // Feature: golem-sim, Property 12: Pose frame layout
  it('Property 12: frames hold float32 xpos and xquat at samples at least 1/30 s apart', async () => {
    await fc.assert(fc.asyncProperty(arbScenario, arbSeed, arbSteps(40), fc.option(fc.integer({ min: 1, max: 12 }), { nil: undefined }),
      async (sc, seed, steps, stopAt) => {
        const logs: Array<{ xpos: Float64Array; xquat: Float64Array }> = [];
        const app: RobotApp = {
          ...testApp,
          signals: (ctx, out) => {
            testApp.signals(ctx, out);
            logs.push({ xpos: Float64Array.from(ctx.data.xpos), xquat: Float64Array.from(ctx.data.xquat) });
          },
        };
        const hook: EarlyStopHook | undefined = stopAt === undefined ? undefined : (_t, n) => (n === stopAt ? 1 : undefined);
        const { result, trace } = await runCaptured(app, reqFor(steps), mkSpec(sc, seed, 'poses'), hook);
        const poses = result.poses;
        if (!poses || poses.fps !== 30 || poses.nbody !== model.nbody) return false;
        const picked: number[] = [];
        let last = 0;
        for (let k = 0; k < trace.t.length; k++) {
          if (picked.length === 0 || trace.t[k]! - last >= 1 / 30 - 1e-9) { picked.push(k); last = trace.t[k]!; }
        }
        if (picked[0] !== 0 || poses.frames.length !== poses.nbody * 7 * picked.length) return false;
        for (let f = 0; f < picked.length; f++) {
          const { xpos, xquat } = logs[picked[f]!]!;
          for (let b = 0; b < poses.nbody; b++) {
            const o = (f * poses.nbody + b) * 7;
            const expected = [xpos[3 * b], xpos[3 * b + 1], xpos[3 * b + 2], xquat[4 * b], xquat[4 * b + 1], xquat[4 * b + 2], xquat[4 * b + 3]];
            for (let i = 0; i < 7; i++) if (!Object.is(poses.frames[o + i], Math.fround(expected[i]!))) return false;
          }
        }
        return true;
      }), cfg);
  });

  it("Property 12: 'none' and absent record give no poses", async () => {
    await fc.assert(fc.asyncProperty(arbScenario, arbSeed, fc.constantFrom<'none' | undefined>('none', undefined), async (sc, seed, rec) => {
      const { result } = await runCaptured(testApp, reqFor(10), mkSpec(sc, seed, rec));
      return result.poses === undefined;
    }), cfg);
  });

  // Feature: golem-sim, Property 13: Pose recording does not change the result
  it('Property 13: recording poses leaves robustness, worstAt, t, signals and events bit-identical', async () => {
    await fc.assert(fc.asyncProperty(arbScenario, arbSeed, arbSteps(40), async (sc, seed, steps) => {
      const a = await runCaptured(testApp, reqFor(steps), mkSpec(sc, seed, 'none'));
      const b = await runCaptured(testApp, reqFor(steps), mkSpec(sc, seed, 'poses'));
      return traceEq(a.trace, b.trace) && Object.is(a.result.robustness, b.result.robustness)
        && Object.is(a.result.worstAt, b.result.worstAt);
    }), cfg);
  });

  // Feature: golem-sim, Property 20: PRNG and seed behaviour
  it('Property 20: seeds outside [0, 2^32-1] or non-integer are rejected before any MjData exists', async () => {
    const badSeed = fc.oneof(
      fc.integer({ min: -1000000, max: -1 }), fc.integer({ min: 4294967296, max: 4294967296 + 1000000 }),
      fc.double({ noInteger: true, min: 0, max: 1e6, noNaN: true }), fc.constant(NaN), fc.constant(Infinity),
    );
    await fc.assert(fc.asyncProperty(badSeed, arbScenario, async (seed, sc) => {
      const fresh = new ModelCache();
      const before = liveHandleCount();
      const err = await runTrial(testApp, reqFor(10), { ...mkSpec(sc, 0), seed }, { cache: fresh }).then(() => undefined, (e) => e);
      return err instanceof SimError && /Seed/.test(err.message) && fresh.size === 0 && liveHandleCount() === before;
    }), { ...cfg, numRuns: PURE_RUNS });
  });

  it('Property 20: with no random draws, any two seeds give bit-identical trials', async () => {
    await fc.assert(fc.asyncProperty(arbScenario, arbSeed, arbSeed, arbSteps(30), async (sc, s1, s2, steps) => {
      const app = withNoDraws(testApp);
      const a = await runCaptured(app, reqFor(steps), mkSpec(sc, s1));
      const b = await runCaptured(app, reqFor(steps), mkSpec(sc, s2));
      return traceEq(a.trace, b.trace) && Object.is(a.result.robustness, b.result.robustness);
    }), cfg);
  });

  it('seeds that differ change the trial when the app draws from the PRNG', async () => {
    const a = await runCaptured(testApp, reqFor(20), mkSpec({ 'push.force': 0, 'push.angle': 0 }, 1));
    const b = await runCaptured(testApp, reqFor(20), mkSpec({ 'push.force': 0, 'push.angle': 0 }, 2));
    expect(traceEq(a.trace, b.trace)).toBe(false);
    expect(describeTrial(mkSpec({}, 1)).length).toBeGreaterThan(0);
  });
});

