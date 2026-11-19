// Action mapping and PD law of Unitree's deploy script (configs/g1.yaml).
//
// The law ctrl = (target - q) * kp - qd * kd must be evaluated at every 2 ms Sim_Step. golem-sim
// calls the controller once per 20 ms Control_Step and never between Sim_Steps, so the Robot_MJCF
// declares each leg actuator as a MuJoCo PD actuator (gainprm kp, biasprm 0 -kp -kd): MuJoCo then
// computes force = kp * ctrl - kp * q - kd * qd at every Sim_Step, with ctrl = target. `pdTorque` is
// the same law as a pure function; test/pd-actuator.test.ts checks the model against it.
import { DEFAULT_POSE } from './observation.js';

export const KP = new Float64Array([100, 100, 100, 150, 40, 40, 100, 100, 100, 150, 40, 40]);
export const KD = new Float64Array([2, 2, 2, 4, 2, 2, 2, 2, 2, 4, 2, 2]);
export const ACTION_SCALE = 0.25;

/** target = action * 0.25 + DEFAULT_POSE */
export function actionToTarget(action: ArrayLike<number>, target: Float64Array): void {
  for (let j = 0; j < 12; j++) target[j] = (action[j] as number) * ACTION_SCALE + (DEFAULT_POSE[j] as number);
}

/** ctrl = (target - q) * kp - qd * kd, in N·m. */
export function pdTorque(target: ArrayLike<number>, q: ArrayLike<number>, qd: ArrayLike<number>, ctrl: Float64Array): void {
  for (let j = 0; j < 12; j++) {
    ctrl[j] = ((target[j] as number) - (q[j] as number)) * (KP[j] as number) - (qd[j] as number) * (KD[j] as number);
  }
}