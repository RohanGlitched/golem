import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_POSE } from '../controller/observation';
import { Walker } from '../controller/walker';
import stagger, { STANDING_POS, drawJointNoise, robotFileList, setRobotBase } from '../app';
import { lexicon } from '../lexicon';
import { allocations, functionBody } from './helpers/sourceScan';
import { stubModelCtx } from './helpers/stubModel';

const ROBOT = new URL('../robot/', import.meta.url);
afterEach(() => setRobotBase(ROBOT));

describe('stagger app definition', () => {
  it('has the id, name, timing and lexicon of the spec', () => {
    expect(stagger.id).toBe('stagger');
    expect(stagger.name).toBe('Stagger: Unitree G1');
    expect(stagger.sceneFile).toBe('scene.xml');
    expect([stagger.simDt, stagger.controlDt, stagger.warmup]).toEqual([0.002, 0.02, 2]);
    expect(stagger.lexicon).toBe(lexicon);
  });

  it('returns scene.xml, the MJCF, every referenced mesh and policy.bin from files()', async () => {
    const files = await stagger.files();
    expect(files['scene.xml']).toBeDefined();
    expect(files['g1_12dof.xml']).toBeDefined();
    expect(files['policy.bin']).toBeDefined();
    const mjcf = new TextDecoder().decode(files['g1_12dof.xml']);
    const meshdir = /meshdir="([^"]*)"/.exec(mjcf)?.[1] ?? '';
    const meshFiles = [...mjcf.matchAll(/<mesh [^>]*file="([^"]+)"/g)].map((m) => `${meshdir}${meshdir && !meshdir.endsWith('/') ? '/' : ''}${m[1]}`);
    expect(meshFiles.length).toBeGreaterThan(0);
    for (const m of meshFiles) expect([m, files[m] !== undefined]).toEqual([m, true]);
  });

  it('returns equal bytes on every files() call', async () => {
    const a = await stagger.files();
    const b = await stagger.files();
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    for (const k of Object.keys(a)) expect(Buffer.compare(a[k]!, b[k]!)).toBe(0);
  });

  it('rejects naming the file when a robot file is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stagger-'));
    try {
      writeFileSync(join(dir, 'SOURCE.json'), JSON.stringify({ commit: 'x', files: [{ upstream: 'a', local: 'g1_12dof.xml' }] }));
      writeFileSync(join(dir, 'scene.xml'), '<mujoco/>');
      writeFileSync(join(dir, 'policy.bin'), new Uint8Array(4));
      setRobotBase(pathToFileURL(dir + '/'));
      await expect(stagger.files()).rejects.toThrow('robot file g1_12dof.xml could not be read');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('lists every SOURCE.json file plus the generated files', () => {
    const src = new TextEncoder().encode(JSON.stringify({ files: [{ local: 'b.xml' }, { local: 'meshes/a.stl' }, { local: 'b.xml' }] }));
    expect(robotFileList(src)).toEqual(['SOURCE.json', 'b.xml', 'meshes/a.stl', 'policy.bin', 'scene.xml']);
  });

  it('draws exactly 12 values from rng in a fixed order in initState', () => {
    const { ctx } = stubModelCtx();
    const data = ctx.data as any;
    data.qpos = new Float64Array(19); data.qvel = new Float64Array(18).fill(3);
    (ctx.mj as any).mjtDisableBit = { mjDSBL_AUTORESET: { value: 1 << 15 } };
    (ctx.model.opt as any).disableflags = 0;
    const draws: number[] = [];
    const seq = [0.1, 0.7, 0.3, 0.9, 0.5, 0.2, 0.8, 0.4, 0.6, 0.05, 0.95, 0.35, 0.45];
    const rng = () => { const v = seq[draws.length]!; draws.push(v); return v; };
    stagger.initState!(ctx, rng);
    expect(draws).toHaveLength(12);
    const expected = drawJointNoise((() => { let i = 0; return () => seq[i++]!; })());
    for (let j = 0; j < 12; j++) expect(data.qpos[7 + j]).toBe(DEFAULT_POSE[j]! + expected[j]!);
    expect(Array.from(data.qpos.slice(0, 7))).toEqual([...STANDING_POS, 1, 0, 0, 0]);
    expect(Array.from(data.qvel).every((v) => v === 0)).toBe(true);
    expect((ctx.model.opt as any).disableflags & (1 << 15)).not.toBe(0);
  });

  it('draws Box-Muller normals with a 0.01 rad standard deviation', () => {
    let s = 1;
    const rng = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    let sum = 0, sum2 = 0;
    const N = 20000;
    for (let i = 0; i < N / 12; i++) for (const v of drawJointNoise(rng)) { sum += v; sum2 += v * v; }
    const n = 12 * Math.floor(N / 12);
    expect(Math.abs(sum / n)).toBeLessThan(0.0005);
    expect(Math.sqrt(sum2 / n)).toBeCloseTo(0.01, 3);
  });

  it('builds a Walker in makeController without drawing from rng', async () => {
    await stagger.files();
    const { ctx } = stubModelCtx();
    let draws = 0;
    const c = stagger.makeController(ctx, () => { draws++; return 0.5; });
    expect(c).toBeInstanceOf(Walker);
    expect(draws).toBe(0);
  });

  it('uses no Math.random and allocates nothing in setStandingPose', () => {
    expect(allocations(functionBody('app.ts', /export function setStandingPose\(/))).toEqual([]);
  });
});
