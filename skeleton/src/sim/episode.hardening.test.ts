// Regression tests for golem-sim-hardening (one describe per defect or improvement).
// Each test failed on the runner before its fix; see docs/reviews/sim-hardening.md.
import { afterAll, describe, expect, it } from 'vitest';
import { runTrial } from './episode.js';
import { ModelCache } from './model-cache.js';
import {
  alwaysAbove, boxDropApp, kickCall, makeStoolApp, shoveCall, stoolApp,
} from './test-models.js';
import type { CompiledRequirement, EarlyStopHook, RobotApp, Trace, TrialResult, TrialSpec } from './types.js';

const cache = new ModelCache();
afterAll(() => cache.dispose());

const AUTORESET = 65536;

export interface Captured { result: TrialResult; trace: Trace }
async function run(
  app: RobotApp, req: CompiledRequirement, scenario: Record<string, number> = { f: 0, a: 0 }, seed = 1,
  extra: { earlyStop?: EarlyStopHook; record?: 'poses'; cache?: ModelCache } = {},
): Promise<Captured> {
  let trace: Trace | undefined;
  const wrapped: CompiledRequirement = {
    ...req,
    monitor: (t) => {
      trace = {
        t: t.t.slice(), events: t.events.map((e) => ({ ...e })),
        signals: Object.fromEntries(Object.entries(t.signals).map(([k, v]) => [k, v.slice()])),
      };
      return req.monitor(t);
    },
  };
  const spec: TrialSpec = { app: app.id, reqId: req.id, scenario, seed, ...(extra.record ? { record: extra.record } : {}) };
  const result = await runTrial(app, wrapped, spec, { cache: extra.cache ?? cache, ...(extra.earlyStop ? { earlyStop: extra.earlyStop } : {}) });
  return { result, trace: trace ?? { t: new Float64Array(0), signals: {}, events: [] } };
}

const boxReq = (horizon = 1, perturbations = [kickCall()]) =>
  alwaysAbove({ signal: 'box.z', bound: 0.05, horizon, perturbations });

describe('defect 1: auto-reset is disabled during trials', () => {
  it('sets mjDSBL_AUTORESET while the controller runs and restores the flags afterwards', async () => {
    const { model } = await cache.getModel(boxDropApp);
    const before = model.opt.disableflags as number;
    const seen: number[] = [];
    const app: RobotApp = {
      ...boxDropApp,
      makeController: (ctx) => ({ step: () => { seen.push(ctx.model.opt.disableflags as number); } }),
    };
    await run(app, boxReq(0.2, []));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((f) => (f & AUTORESET) !== 0)).toBe(true);
    expect(model.opt.disableflags).toBe(before);
    expect(before & AUTORESET).toBe(0);
  });

  it('does not silently reset the box after a 1e30 N kick: time never runs backwards', async () => {
    const { trace } = await run(boxDropApp, boxReq(1), { f: 1e30, a: 0 });
    const time = trace.signals['time']!;
    for (let k = 1; k < time.length; k++) expect(time[k]!).toBeGreaterThan(time[k - 1]!);
    // An auto-reset puts the box back at its initial height (0.3 m) and the trace looks healthy.
    const z = trace.signals['box.z']!;
    expect(z.every((v) => Math.abs(v - 0.3) > 1e-9 || v === z[0])).toBe(true);
  });
});

