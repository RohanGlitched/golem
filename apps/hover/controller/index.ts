// HoverController: a cascaded PD controller that holds the X2 at the hover point.
//
//   estimate -> position PID -> desired force -> attitude PD -> torques -> mixer -> four motor thrusts
//
// The position estimate may lag the true state (the `estimate lag` perturbation); the attitude loop reads the gyro and
// the orientation directly, as an onboard IMU would. The controller runs once per Control_Step (100 Hz) and holds its
// motor commands over the five Sim_Steps in between.
import { CONTROL_DT, HOVER_POINT } from '../constants';
import type { Controller, SimContext } from '../contract';
import { runtimeFor } from '../runtime';
import { DELAY_WIDTH, DelayLine } from './delay';
import { GAINS, attitudeOf, attitudeTorque, desiredAcceleration, desiredForce, makeAttitude, totalThrust } from './law';
import { makeMixer, mix, type Mixer } from './mixer';

const MOTORS = ['thrust1', 'thrust2', 'thrust3', 'thrust4'] as const;

/** Reads the mixer geometry from the model: site positions and the yaw gear of each thrust actuator. */
export function mixerFromModel(ctx: SimContext): Mixer {
  const sitePos: Float64Array = ctx.model.site_pos;
  const gear: Float64Array = ctx.model.actuator_gear;
  const x: number[] = [], y: number[] = [], g: number[] = [];
  for (const name of MOTORS) {
    const s = ctx.ids[`site:${name}`], a = ctx.ids[`actuator:${name}`];
    if (s === undefined || a === undefined) throw new Error(`${name} is not resolved in ctx.ids; add it to app.names`);
    x.push(sitePos[3 * s] as number); y.push(sitePos[3 * s + 1] as number);
    g.push(gear[6 * a + 5] as number / (gear[6 * a + 2] as number));
  }
  return makeMixer(x, y, g);
}

export class HoverController implements Controller {
  private readonly mixer: Mixer;
  private readonly actuator: Int32Array;
  private readonly delay = new DelayLine();
  private readonly sample = new Float64Array(DELAY_WIDTH);
  private readonly est = new Float64Array(DELAY_WIDTH);
  private readonly error = new Float64Array(3);
  private readonly velocity = new Float64Array(3);
  private readonly integral = new Float64Array(3);
  private readonly accel = new Float64Array(3);
  private readonly force = new Float64Array(3);
  private readonly torque = new Float64Array(3);
  private readonly rates = new Float64Array(3);
  private readonly thrusts = new Float64Array(4);
  private readonly attitude = makeAttitude();

  constructor(ctx: SimContext) {
    this.mixer = mixerFromModel(ctx);
    this.actuator = Int32Array.from(MOTORS, (name) => ctx.ids[`actuator:${name}`] as number);
  }

  step(ctx: SimContext, _t: number): void {
    const rt = runtimeFor(ctx);
    const qpos = rt.qpos, qvel = rt.qvel;
    const s = this.sample;
    s[0] = qpos[0] as number; s[1] = qpos[1] as number; s[2] = qpos[2] as number;
    s[3] = qvel[0] as number; s[4] = qvel[1] as number; s[5] = qvel[2] as number;
    this.delay.push(s);
    this.delay.read(rt.lag, this.est);

    const e = this.est;
    this.error[0] = HOVER_POINT.x - (e[0] as number);
    this.error[1] = HOVER_POINT.y - (e[1] as number);
    this.error[2] = HOVER_POINT.z - (e[2] as number);
    for (let i = 0; i < 3; i++) {
      this.velocity[i] = e[3 + i] as number;
      const ki = (i < 2 ? GAINS.horizontal : GAINS.vertical).ki;
      const limit = GAINS.integralLimit / ki;       // anti-windup: the state stops where the contribution stops
      const next = (this.integral[i] as number) + (this.error[i] as number) * CONTROL_DT;
      this.integral[i] = next > limit ? limit : next < -limit ? -limit : next;
    }
    desiredAcceleration(this.accel, this.error, this.velocity, this.integral);
    desiredForce(this.force, this.accel);

    attitudeOf(qpos, 3, this.attitude);
    this.rates[0] = qvel[3] as number; this.rates[1] = qvel[4] as number; this.rates[2] = qvel[5] as number;
    attitudeTorque(this.torque, this.attitude, this.force, this.rates);
    mix(this.mixer, totalThrust(this.attitude, this.force), this.torque[0] as number, this.torque[1] as number, this.torque[2] as number, this.thrusts);
    for (let m = 0; m < 4; m++) rt.ctrl[this.actuator[m] as number] = this.thrusts[m] as number;
  }
}
