// The robot folder: pinned, complete, and in agreement with the constants and the controller's assumptions.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import * as script from '../scripts/fetch-assets.mjs';
import { robotFileList } from '../app';
import { GRAVITY, HOVER_POINT, INERTIA, MASS, SIM_DT, THRUST_MAX } from '../constants';
import { compileRobot, robotFiles } from './helpers/mujoco';

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const files = robotFiles();
const source = JSON.parse(readFileSync(new URL('../robot/SOURCE.json', import.meta.url), 'utf8'));

describe('robot/SOURCE.json', () => {
  it('records the pinned Menagerie commit from the project rules', () => {
    expect(source.commit).toBe('370c43965323c0944b433b202aac5058b5f907a9');
    expect(source.commit).toBe(script.COMMIT);
    expect(source.folder).toBe('skydio_x2');
  });
  it('lists every file of robot/ except itself, each with the SHA-256 of the bytes on disk', () => {
    expect(Object.keys(source.outputs).sort()).toEqual(Object.keys(files).filter((k) => k !== 'SOURCE.json').sort());
    for (const [path, hash] of Object.entries<string>(source.outputs)) expect(sha(files[path]!), path).toBe(hash);
  });
  it('lists the upstream files separately from the file we generate', () => {
    expect(Object.keys(source.sources).sort()).toEqual(['LICENSE', 'assets/X2_lowpoly.obj', 'assets/X2_lowpoly_texture_SpinningProps_1024.png', 'x2.xml']);
    expect(Object.keys(source.generated)).toEqual(['scene.xml']);
    expect(source.sources).toEqual(script.SOURCES);
  });
  it('is what the app reads: robotFileList gives the outputs plus SOURCE.json, sorted', () => {
    const list = robotFileList(new Uint8Array(readFileSync(new URL('../robot/SOURCE.json', import.meta.url))));
    expect(list).toEqual([...Object.keys(source.outputs), 'SOURCE.json'].sort());
    expect(list).toEqual(Object.keys(files).sort());
  });
});

describe('scripts/fetch-assets.mjs', () => {
  it('writes the scene.xml that is on disk', () => {
    expect(Buffer.from(files['scene.xml']!).toString('utf8')).toBe(script.sceneXml());
    expect(source.outputs['scene.xml']).toBe(sha(new TextEncoder().encode(script.sceneXml())));
  });
  it('agrees with constants.ts on the hover point and the timestep', () => {
    expect(script.HOVER_POINT).toEqual(HOVER_POINT);
    expect(script.SIM_DT).toBe(SIM_DT);
  });
  it('reports "Assets are current." without network access', () => {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/fetch-assets.mjs', import.meta.url)), '--check'], { encoding: 'utf8' });
    expect(run.stdout).toContain('Assets are current.');
    expect(run.status).toBe(0);
  });
  it('keeps the upstream model file and licence byte for byte', () => {
    expect(sha(files['x2.xml']!)).toBe(script.SOURCES['x2.xml']);
    expect(sha(files['LICENSE']!)).toBe(script.SOURCES['LICENSE']);
  });
});

const { mj, model } = await compileRobot();
afterAll(() => { model.delete(); });
const id = (type: string, name: string): number => mj.mj_name2id(model, mj.mjtObj[type].value, name);

describe('the compiled model', () => {
  it('uses the finer timestep of the scene and keeps the four thrust motors', () => {
    expect(model.opt.timestep).toBe(SIM_DT);
    expect(model.nu).toBe(4);
    for (let i = 1; i <= 4; i++) expect(id('mjOBJ_ACTUATOR', `thrust${i}`)).toBe(i - 1);
  });
  it('has the mass, the inertia and the thrust limit that constants.ts gives the controller', () => {
    const b = id('mjOBJ_BODY', 'x2');
    expect(model.body_mass[b]).toBeCloseTo(MASS, 9);
    for (let a = 0; a < 4; a++) { expect(model.actuator_ctrlrange[2 * a]).toBe(0); expect(model.actuator_ctrlrange[2 * a + 1]).toBe(THRUST_MAX); }
    // the body-frame inertia: R diag(principal) R^T with R from body_iquat
    const q = Array.from(model.body_iquat.slice(4 * b, 4 * b + 4)) as number[];
    const d = Array.from(model.body_inertia.slice(3 * b, 3 * b + 3)) as number[];
    const [w, x, y, z] = q as [number, number, number, number];
    const R = [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]] as const;
    const diag = [0, 1, 2].map((i) => [0, 1, 2].reduce((s, k) => s + R[i]![k]! * R[i]![k]! * d[k]!, 0));
    expect(diag[0]).toBeCloseTo(INERTIA.x, 3);
    expect(diag[1]).toBeCloseTo(INERTIA.y, 3);
    expect(diag[2]).toBeCloseTo(INERTIA.z, 3);
  });
  it('hovers when the four motors together carry the weight: 4 x 13 N is about four times the weight', () => {
    expect(4 * THRUST_MAX / (MASS * GRAVITY)).toBeGreaterThan(3.9);
    expect(Math.abs(model.opt.gravity[2] as number)).toBeCloseTo(GRAVITY, 9);
  });
  it('puts everything the studio draws in geom group 2, and the collision proxies in group 3', () => {
    const outside: string[] = [];
    for (let g = 0; g < model.ngeom; g++) {
      const group = model.geom_group[g] as number;
      if (group !== 2 && group !== 3) outside.push(`${mj.mj_id2name(model, mj.mjtObj.mjOBJ_GEOM.value, g)} (group ${group})`);
    }
    expect(outside).toEqual([]);
    for (const n of ['floor', 'hover_marker', 'hover_post']) expect(model.geom_group[id('mjOBJ_GEOM', n)], n).toBe(2);
  });
  it('puts the hover marker at the hover point and lets nothing collide with it', () => {
    const g = id('mjOBJ_GEOM', 'hover_marker');
    expect(Array.from(model.geom_pos.slice(3 * g, 3 * g + 3))).toEqual([HOVER_POINT.x, HOVER_POINT.y, HOVER_POINT.z]);
    expect(model.geom_contype[g]).toBe(0);
    expect(model.geom_conaffinity[g]).toBe(0);
    expect(model.geom_contype[id('mjOBJ_GEOM', 'hover_post')]).toBe(0);
  });
});