describe('defect 2 and improvement 1: bounded divergence check and numerical diagnostics', () => {
  it('reports a finite 1e30 N blow-up as diverged, with the cause, the warning counters, solver and contact counts', async () => {
    const { result, trace } = await run(boxDropApp, boxReq(1), { f: 1e30, a: 0 });
    const div = trace.events.filter((e) => e.name === 'diverged') as any[];
    expect(div).toHaveLength(1);
    const ev = div[0];
    expect(['qpos', 'qvel', 'qacc']).toContain(ev.cause);
    expect(ev.phase).toBe('trial');
    expect(Math.abs(ev.value) > 1e10 || !Number.isFinite(ev.value)).toBe(true);
    expect(ev.warnings.BADQACC).toBeGreaterThanOrEqual(1);
    expect(typeof ev.solverIterations).toBe('number');
    expect(typeof ev.contacts).toBe('number');
    // The kick starts at the trigger (0.2 s) and the blow-up is caught within the kick.
    expect(ev.t).toBeGreaterThan(0.2);
    expect(ev.t).toBeLessThanOrEqual(0.2 + 0.02 + 1e-9);
    expect(result.robustness).toBeLessThan(0);
    expect(result.worstAt).toBe(ev.t);
    const { name: _name, ...info } = ev;
    expect(result.diagnostics.diverged).toEqual(info);
    expect(result.diagnostics.numerical).toBe(true);
    // The trace holds only samples before the divergence.
    expect(trace.t[trace.t.length - 1]!).toBeLessThan(ev.t);
  });

  it('reports a healthy contact-rich trial with contacts, solver iterations and no warnings', async () => {
    const { result, trace } = await run(stoolApp, alwaysAbove({ signal: 'torso.z', bound: 0.25, horizon: 1 }));
    expect(trace.events.map((e) => e.name)).toEqual(['trigger']);
    const d = result.diagnostics;
    expect(d.maxContacts).toBeGreaterThanOrEqual(5);
    expect(d.maxSolverIterations).toBeGreaterThanOrEqual(1);
    expect(d.solverSaturatedSteps).toBeGreaterThanOrEqual(0);
    expect(Object.values(d.warnings).every((n) => n === 0)).toBe(true);
    expect(d.warnings).toHaveProperty('BADQACC');
    expect(d.numerical).toBe(false);
    expect(d.diverged).toBeUndefined();
    expect(d.simSteps).toBe(100 + 500);
    expect(d.timestep).toBe(0.002);
    expect(d.integrator).toBe('euler');
    expect(d.horizon).toBe(1);
  });

  it('treats a BAD* warning counter raised during the trial as divergence even when the state looks bounded', async () => {
    const app: RobotApp = {
      ...boxDropApp,
      makeController: (ctx) => {
        let n = 0;
        return {
          step: () => {
            if (n++ !== 15) return;
            const w = ctx.data.warning;           // a reference into MjData: never delete it
            const s = w.get(3);                   // mjWARN_BADQPOS; get() returns a copy
            s.number = 1; w.set(3, s); s.delete();
          },
        };
      },
    };
    const { result, trace } = await run(app, boxReq(0.6, []));
    const div = trace.events.filter((e) => e.name === 'diverged') as any[];
    expect(div).toHaveLength(1);
    expect(div[0].cause).toBe('warning');
    expect(div[0].warnings.BADQPOS).toBe(1);
    expect(result.robustness).toBeLessThan(0);
    expect(result.diagnostics.numerical).toBe(true);
  });
});

describe('defect 4: mj_forward after initState', () => {
  it('lets sample 0 and the first controller step see the pose initState wrote (warm-up 0)', async () => {
    const seen: number[][] = [];
    const app: RobotApp = {
      ...boxDropApp,
      warmup: 0,
      initState: (ctx) => { (ctx.data.qpos as Float64Array)[2] = 0.9; },
      makeController: (ctx) => ({
        step: () => { if (seen.length === 0) seen.push(Array.from(ctx.data.sensordata as Float64Array)); },
      }),
    };
    const { trace } = await run(app, boxReq(0.1, []));
    expect(trace.signals['box.z']![0]).toBe(0.9);
    expect(seen[0]).toEqual([0, 0, 0.9]);
  });
});

