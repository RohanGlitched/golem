// Timestep and integrator re-check (golem-sim-hardening improvement 2).
import { afterAll, describe, expect, it } from 'vitest';
import { runTrial } from './episode.js';
import { ModelCache } from './model-cache.js';
import { changedModelFields } from './model-snapshot.js';
import { recheckTrial } from './recheck.js';
import { alwaysAbove, jitterApp, makeStoolApp, stoolApp } from './test-models.js';
import type { TrialSpec } from './types.js';

const cache = new ModelCache();
afterAll(() => cache.dispose());

const spec = (app: { id: string }, seed = 1): TrialSpec => ({ app: app.id, reqId: 'R1', scenario: { f: 0, a: 0 }, seed });
const stoolReq = alwaysAbove({ signal: 'torso.z', bound: 0.25, horizon: 1 });
const jitterReq = alwaysAbove({ signal: 'spin.slack', bound: 0, horizon: 1, unit: 'rad/s' });

describe('RunOptions.numerics', () => {
  it('runs at simDt / 2 with twice the sim steps and the same control samples, then restores the model', async () => {
    const { model } = await cache.getModel(stoolApp);
    const base = await runTrial(stoolApp, stoolReq, spec(stoolApp), { cache });
    const half = await runTrial(stoolApp, stoolReq, spec(stoolApp), { cache, numerics: { simDt: 0.001 } });
    expect(base.diagnostics.simSteps).toBe(600);
    expect(half.diagnostics.simSteps).toBe(1200);
    expect(half.diagnostics.timestep).toBe(0.001);
    expect(model.opt.timestep).toBe(0.002);
    expect(changedModelFields(model)).toEqual([]);
  });

  it('switches the integrator for one trial only', async () => {
    const { model } = await cache.getModel(stoolApp);
    const r = await runTrial(stoolApp, stoolReq, spec(stoolApp), { cache, numerics: { integrator: 'implicitfast' } });
    expect(r.diagnostics.integrator).toBe('implicitfast');
    expect(model.opt.integrator).toBe(0);
  });

  it('rejects a simDt that does not divide controlDt and an unknown integrator', async () => {
    await expect(runTrial(stoolApp, stoolReq, spec(stoolApp), { cache, numerics: { simDt: 0.003 } }))
      .rejects.toThrow(/integer multiple of simDt/);
    await expect(runTrial(stoolApp, stoolReq, spec(stoolApp), { cache, numerics: { integrator: 'leapfrog' as never } }))
      .rejects.toThrow(/integrator "leapfrog"/);
  });
});

describe('recheckTrial', () => {
  it('confirms a physical failure: the limp stool falls at every timestep and with either integrator', async () => {
    const limp = makeStoolApp('none');
    const r = await recheckTrial(limp, stoolReq, spec(limp), { cache });
    expect(r.base.failed).toBe(true);
    expect(r.halfStep.simDt).toBe(0.001);
    expect(r.halfStep.failed).toBe(true);
    expect(r.otherIntegrator.integrator).toBe('implicitfast');
    expect(r.otherIntegrator.failed).toBe(true);
    expect(r.survives).toBe(true);
    expect(r.numericalSuspect).toBe(false);
  });

  it('flags a timestep artefact: explicit Euler blows up at 0.01 s, half step and implicitfast hold', async () => {
    const r = await recheckTrial(jitterApp, jitterReq, spec(jitterApp), { cache });
    expect(r.base.failed).toBe(true);
    expect(r.halfStep.failed).toBe(false);
    expect(r.otherIntegrator.failed).toBe(false);
    expect(r.survives).toBe(false);
    expect(r.numericalSuspect).toBe(true);
  });

  it('reports a held base trial as not failing and not suspect', async () => {
    const r = await recheckTrial(stoolApp, stoolReq, spec(stoolApp), { cache });
    expect(r.base.failed).toBe(false);
    expect(r.survives).toBe(false);
    expect(r.numericalSuspect).toBe(false);
    expect(r.base.hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
