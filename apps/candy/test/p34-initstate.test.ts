// Feature: candy-app, Property 34: initState is deterministic
import fc from 'fast-check';
import { buildContext, mulberry32 } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import candy from '../app';
import { Q_HOME } from '../constants';
import { UD } from '../constants';
import { CANDY_NAMES } from '../controller/ids';
import { compileRobot } from './helpers/mujoco';

const { mj, model } = await compileRobot();
afterAll(() => { model.delete(); });

function run(seed: number) {
  const data = new mj.MjData(model);
  const ctx = buildContext(mj, model, data, CANDY_NAMES as never);
  let draws = 0;
  const rng = mulberry32(seed);
  candy.initState!(ctx, () => { draws++; return rng(); });
  const out = { qpos: Float64Array.from(data.qpos), qvel: Float64Array.from(data.qvel), ud: Float64Array.from(data.userdata), ctrl: Float64Array.from(data.ctrl), draws };
  data.delete();
  return out;
}

describe('initState', () => {
  it('gives bit-identical qpos and userdata for equal seeds, draws exactly 18 values, homes the Panda and picks colours in {0, 1, 2}', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 4294967295 }), (seed) => {
      const a = run(seed), b = run(seed);
      expect(a.draws).toBe(18);
      expect(b.draws).toBe(18);
      for (const k of ['qpos', 'qvel', 'ud', 'ctrl'] as const) {
        expect(Array.from(a[k]).map((v, i) => Object.is(v, b[k][i]))).not.toContain(false);
      }
      for (let j = 0; j < 7; j++) expect(a.qpos[j]).toBe(Q_HOME[j]);
      for (let i = 0; i < 6; i++) expect([0, 1, 2]).toContain(a.ud[UD.colour + i]);
      expect(a.ud[UD.vacuum]).toBe(1);
      expect(a.ud[UD.lag]).toBe(0);
      expect(a.ud[UD.count]).toBe(6);
    }), { numRuns: 100 });
  });

  it('reads the PRNG in a fixed order: x, y and colour of candy 0, then candy 1, and so on', () => {
    const data = new mj.MjData(model);
    try {
      const ctx = buildContext(mj, model, data, CANDY_NAMES as never);
      const seq = [0.5, 0.5, 0.0, 0.5, 0.5, 0.5, ...Array(12).fill(0.99)];
      let k = 0;
      candy.initState!(ctx, () => seq[k++]!);
      expect(data.qpos[7]).toBeCloseTo(0.35 + 0.04 * 0.5, 12);        // candy 0 x
      expect(data.qpos[8]).toBeCloseTo(-0.13 + 0.26 * 0.5, 12);       // candy 0 y
      expect(data.userdata[UD.colour]).toBe(0);                        // colour from the third draw
      expect(data.userdata[UD.colour + 1]).toBe(1);                    // 0.5 -> floor(1.5)
      expect(data.userdata[UD.colour + 2]).toBe(2);                    // 0.99 -> floor(2.97)
    } finally { data.delete(); }
  });
});
