// One compiled Panda scene per test file, with forward kinematics for the tip.
import { Q_HOME } from '../../constants';
import { IkSolver, makeIkResult, type IkResult } from '../../controller/ik';
import { compileRobot } from './mujoco';

export interface PandaEnv {
  mj: any;
  model: any;
  site: number;
  /** Tip position and the z component of the tip axis (-1 when the cup points straight down). */
  fk(q: ArrayLike<number>): { p: [number, number, number]; tilt: number };
  solver: IkSolver;
  result: IkResult;
  jointRange: number[][];
}

export async function pandaEnv(): Promise<PandaEnv> {
  const { mj, model } = await compileRobot();
  const site: number = mj.mj_name2id(model, mj.mjtObj.mjOBJ_SITE.value, 'tip');
  const data = new mj.MjData(model);
  const range: Float64Array = model.jnt_range;
  const jointRange = Array.from({ length: 7 }, (_, j) => [range[2 * j] as number, range[2 * j + 1] as number]);
  return {
    mj, model, site, solver: new IkSolver(mj, model, site), result: makeIkResult(), jointRange,
    fk(q) {
      for (let j = 0; j < 7; j++) data.qpos[j] = q[j];
      mj.mj_kinematics(model, data);
      const p = data.site_xpos.slice(3 * site, 3 * site + 3) as Float64Array;
      const ax = data.site_xmat[9 * site + 2], ay = data.site_xmat[9 * site + 5];
      return { p: [p[0]!, p[1]!, p[2]!], tilt: Math.asin(Math.min(1, Math.hypot(ax, ay))) };
    },
  };
}

export const HOME = Float64Array.from(Q_HOME);