describe('defect 3 and improvement 4: Controller.substep at the sim rate, and the saturation meter', () => {
  it('calls substep before every mj_step, warm-up included, with tSim = simIndex * simDt', async () => {
    const calls: Array<{ t: number; time: number }> = [];
    const app: RobotApp = {
      ...boxDropApp,
      makeController: (ctx) => ({
        step: () => {},
        substep: (_c, tSim) => { calls.push({ t: tSim, time: ctx.data.time as number }); },
      }),
    };
    await run(app, boxReq(0.5, []));
    expect(calls).toHaveLength(100 + 25 * 10);
    calls.forEach((c, i) => {
      expect(c.t).toBe(i * 0.002);
      expect(Math.abs(c.time - c.t)).toBeLessThan(1e-12);
    });
  });

  it('calls substep after xfrc is cleared and before every perturbation apply', async () => {
    const order: string[] = [];
    const spy = { phrase: 'spy', name: 'spy', dims: () => [], apply: () => { order.push('apply'); } };
    const app: RobotApp = {
      ...boxDropApp,
      lexicon: { ...boxDropApp.lexicon, perturbations: [spy] },
      makeController: (ctx) => ({
        step: () => { order.push('step'); },
        substep: () => {
          const x = ctx.data.xfrc_applied as Float64Array;
          order.push(x.every((v) => v === 0) ? 'substep' : 'substep-dirty');
          x[8] = 1; // a controller may write xfrc; the next step clears it again
        },
      }),
    };
    await run(app, alwaysAbove({ signal: 'box.z', bound: 0, horizon: 0.04, perturbations: [{ template: 'spy', params: {} }] }));
    const trial = order.slice(order.indexOf('apply') - 1);
    expect(trial.slice(0, 4)).toEqual(['substep', 'apply', 'substep', 'apply']);
    expect(order).not.toContain('substep-dirty');
    expect(order.filter((o) => o === 'step')).toHaveLength(10 + 2);
  });

  it('keeps the stool standing with a 500 Hz PD in substep; without torque it collapses', async () => {
    const req = alwaysAbove({ signal: 'torso.z', bound: 0.25, horizon: 1.5 });
    const held = await run(stoolApp, req, { f: 0, a: 0 }, 3);
    expect(held.result.robustness).toBeGreaterThan(0.02);
    const limp = await run(makeStoolApp('none'), req, { f: 0, a: 0 }, 3);
    expect(limp.result.robustness).toBeLessThan(0);
  });

  it('logs torque saturation as a signal: below 1 at rest, at least 1 while a shove saturates the hips', async () => {
    const req = alwaysAbove({ signal: 'torso.z', bound: 0, horizon: 1, perturbations: [shoveCall(0.3)] });
    const calm = await run(stoolApp, req, { f: 0, a: 0 }, 3);
    const sat = calm.trace.signals['saturation']!;
    expect(sat.length).toBe(calm.trace.t.length);
    expect(Math.max(...sat.slice(10))).toBeLessThan(1);
    const shoved = await run(stoolApp, req, { f: 800, a: 0 }, 3);
    expect(Math.max(...shoved.trace.signals['saturation']!)).toBeGreaterThanOrEqual(1);
  });
});

describe('defect 7: PerturbationTemplate.begin runs once at the trigger', () => {
  it('calls begin once per call, in array order, at the trigger, before sample 0 and the first apply; a mass doubling does not compound', async () => {
    const log: string[] = [];
    const { model } = await cache.getModel(boxDropApp);
    const box = 1; // body id of "box"
    const mass0 = model.body_mass[box] as number;
    const mk = (name: string) => ({
      phrase: name, name, dims: () => [],
      begin: (ctx: any, values: Record<string, number>) => {
        log.push(`begin:${name}:${Math.abs((ctx.data.time as number) - 0.2) < 1e-12}:${values['k']}`);
        ctx.model.body_mass[box] *= 2;
      },
      apply: () => { if (!log.includes(`apply:${name}`)) log.push(`apply:${name}`); },
    });
    const masses: number[] = [];
    const app: RobotApp = {
      ...boxDropApp,
      lexicon: { ...boxDropApp.lexicon, perturbations: [mk('A'), mk('B')] },
      signals: (ctx, out) => {
        if (masses.length === 0) log.push('sample0');
        masses.push(ctx.model.body_mass[box] as number);
        boxDropApp.signals(ctx, out);
      },
    };
    await run(app, alwaysAbove({
      signal: 'box.z', bound: 0, horizon: 0.5,
      perturbations: [{ template: 'A', params: { k: 1 } }, { template: 'B', params: { k: 2 } }],
    }));
    expect(log).toEqual(['begin:A:true:1', 'begin:B:true:2', 'sample0', 'apply:A', 'apply:B']);
    expect(masses.every((m) => m === mass0 * 4)).toBe(true);
    expect(model.body_mass[box]).toBe(mass0);
  });
});

