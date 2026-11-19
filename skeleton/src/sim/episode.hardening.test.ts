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
  extra: { earlyStop?: EarlyStopHook; record?: 'poses' } = {},
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
  const result = await runTrial(app, wrapped, spec, { cache, ...(extra.earlyStop ? { earlyStop: extra.earlyStop } : {}) });
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

void makeStoolApp; void shoveCall;
