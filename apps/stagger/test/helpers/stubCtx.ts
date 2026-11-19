import { DEFAULT_POSE } from '../../controller/observation';

/** A typed-array stand-in for MjData. */
export function stubCtx() {
  const qpos = new Float64Array(19); qpos[2] = 0.79; qpos[3] = 1;
  for (let j = 0; j < 12; j++) qpos[7 + j] = DEFAULT_POSE[j]!;
  return { mj: {}, model: {}, data: { qpos, qvel: new Float64Array(18), ctrl: new Float64Array(12), time: 0 }, ids: {} };
}