describe('defect 6 and improvement 5: full model snapshot and restore', () => {
  /** Fields the old allow-list guard did not cover. */
  const scramble = {
    phrase: 'scramble', name: 'scramble', dims: () => [],
    begin: (ctx: any) => {
      const m = ctx.model;
      m.body_pos[3 * (ctx.ids['body:crate'] as number) + 2] = 3;
      m.actuator_ctrlrange[1] = 1;
      m.jnt_stiffness[2] = 7;
      m.geom_solref[0] = 0.05;
      m.dof_armature[6] = 0.5;
      m.eq_data[0] = 0.25;
      m.opt.o_margin = 0.01;
      m.opt.impratio = 3;
    },
    apply: () => {},
  };
  const app: RobotApp = { ...stoolApp, lexicon: { ...stoolApp.lexicon, perturbations: [scramble] } };
  const read = (m: any) => ({
    bodyPos: m.body_pos[3 * 2 + 2], ctrlrange: m.actuator_ctrlrange[1], stiffness: m.jnt_stiffness[2],
    solref: m.geom_solref[0], armature: m.dof_armature[6], eq: m.eq_data[0], margin: m.opt.o_margin, impratio: m.opt.impratio,
  });

  it('restores fields outside the old allow-list (body_pos, ctrlrange, stiffness, solref, armature, eq_data, opt)', async () => {
    const { model } = await cache.getModel(app);
    const before = read(model);
    const bytes = Uint8Array.from(model.buffer as Uint8Array);
    await run(app, alwaysAbove({ signal: 'torso.z', bound: 0, horizon: 0.2, perturbations: [{ template: 'scramble', params: {} }] }));
    expect(read(model)).toEqual(before);
    expect(Buffer.compare(Buffer.from(model.buffer as Uint8Array), Buffer.from(bytes))).toBe(0);
  });

  it('isolates trials: a scrambled trial leaves no trace in the next one', async () => {
    const plain = alwaysAbove({ signal: 'torso.z', bound: 0.25, horizon: 0.6 });
    // Reference from a freshly compiled model, so an earlier leak in the shared cache cannot hide one here.
    const fresh = new ModelCache();
    const a = await run(stoolApp, plain, { f: 0, a: 0 }, 9, { cache: fresh });
    fresh.dispose();
    await run(app, alwaysAbove({ signal: 'torso.z', bound: 0, horizon: 0.2, perturbations: [{ template: 'scramble', params: {} }] }));
    const b = await run(stoolApp, plain, { f: 0, a: 0 }, 9);
    expect(Object.is(a.result.robustness, b.result.robustness)).toBe(true);
    expect(Array.from(b.trace.signals['torso.z']!)).toEqual(Array.from(a.trace.signals['torso.z']!));
  });

  it('names every changed field with changedModelFields, and none after a restore', async () => {
    const snapMod = await import('./model-snapshot.js');
    const { model } = await cache.getModel(app);
    expect(snapMod.changedModelFields(model)).toEqual([]);
    const ctx = { model, ids: { 'body:crate': 2 } };
    scramble.begin(ctx);
    expect(snapMod.changedModelFields(model).sort()).toEqual(
      ['actuator_ctrlrange', 'body_pos', 'dof_armature', 'eq_data', 'geom_solref', 'jnt_stiffness', 'opt.impratio', 'opt.o_margin'],
    );
    snapMod.restoreModelSnapshot(model);
    expect(snapMod.changedModelFields(model)).toEqual([]);
  });
});

