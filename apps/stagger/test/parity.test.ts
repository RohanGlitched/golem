// Parity with the Python reference (Requirement 9). The fixture values are never edited.
import { readFileSync } from 'node:fs';
import { buildContext } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import stagger, { STANDING_POS, setStandingPose } from '../app';
import { runtimeFor } from '../runtime';
import { getMj } from './helpers/mujoco';

interface Fixture { noise: number[]; basePos: number[]; command: number[]; duration: number; pelvis: number[]; tolerance: number }
const fx = JSON.parse(readFileSync(new URL('./fixtures/parity.json', import.meta.url), 'utf8')) as Fixture;

async function loadModel() {
  const mj = await getMj();
  const files = await stagger.files();
  for (const [p, b] of Object.entries(files)) {
    const dir = p.includes('/') ? `/robot/${p.slice(0, p.lastIndexOf('/'))}` : '/robot';
    mj.FS.mkdirTree(dir);
    mj.FS.writeFile(`/robot/${p}`, b);
  }
  return { mj, model: mj.MjModel.from_xml_path('/robot/scene.xml') };
}
const loaded = loadModel();
afterAll(async () => { (await loaded).model.delete(); });

/** Runs the deploy-script schedule for fx.duration and returns the pelvis position. */
async function runParity(): Promise<Float64Array> {
  const { mj, model } = await loaded;
  const data = new mj.MjData(model);
  try {
    const ctx = buildContext(mj, model, data, stagger.names);
    setStandingPose(ctx, fx.noise);
    runtimeFor(ctx).command.set(fx.command);
    const walker = stagger.makeController(ctx, () => { throw new Error('the parity run draws nothing from rng'); });
    const controlSteps = Math.round(fx.duration / stagger.controlDt);
    const n = Math.round(stagger.controlDt / stagger.simDt);
    for (let k = 0; k < controlSteps; k++) {
      walker.step(ctx, k * stagger.controlDt);
      for (let j = 0; j < n; j++) mj.mj_step(model, data);
    }
    // the free joint position is the pelvis origin after the last step (xpos lags one step behind)
    return Float64Array.from(data.qpos.subarray(0, 3));
  } finally { data.delete(); }
}

function report(p: ArrayLike<number>): string {
  const ax = ['x', 'y', 'z'];
  return ax.map((a, i) => `${a}: observed ${p[i]!.toFixed(6)} m, reference ${fx.pelvis[i]!.toFixed(5)} m, difference ${(p[i]! - fx.pelvis[i]!).toExponential(3)} m`).join('\n');
}

describe('parity with the Python reference', () => {
  it('uses the fixture start pose and command', () => {
    expect([...STANDING_POS]).toEqual(fx.basePos);
    expect(fx.command).toEqual([0.5, 0, 0]);
    expect(fx.tolerance).toBe(1e-3);
  });

  it('places the pelvis within 1e-3 m of the reference after 2 s', async () => {
    const t0 = performance.now();
    const p = await runParity();
    const ms = performance.now() - t0;
    console.log(`parity after ${fx.duration} s (${ms.toFixed(0)} ms wall):\n${report(p)}`);
    const ok = [0, 1, 2].every((i) => Math.abs(p[i]! - fx.pelvis[i]!) <= fx.tolerance);
    expect(ok, `pelvis position differs from the Python reference:\n${report(p)}`).toBe(true);
    expect(ms).toBeLessThan(10000);
  });

  it('gives a bit-identical pelvis position on a second run', async () => {
    const a = await runParity();
    const b = await runParity();
    expect(Array.from(b)).toEqual(Array.from(a));
  });
});
