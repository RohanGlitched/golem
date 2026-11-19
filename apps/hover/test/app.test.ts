import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import fc from 'fast-check';
import { buildContext, mulberry32 } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import hover, { INIT_DRAWS, MISSING_ASSETS, robotFileList, setRobotBase } from '../app';
import { CONTROL_DT, HOVER_NAMES, HOVER_POINT, SIM_DT, START_OFFSET, WARMUP } from '../constants';
import { lexicon } from '../lexicon';
import { runtimeFor } from '../runtime';
import { compileRobot, robotFiles } from './helpers/mujoco';

const { mj, model } = await compileRobot();
afterAll(() => { model.delete(); });

function fresh() {
  const data = new mj.MjData(model);
  const ctx = buildContext(mj, model, data, HOVER_NAMES as never);
  return { data, ctx };
}

describe('RobotApp fields', () => {
  it('is the hover app with the scene, the timesteps and the lexicon of the requirements', () => {
    expect(hover.id).toBe('hover');
    expect(hover.sceneFile).toBe('scene.xml');
    expect(hover.simDt).toBe(SIM_DT);
    expect(hover.controlDt).toBe(CONTROL_DT);
    expect(hover.warmup).toBe(WARMUP);
    expect(hover.lexicon).toBe(lexicon);
  });
  it('runs a whole number of Sim_Steps in every Control_Step, and the model has the same timestep', () => {
    const n = hover.controlDt / hover.simDt;
    expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-9);
    expect(model.opt.timestep).toBe(hover.simDt);
  });
  it('asks the runner to resolve every name the controller and the perturbations use', () => {
    expect(hover.names!.body).toEqual(['x2']);
    expect(hover.names!.actuator).toHaveLength(4);
    expect(hover.names!.site).toHaveLength(4);
  });
});

describe('files()', () => {
  it('returns every file of robot/ as bytes, keyed by its path under /robot', async () => {
    const files = await hover.files();
    const disk = robotFiles();
    expect(Object.keys(files).sort()).toEqual(Object.keys(disk).sort());
    for (const k of ['scene.xml', 'x2.xml', 'LICENSE', 'SOURCE.json', 'assets/X2_lowpoly.obj']) expect(files[k]).toBeInstanceOf(Uint8Array);
    for (const [k, v] of Object.entries(files)) expect(Buffer.from(v).equals(Buffer.from(disk[k]!)), k).toBe(true);
  });
  it('lists the files from the manifest', () => {
    const list = robotFileList(new TextEncoder().encode(JSON.stringify({ outputs: { 'b.obj': 'x', 'a.xml': 'y' } })));
    expect(list).toEqual(['SOURCE.json', 'a.xml', 'b.obj']);
  });
  it('rejects with the "Assets are missing" message when robot/ is empty, and recovers when the base is set back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hover-empty-'));
    const original = new URL('../robot/', import.meta.url);
    try {
      setRobotBase(pathToFileURL(dir + '/'));
      await expect(hover.files()).rejects.toThrow(MISSING_ASSETS);
      expect(MISSING_ASSETS).toBe('Assets are missing from robot/: run node scripts/fetch-assets.mjs.');
    } finally {
      setRobotBase(original);
      await rm(dir, { recursive: true, force: true });
    }
    expect(Object.keys(await hover.files())).toContain('scene.xml');
  });
});

describe('initState', () => {
  it('draws exactly three values from the PRNG', () => {
    const { data, ctx } = fresh();
    try {
      let n = 0;
      const rng = mulberry32(5);
      hover.initState!(ctx, () => { n++; return rng(); });
      expect(n).toBe(INIT_DRAWS);
      expect(INIT_DRAWS).toBe(3);
    } finally { data.delete(); }
  });
  it('puts the drone level and at rest within START_OFFSET of the hover point on each axis, for any seed', () => {
    const { data, ctx } = fresh();
    try {
      const { qpos, qvel } = runtimeFor(ctx);
      fc.assert(fc.property(fc.integer({ min: 0, max: 4294967295 }), (seed) => {
        qvel.fill(1);
        hover.initState!(ctx, mulberry32(seed));
        expect(Math.abs(qpos[0]! - HOVER_POINT.x)).toBeLessThanOrEqual(START_OFFSET);
        expect(Math.abs(qpos[1]! - HOVER_POINT.y)).toBeLessThanOrEqual(START_OFFSET);
        expect(Math.abs(qpos[2]! - HOVER_POINT.z)).toBeLessThanOrEqual(START_OFFSET);
        expect(Array.from(qpos.slice(3, 7))).toEqual([1, 0, 0, 0]);
        expect(Array.from(qvel)).toEqual(new Array(6).fill(0));
      }), { numRuns: 100 });
    } finally { data.delete(); }
  });
  it('gives equal states for equal seeds and different states for different seeds', () => {
    const a = fresh(), b = fresh(), c = fresh();
    try {
      hover.initState!(a.ctx, mulberry32(9)); hover.initState!(b.ctx, mulberry32(9)); hover.initState!(c.ctx, mulberry32(10));
      expect(Array.from(a.data.qpos)).toEqual(Array.from(b.data.qpos));
      expect(Array.from(a.data.qpos)).not.toEqual(Array.from(c.data.qpos));
    } finally { a.data.delete(); b.data.delete(); c.data.delete(); }
  });
});