describe('defect 5: pose frames follow the sim-step schedule and the reported fps', () => {
  it('records floor(horizon * 30) + 1 frames, frame f being the state at trial step ceil(f / (30 * simDt))', async () => {
    const states = new Map<number, number[]>();
    const app: RobotApp = {
      ...boxDropApp,
      makeController: (ctx) => ({
        step: () => {},
        substep: (_c, tSim) => {
          const i = Math.round(tSim / 0.002);
          states.set(i, [...Array.from(ctx.data.xpos as Float64Array), ...Array.from(ctx.data.xquat as Float64Array)]);
        },
      }),
      signals: (ctx, out) => {
        boxDropApp.signals(ctx, out);
        const i = Math.round((ctx.data.time as number) / 0.002);
        states.set(i, [...Array.from(ctx.data.xpos as Float64Array), ...Array.from(ctx.data.xquat as Float64Array)]);
      },
    };
    const horizon = 1.8;
    const { result } = await run(app, boxReq(horizon, []), { f: 0, a: 0 }, 1, { record: 'poses' });
    const p = result.poses!;
    expect(p.fps).toBe(30);
    const nb = p.nbody;
    const frames = p.frames.length / (nb * 7);
    expect(frames).toBe(Math.floor(horizon * 30) + 1); // 55; the old recorder gave 46 (25 fps)
    for (let f = 0; f < frames; f++) {
      const s = Math.ceil(f / (30 * 0.002) - 1e-9);
      expect(Math.abs(s * 0.002 - f / 30)).toBeLessThan(0.002);
      const st = states.get(100 + s)!;
      for (let b = 0; b < nb; b++) {
        const o = (f * nb + b) * 7;
        expect(p.frames[o]).toBe(Math.fround(st[3 * b]!));
        expect(p.frames[o + 2]).toBe(Math.fround(st[3 * b + 2]!));
        expect(p.frames[o + 3]).toBe(Math.fround(st[3 * nb + 4 * b]!));
      }
    }
  });
});

describe('defect 8: divergence during warm-up is a counterexample, not an error', () => {
  const blowUpInWarmup = (monitor?: CompiledRequirement['monitor']): [RobotApp, CompiledRequirement] => {
    const app: RobotApp = {
      ...boxDropApp,
      makeController: (ctx) => ({
        step: () => {},
        substep: (_c, tSim) => {
          if (Math.round(tSim / 0.002) === 50) (ctx.data.xfrc_applied as Float64Array)[6 + 2] = 1e30;
        },
      }),
    };
    const req = boxReq(1, []);
    return [app, monitor ? { ...req, monitor } : req];
  };

  it('returns a broken result with one diverged event in the warm-up phase and an empty trace', async () => {
    const [app, req] = blowUpInWarmup();
    const { result, trace } = await run(app, req);
    expect(trace.t.length).toBe(0);
    expect(trace.events).toHaveLength(1);
    const ev = trace.events[0] as any;
    expect(ev.name).toBe('diverged');
    expect(ev.phase).toBe('warmup');
    expect(ev.t).toBeCloseTo(51 * 0.002, 12);
    expect(result.robustness).toBeLessThan(0);
    expect(result.worstAt).toBe(ev.t);
    expect(result.unit).toBe('m');
    expect(result.diagnostics.diverged?.phase).toBe('warmup');
    expect(result.diagnostics.simSteps).toBe(51);
  });

  it('uses an empty unit when the monitor cannot handle an empty trace', async () => {
    const [app, req] = blowUpInWarmup(() => { throw new Error('empty trace'); });
    const r = await runTrial(app, req, { app: app.id, reqId: req.id, scenario: { f: 0, a: 0 }, seed: 1 }, { cache });
    expect(r.robustness).toBeLessThan(0);
    expect(r.unit).toBe('');
  });
});

void makeStoolApp; void shoveCall;
