// One example per error condition of Requirements 1, 2, 3, 4, 5, 6, 7, 9, 10 and 14.
// Each asserts that the message carries the identifiers the criterion names. Conditions that an
// earlier test already covers in detail are listed in COVERED with the covering test file.
import { afterAll, describe, expect, it } from 'vitest';
import { buildContext } from './context.js';
import { runTrial } from './episode.js';
import { SimError } from './errors.js';
import { writeRobotFiles } from './file-writer.js';
import { withDoubleBuffer } from './helpers.js';
import { __setLoadFnForTests, loadMujoco } from './loader.js';
import { ModelCache } from './model-cache.js';
import { makeTestRequirement, testApp } from './test-app.js';
import { FAKE_OBJ, miniApp, miniReq, miniSpec, withFakeMj, withNaNControl } from './test-fixtures.js';
import { validateTrial } from './validate.js';

const COVERED: Record<string, string> = {
  'Req 1.7 all waiters reject with the same error': 'loader.test.ts',
  'Req 2.6 each invalid path form': 'file-writer.test.ts (+ Property 16)',
  'Req 2.10 missing scene file and empty record': 'file-writer.test.ts (+ Property 16)',
  'Req 3.5 failure leaves no entry': 'model-cache.test.ts',
  'Req 3.8 compile after dispose rejects': 'model-cache.test.ts',
  'Req 4.5 unknown or wrong-type name': 'context.test.ts',
  'Req 5.13/5.14/14.x validation errors': 'validate.test.ts',
  'Req 6.12 unknown template, 6.11 unknown dimension': 'validate.test.ts',
  'Req 7.13 throws in signals/apply/controller/monitor': 'episode.test.ts',
  'Req 9.14 hook returns a non-finite or non-number value': 'episode.test.ts',
  'Req 10.4 invalid buffer length': 'helpers.test.ts',
};

afterAll(() => __setLoadFnForTests(undefined));

describe('error catalogue', () => {
  it('lists the covering tests for conditions tested elsewhere', () => {
    expect(Object.keys(COVERED).length).toBeGreaterThan(0);
    for (const file of Object.values(COVERED)) expect(file).toMatch(/\.test\.ts/);
  });

  it('Req 1.5: a failed load names @mujoco/mujoco and the cause', async () => {
    __setLoadFnForTests(async () => { throw new Error('no wasm'); });
    const e = await loadMujoco().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SimError);
    expect((e as Error).message).toMatch(/@mujoco\/mujoco.*no wasm/);
    __setLoadFnForTests(undefined);
  });

  it('Req 2.9: an FS write failure names app id, path and cause', () => {
    const f = withFakeMj();
    f.fail.writeFile = new Error('quota');
    expect(() => writeRobotFiles(f.mj, { id: 'app9', sceneFile: 's.xml' }, { 's.xml': new Uint8Array(1) }))
      .toThrow(/app9.*s\.xml.*quota|s\.xml.*app9.*quota/);
  });

  it('Req 3.6: a compile failure names the app id and the compiler message', async () => {
    const f = withFakeMj();
    f.fail.fromXmlPath = new Error('XML Error: unknown element');
    const cache = new ModelCache({ load: async () => f.mj });
    await expect(cache.getModel(miniApp({ id: 'rob', files: async () => ({ 'scene.xml': new Uint8Array(1) }) })))
      .rejects.toThrow(/rob.*unknown element/);
  });

  it('Req 4.10: an empty name is rejected without a mj_name2id call', () => {
    const f = withFakeMj();
    expect(() => buildContext(f.mj, {}, {}, { site: [''] })).toThrow(/Empty site name/);
    expect(f.calls.name2id).toHaveLength(0);
    f.names[FAKE_OBJ.geom] = [];
    expect(() => buildContext(f.mj, {}, {}, { geom: ['g'] })).toThrow(/geom named "g"/);
  });

  it('Req 5.12: an app id mismatch names both ids', () => {
    expect(() => validateTrial(miniApp(), miniReq(), miniSpec({ app: 'zzz' }))).toThrow(/zzz.*mini/);
  });

  it('Req 6.5: an out-of-range scenario value names dimension, value and range in SI units', () => {
    expect(() => validateTrial(miniApp(), miniReq(), miniSpec({ scenario: { 'push.force': -5, 'push.angle': 0 } })))
      .toThrow(/push\.force = -5 N is outside \[0 N, 200 N\]/);
  });

  it('Req 7.11: divergence during warm-up rejects with the time in seconds and the trial identity', async () => {
    const cache = new ModelCache();
    const before = (await import('./handles.js')).liveHandleCount();
    const err: any = await runTrial(withNaNControl(testApp, 3), makeTestRequirement({ horizon: 0.2 }),
      { app: 'test', reqId: 'R1', scenario: { 'push.force': 0, 'push.angle': 0 }, seed: 11 }, { cache }).catch((e) => e);
    expect(err).toBeInstanceOf(SimError);
    expect(err.message).toMatch(/Trial failed \(app test, requirement R1, seed 11\): Simulation diverged during warm-up at t = [0-9.]+ s/);
    cache.dispose();
    expect((await import('./handles.js')).liveHandleCount()).toBe(before);
  });

  it('Req 9.14: a hook returning NaN is named in the message', async () => {
    const cache = new ModelCache();
    const err: any = await runTrial(testApp, makeTestRequirement({ horizon: 0.2 },),
      { app: 'test', reqId: 'R1', scenario: { 'push.force': 0, 'push.angle': 0 }, seed: 1 }, { cache, earlyStop: () => NaN }).catch((e) => e);
    expect(err.message).toMatch(/seed 1\): Early-stop hook returned NaN/);
    cache.dispose();
  });

  it('Req 10.4: an invalid buffer length names the length', () => {
    expect(() => withDoubleBuffer(withFakeMj().mj, 2.5, () => 0)).toThrow(/length 2\.5/);
  });
});
