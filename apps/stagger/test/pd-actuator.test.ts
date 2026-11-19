import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_POSE } from '../controller/observation';
import { KD, KP, pdTorque } from '../controller/pd';
import { compileRobot } from './helpers/mujoco';

const loaded = compileRobot();
afterAll(async () => { (await loaded).model.delete(); });

describe('PD actuators in the Robot_MJCF', () => {
  it('carry kp and kd of the deploy script', async () => {
    const { model } = await loaded;
    expect(model.nu).toBe(12);
    for (let j = 0; j < 12; j++) {
      expect(model.actuator_gainprm[10 * j]).toBe(KP[j]);
      expect(model.actuator_biasprm[10 * j + 1]).toBe(-KP[j]!);
      expect(model.actuator_biasprm[10 * j + 2]).toBe(-KD[j]!);
    }
  });
  it('apply (target - q) kp - qd kd with ctrl = target', async () => {
    const { mj, model } = await loaded;
    const data = new mj.MjData(model);
    try {
      for (let j = 0; j < 12; j++) { data.qpos[7 + j] = DEFAULT_POSE[j]! + 0.02 * Math.sin(j); data.qvel[6 + j] = 0.3 * Math.cos(j); }
      const target = Float64Array.from(DEFAULT_POSE, (v, j) => v + 0.05 * ((j % 3) - 1));
      data.ctrl.set(target);
      mj.mj_forward(model, data);
      const expected = new Float64Array(12);
      pdTorque(target, data.qpos.slice(7, 19), data.qvel.slice(6, 18), expected);
      for (let j = 0; j < 12; j++) expect(data.actuator_force[j]).toBeCloseTo(expected[j]!, 9);
    } finally { data.delete(); }
  });
  it('disable auto-reset so a divergence cannot hide behind a reset', async () => {
    const { mj, model } = await loaded;
    expect(model.opt.disableflags & mj.mjtDisableBit.mjDSBL_AUTORESET.value).not.toBe(0);
  });
});