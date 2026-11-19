// The 47-dimensional observation, laid out as Unitree's deploy_mujoco.py builds it.
import { OBS_DIM } from './policy.js';

/** Default joint angles (rad): hip pitch, hip roll, hip yaw, knee, ankle pitch, ankle roll; left then right. */
export const DEFAULT_POSE = new Float64Array([-0.1, 0, 0, 0.3, -0.2, 0, -0.1, 0, 0, 0.3, -0.2, 0]);
export const GAIT_PERIOD = 0.8;
export const ANG_VEL_SCALE = 0.25;
export const DOF_VEL_SCALE = 0.05;
export const CMD_SCALE = new Float64Array([2, 2, 0.25]);

/** (t mod 0.8 s) / 0.8 s, in [0, 1). */
export function gaitPhase(t: number): number {
  const p = (t % GAIT_PERIOD) / GAIT_PERIOD;
  return p < 0 ? p + 1 : p >= 1 ? 0 : p;
}

/**
 * Gravity direction in the pelvis frame from the quaternion (w, x, y, z), the upstream formula
 * (equal to R(q)^T (0, 0, -1) for a unit quaternion). Writes out[offset..offset+2].
 */
export function projectedGravity(quat: ArrayLike<number>, out: Float64Array, offset: number): void {
  const qw = quat[0] as number, qx = quat[1] as number, qy = quat[2] as number, qz = quat[3] as number;
  out[offset] = 2 * (-qz * qx + qw * qy);
  out[offset + 1] = -2 * (qz * qy + qw * qx);
  out[offset + 2] = 1 - 2 * (qw * qw + qz * qz);
}

/**
 * obs[0:3] = 0.25 qvel[3:6]; obs[3:6] = projected gravity of qpos[3:7]; obs[6:9] = command .* (2, 2, 0.25);
 * obs[9:21] = qpos[7:19] - DEFAULT_POSE; obs[21:33] = 0.05 qvel[6:18]; obs[33:45] = previous action;
 * obs[45], obs[46] = sin, cos of 2 pi gaitPhase(time). Allocates nothing.
 */
export function buildObservation(
  qpos: ArrayLike<number>, qvel: ArrayLike<number>, command: ArrayLike<number>,
  previousAction: ArrayLike<number>, time: number, out: Float64Array,
): void {
  if (out.length !== OBS_DIM) throw new Error(`observation buffer has length ${out.length}, expected ${OBS_DIM}`);
  for (let i = 0; i < 3; i++) out[i] = ANG_VEL_SCALE * (qvel[3 + i] as number);
  // projectedGravity, inlined to read the quaternion at qpos[3:7] without a subarray
  const qw = qpos[3] as number, qx = qpos[4] as number, qy = qpos[5] as number, qz = qpos[6] as number;
  out[3] = 2 * (-qz * qx + qw * qy);
  out[4] = -2 * (qz * qy + qw * qx);
  out[5] = 1 - 2 * (qw * qw + qz * qz);
  for (let i = 0; i < 3; i++) out[6 + i] = (command[i] as number) * (CMD_SCALE[i] as number);
  for (let j = 0; j < 12; j++) {
    out[9 + j] = (qpos[7 + j] as number) - (DEFAULT_POSE[j] as number);
    out[21 + j] = DOF_VEL_SCALE * (qvel[6 + j] as number);
    out[33 + j] = previousAction[j] as number;
  }
  const phase = gaitPhase(time);
  out[45] = Math.sin(2 * Math.PI * phase);
  out[46] = Math.cos(2 * Math.PI * phase);
}