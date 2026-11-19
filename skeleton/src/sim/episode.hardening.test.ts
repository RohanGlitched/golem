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

void makeStoolApp; void shoveCall; void stoolApp;
