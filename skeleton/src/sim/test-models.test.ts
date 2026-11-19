// The contact-rich test models behave as the hardening tests assume (raw MuJoCo loop, no runner).
import { afterAll, describe, expect, it } from 'vitest';
import { buildContext } from './context.js';
import { ModelCache } from './model-cache.js';
import { mulberry32 } from './prng.js';
import { boxDropApp, makeStoolApp } from './test-models.js';
import type { RobotApp } from './types.js';

const cache = new ModelCache();
afterAll(() => cache.dispose());

/** Runs `seconds` of raw MuJoCo with the app's controller (step at control rate, substep at sim rate). */
async function rawRun(app: RobotApp, seconds: number): Promise<{ z: number; maxContacts: number }> {
  const { mj, model } = await cache.getModel(app);
  const m: any = mj;
  const data = new m.MjData(model);
  try {
    const ctx = buildContext(mj, model, data, app.names);
    const rng = mulberry32(5);
    app.initState?.(ctx, rng);
    const c = app.makeController(ctx, rng);
    const n = Math.round(app.controlDt / app.simDt);
    let maxContacts = 0;
    const steps = Math.round(seconds / app.simDt);
    for (let s = 0; s < steps; s++) {
      if (s % n === 0) c.step(ctx, s * app.simDt);
      c.substep?.(ctx, s * app.simDt);
      m.mj_step(model, data);
      maxContacts = Math.max(maxContacts, data.ncon as number);
    }
    const out: Record<string, number> = {};
    app.signals(ctx, out);
    return { z: (out['torso.z'] ?? out['box.z']) as number, maxContacts };
  } finally {
    data.delete();
  }
}

describe('contact-rich test models', () => {
  it('drops the box onto the plane and makes several contacts', async () => {
    const r = await rawRun(boxDropApp, 1);
    expect(r.z).toBeGreaterThan(0.09);
    expect(r.z).toBeLessThan(0.11);
    expect(r.maxContacts).toBeGreaterThanOrEqual(8);
  });

  it('keeps the stool standing under a 500 Hz PD loop', async () => {
    const r = await rawRun(makeStoolApp('substep'), 2);
    expect(r.z).toBeGreaterThan(0.28);
    expect(r.maxContacts).toBeGreaterThanOrEqual(5);
  });

  it('lets the stool collapse when no torque is applied', async () => {
    const r = await rawRun(makeStoolApp('none'), 2);
    expect(r.z).toBeLessThan(0.2);
  });
});
