// The cascaded control law, as plain functions of numbers. Three stages:
//   1. position  : position error, velocity and an integral -> a desired acceleration
//   2. attitude  : the thrust direction that acceleration needs -> body torques (PD on tilt and body rates)
//   3. mixing    : total thrust and three torques -> the four motor thrusts   (controller/mixer.ts)
// Nothing here allocates: results go into the arrays that the caller passes.
import { GRAVITY, INERTIA, MASS } from '../constants';

export const GAINS = {
  /** Position loop: acceleration (m/s^2) per metre, per m/s, and per m*s of integrated error. Horizontal, then vertical. */
  horizontal: { kp: 6, kd: 5, ki: 1.5 },
  vertical: { kp: 20, kd: 9, ki: 10 },
  /** The integral term may add at most this much acceleration (m/s^2) on one axis: anti-windup. */
  integralLimit: 12,
  /** Attitude loop: angular acceleration (rad/s^2) per radian of tilt error and per rad/s of body rate. */
  attitude: { kp: 120, kd: 18 },
  /** Yaw is held at 0 with a softer pair. */
  yaw: { kp: 20, kd: 8 },
  /** Largest tilt the position loop may ask for (rad): 35 degrees. */
  tiltLimit: (35 * Math.PI) / 180,
} as const;

/** Rotation matrix entries of the quaternion (w, x, y, z) at `q[o..o+3]`, that this controller reads. */
export interface Attitude { r00: number; r10: number; r02: number; r12: number; r22: number; r01: number; r11: number; r21: number; r20: number }

/** Fills `a` from a quaternion (w, x, y, z); the quaternion need not be exactly unit length. */
export function attitudeOf(q: ArrayLike<number>, o: number, a: Attitude): void {
  const w = q[o] as number, x = q[o + 1] as number, y = q[o + 2] as number, z = q[o + 3] as number;
  const n = w * w + x * x + y * y + z * z;
  const s = n > 0 ? 2 / n : 0;
  a.r00 = 1 - s * (y * y + z * z); a.r01 = s * (x * y - w * z); a.r02 = s * (x * z + w * y);
  a.r10 = s * (x * y + w * z); a.r11 = 1 - s * (x * x + z * z); a.r12 = s * (y * z - w * x);
  a.r20 = s * (x * z - w * y); a.r21 = s * (y * z + w * x); a.r22 = 1 - s * (x * x + y * y);
}

export const makeAttitude = (): Attitude => ({ r00: 1, r10: 0, r02: 0, r12: 0, r22: 1, r01: 0, r11: 1, r21: 0, r20: 0 });

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Desired acceleration (m/s^2), without gravity: `kp * error - kd * velocity + ki * integral` on each axis. `error` is
 * the hover point minus the estimated position. The integral contribution is limited to `GAINS.integralLimit`.
 */
export function desiredAcceleration(out: Float64Array, error: ArrayLike<number>, velocity: ArrayLike<number>, integral: ArrayLike<number>): void {
  for (let i = 0; i < 3; i++) {
    const g = i < 2 ? GAINS.horizontal : GAINS.vertical;
    const i_term = clamp(g.ki * (integral[i] as number), -GAINS.integralLimit, GAINS.integralLimit);
    out[i] = g.kp * (error[i] as number) - g.kd * (velocity[i] as number) + i_term;
  }
}

/**
 * The force (N) the rotors must make: m * (a + g). The vertical part is kept, and the horizontal part is cut back so
 * that the force leans at most `tiltLimit` from vertical.
 */
export function desiredForce(out: Float64Array, acceleration: ArrayLike<number>, mass: number = MASS): void {
  const az = clamp(acceleration[2] as number, -0.7 * GRAVITY, 2 * GRAVITY);
  const fz = mass * (GRAVITY + az);
  const fx = mass * (acceleration[0] as number), fy = mass * (acceleration[1] as number);
  const horizontal = Math.hypot(fx, fy);
  const limit = fz * Math.tan(GAINS.tiltLimit);
  const k = horizontal > limit ? limit / horizontal : 1;
  out[0] = fx * k; out[1] = fy * k; out[2] = fz;
}

/**
 * Body torques (N m): out[0] roll, out[1] pitch, out[2] yaw. `force` is the desired force in the world frame, `rates`
 * the body angular velocity (rad/s). The tilt error is the axis, in the body frame, that turns the body z axis toward
 * the force: (0, 0, 1) x R^T f / |f|.
 */
export function attitudeTorque(out: Float64Array, a: Attitude, force: ArrayLike<number>, rates: ArrayLike<number>): void {
  const fx = force[0] as number, fy = force[1] as number, fz = force[2] as number;
  const n = Math.hypot(fx, fy, fz) || 1;
  const zx = fx / n, zy = fy / n, zz = fz / n;
  const bx = a.r00 * zx + a.r10 * zy + a.r20 * zz;    // desired thrust direction, body frame
  const by = a.r01 * zx + a.r11 * zy + a.r21 * zz;
  const yaw = Math.atan2(a.r10, a.r00);
  out[0] = INERTIA.x * (GAINS.attitude.kp * -by - GAINS.attitude.kd * (rates[0] as number));
  out[1] = INERTIA.y * (GAINS.attitude.kp * bx - GAINS.attitude.kd * (rates[1] as number));
  out[2] = INERTIA.z * (GAINS.yaw.kp * -yaw - GAINS.yaw.kd * (rates[2] as number));
}

/** Total thrust (N) along the body z axis: the force projected on it, never negative. */
export function totalThrust(a: Attitude, force: ArrayLike<number>): number {
  const t = a.r02 * (force[0] as number) + a.r12 * (force[1] as number) + a.r22 * (force[2] as number);
  return t > 0 ? t : 0;
}
