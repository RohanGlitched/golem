import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildContext } from './context.js';
import { ModelCache } from './model-cache.js';
import { mulberry32 } from './prng.js';
import { testApp } from './test-app.js';
import {
  SpyEntry, withModelAlteringTemplate, withNaNControl, withNoDraws, withSpyTemplate,
  withThrowingController, withThrowingSignals,
} from './test-fixtures.js';
import type { Mj, RobotApp, SimContext } from './types.js';

let cache: ModelCache;
let mj: Mj;
let model: any;
beforeAll(async () => { cache = new ModelCache(); ({ mj, model } = await cache.getModel(testApp)); });
afterAll(() => cache.dispose());

const open = (): { ctx: SimContext; data: any } => {
  const data = new (mj as any).MjData(model);
  return { ctx: buildContext(mj, model, data, testApp.names), data };
};

describe('behaviour wrappers', () => {
  it('withThrowingController throws only at the chosen step', () => {
    const { ctx, data } = open();
    const ctl = withThrowingController(testApp, 2).makeController(ctx, mulberry32(1));
    ctl.step(ctx, 0); ctl.step(ctx, 0);
    expect(() => ctl.step(ctx, 0)).toThrow(/step 2/);
    ctl.step(ctx, 0);
    data.delete();
  });
  it('withThrowingSignals throws only at the chosen call', () => {
    const { ctx, data } = open();
    const app = withThrowingSignals(testApp, 1);
    const out: Record<string, number> = {};
    app.signals(ctx, out);
    expect(() => app.signals(ctx, out)).toThrow(/step 1/);
    app.signals(ctx, out);
    data.delete();
  });
  it('withNaNControl makes qpos non-finite after a step with auto-reset off (as the runner sets it), and leaves the flags alone', () => {
    const { ctx, data } = open();
    const before = model.opt.disableflags;
    const app: RobotApp = withNaNControl(testApp, 0);
    const ctl = app.makeController(ctx, mulberry32(1));
    expect(model.opt.disableflags).toBe(before);
    expect(app.endTrial).toBe(testApp.endTrial);
    model.opt.disableflags = before | 65536;
    try {
      ctl.step(ctx, 0);
      (mj as any).mj_step(model, data);
      expect(Number.isNaN(data.qpos[7])).toBe(true);
    } finally {
      model.opt.disableflags = before;
    }
    data.delete();
  });
  it('withModelAlteringTemplate changes mass, friction and gravity, and nothing else on the app', () => {
    const { ctx, data } = open();
    const app = withModelAlteringTemplate(testApp);
    expect(app.lexicon.perturbations.map((p) => p.name)).toEqual(['push', 'alter']);
    const bob = ctx.ids['body:bob'] as number;
    const mass = model.body_mass[bob], fr = model.geom_friction[0], g = model.opt.gravity[2];
    app.lexicon.perturbations[1]!.apply(ctx, 0, 0, {});
    expect(model.body_mass[bob]).toBe(1.5);
    expect(model.geom_friction[0]).toBe(0.1);
    expect(model.opt.gravity[2]).toBe(-1);
    model.body_mass[bob] = mass; model.geom_friction[0] = fr; model.opt.gravity[2] = g;
    expect(app.simDt).toBe(testApp.simDt);
    data.delete();
  });
  it('withSpyTemplate records (t, tTrigger, values identity, xfrc snapshot)', () => {
    const { ctx, data } = open();
    const log: SpyEntry[] = [];
    const app = withSpyTemplate(testApp, log, 's1');
    const values = { a: 1 };
    data.xfrc_applied[3] = 4;
    app.lexicon.perturbations[1]!.apply(ctx, 0.5, 0.2, values);
    expect(log).toHaveLength(1);
    expect(log[0]!.t).toBe(0.5);
    expect(log[0]!.tTrigger).toBe(0.2);
    expect(log[0]!.values).toBe(values);
    expect(log[0]!.xfrc[3]).toBe(4);
    data.delete();
  });
  it('withNoDraws makes initState consume no random number', () => {
    const { ctx, data } = open();
    withNoDraws(testApp).initState!(ctx, () => { throw new Error('drew'); });
    expect(data.qpos[7]).toBe(0.05);
    data.delete();
  });
});

