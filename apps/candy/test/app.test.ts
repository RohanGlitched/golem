import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildContext, mulberry32 } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import candy, { INIT_DRAWS, MISSING_ASSETS, parkInactive, robotFileList, setRobotBase } from '../app';
import { CANDY_HALF_HEIGHT, CONTROL_DT, D_OV, PARK, Q_HOME, SIM_DT, TRAY, UD, WARMUP } from '../constants';
import { CANDY_NAMES, candyIds } from '../controller/ids';
import { lexicon } from '../lexicon';
import { compileRobot, robotFiles } from './helpers/mujoco';

const { mj, model } = await compileRobot();
afterAll(() => { model.delete(); });

function fresh() {
  const data = new mj.MjData(model);
  const ctx = buildContext(mj, model, data, CANDY_NAMES as never);
  return { data, ctx };
}

describe('RobotApp fields', () => {
  it('is the candy app with the scene, the timesteps and the lexicon of the requirements', () => {
    expect(candy.id).toBe('candy');
    expect(candy.name).toBe('Candy sorter (Franka Panda)');
    expect(candy.sceneFile).toBe('scene.xml');
    expect(candy.simDt).toBe(SIM_DT);
    expect(candy.simDt).toBe(0.002);
    expect(candy.controlDt).toBe(CONTROL_DT);
    expect(candy.controlDt).toBe(0.02);
    expect(candy.warmup).toBe(WARMUP);
    expect(candy.warmup).toBe(1.0);
    expect(candy.lexicon).toBe(lexicon);
  });
  it('asks the runner to resolve every name the controller and the signals use', () => {
    expect(candy.names!.site).toEqual(['tip']);
    expect(candy.names!.actuator).toHaveLength(7);
    expect(candy.names!.body).toContain('hand');
    expect(candy.names!.geom).toEqual(['table', 'hand_palm', 'hand_forearm']);
  });
});

describe('files()', () => {
  it('returns every file of robot/ as bytes, keyed by its path under /robot', async () => {
    const files = await candy.files();
    const disk = robotFiles();
    expect(Object.keys(files).sort()).toEqual(Object.keys(disk).sort());
    for (const k of ['scene.xml', 'panda.xml', 'LICENSE', 'SOURCE.json']) expect(files[k]).toBeInstanceOf(Uint8Array);
    expect(Object.keys(files).filter((k) => k.startsWith('assets/') && k.endsWith('.obj')).length).toBeGreaterThan(50);
    for (const [k, v] of Object.entries(files)) expect(Buffer.from(v).equals(Buffer.from(disk[k]!)), k).toBe(true);
  });
  it('lists the files from the manifest', () => {
    const list = robotFileList(new TextEncoder().encode(JSON.stringify({ outputs: { 'b.obj': 'x', 'a.xml': 'y' } })));
    expect(list).toEqual(['SOURCE.json', 'a.xml', 'b.obj']);
  });
  it('rejects with "Assets are missing from robot/: run node scripts/fetch-assets.mjs." when robot/ is empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'candy-empty-'));
    const original = new URL('../robot/', import.meta.url);
    try {
      setRobotBase(pathToFileURL(dir + '/'));
      await expect(candy.files()).rejects.toThrow(MISSING_ASSETS);
      expect(MISSING_ASSETS).toBe('Assets are missing from robot/: run node scripts/fetch-assets.mjs.');
    } finally {
      setRobotBase(original);
      await rm(dir, { recursive: true, force: true });
    }
    expect(Object.keys(await candy.files())).toContain('scene.xml');
  });
});

describe('initState', () => {
  it('draws exactly 18 values from the PRNG', () => {
    const { data, ctx } = fresh();
    try {
      let n = 0;
      const rng = mulberry32(5);
      candy.initState!(ctx, () => { n++; return rng(); });
      expect(n).toBe(18);
      expect(INIT_DRAWS).toBe(18);
    } finally { data.delete(); }
  });
  it('puts the Panda at the Home_Pose with matching controls, and writes the userdata defaults', () => {
    const { data, ctx } = fresh();
    try {
      candy.initState!(ctx, mulberry32(1));
      for (let j = 0; j < 7; j++) { expect(data.qpos[j]).toBe(Q_HOME[j]); expect(data.ctrl[j]).toBe(Q_HOME[j]); }
      expect(data.userdata[UD.vacuum]).toBe(1);
      expect(data.userdata[UD.lag]).toBe(0);
      expect(data.userdata[UD.count]).toBe(6);
      expect(data.userdata[UD.switch]).toBe(0);
    } finally { data.delete(); }
  });
  it('places six candies on the tray, at least 0.036 m apart, with colours 0, 1 or 2', () => {
    const { data, ctx } = fresh();
    try {
      candy.initState!(ctx, mulberry32(77));
      const ids = candyIds(ctx);
      const p = Array.from({ length: 6 }, (_, i) => [data.qpos[ids.candyQpos[i]!], data.qpos[ids.candyQpos[i]! + 1], data.qpos[ids.candyQpos[i]! + 2]] as number[]);
      for (let i = 0; i < 6; i++) {
        expect(p[i]![0]).toBeGreaterThanOrEqual(TRAY.xMin); expect(p[i]![0]).toBeLessThanOrEqual(TRAY.xMax);
        expect(p[i]![1]).toBeGreaterThanOrEqual(TRAY.yMin); expect(p[i]![1]).toBeLessThanOrEqual(TRAY.yMax);
        expect(p[i]![2]).toBe(CANDY_HALF_HEIGHT[i]);
        expect([0, 1, 2]).toContain(data.userdata[UD.colour + i]);
        for (let j = 0; j < i; j++) expect(Math.hypot(p[i]![0]! - p[j]![0]!, p[i]![1]! - p[j]![1]!)).toBeGreaterThanOrEqual(D_OV - 1e-12);
      }
    } finally { data.delete(); }
  });
  it('gives equal states for equal seeds and different states for different seeds', () => {
    const a = fresh(), b = fresh(), c = fresh();
    try {
      candy.initState!(a.ctx, mulberry32(9)); candy.initState!(b.ctx, mulberry32(9)); candy.initState!(c.ctx, mulberry32(10));
      expect(Array.from(a.data.qpos)).toEqual(Array.from(b.data.qpos));
      expect(Array.from(a.data.userdata)).toEqual(Array.from(b.data.userdata));
      expect(Array.from(a.data.qpos)).not.toEqual(Array.from(c.data.qpos));
    } finally { a.data.delete(); b.data.delete(); c.data.delete(); }
  });
  it('parks candies beyond the active count on the floor, out of the way', () => {
    const { data, ctx } = fresh();
    try {
      candy.initState!(ctx, mulberry32(3));
      data.userdata[UD.count] = 2;
      parkInactive(ctx);
      const ids = candyIds(ctx);
      for (let i = 2; i < 6; i++) {
        expect(data.qpos[ids.candyQpos[i]!]).toBeCloseTo(PARK.x + PARK.dx * i, 12);
        expect(data.qpos[ids.candyQpos[i]! + 2]).toBe(PARK.z);
      }
      expect(data.qpos[ids.candyQpos[1]! + 2]).toBe(CANDY_HALF_HEIGHT[1]);
    } finally { data.delete(); }
  });
});
