// Kiro's balance reflex: written by the golem-tuner agent (Kiro CLI, claude-opus-5.5) under the GOLEM
// Stop gate, to make requirement 1.3 hold. Its session log is evidence/results/tuner/. The shipped
// default stays the identity Reflex in reflex.ts (exact parity with Unitree's policy); select this one
// with setReflex('kiro') from app.ts.
import type { ReflexState } from './reflex.js';

// Lateral step-into-the-push reflex.
//
// The policy brakes a sideways push with a lateral command of 0 m/s and does not step out far
// enough, so pushes from the side topple it at about 60 N. The reflex measures the pelvis
// velocity in the heading frame, smooths it (FAST_TAU) to remove gait sway, and subtracts a slow
// average (SLOW_TAU) so only sudden changes count: a push does, a steady drift on a slope does
// not. The part of that lateral change beyond a deadband is added to the lateral command with a
// gain, so the policy walks with the push and puts a foot under the moving pelvis. The forward
// command and the yaw rate are passed through unchanged. Both filters start at the operator's
// command, so the first call returns that command unchanged.
const DT = 0.02; // s, one Control_Step
const FAST_TAU = 0.06; // s
const SLOW_TAU = 1.5; // s
const DEADBAND_Y = 0.08; // m/s
const GAIN_Y = 0.8; // (m/s commanded) per (m/s measured)
const MAX_DVY = 0.6; // m/s, largest lateral command the reflex adds

export class KiroReflex {
  private fast = 0;
  private slow = 0;
  private started = false;

  reset(): void {
    this.fast = 0; this.slow = 0; this.started = false;
  }

  /** Writes the command the policy will see. `base` is the operator's command (vx, vy, yaw). */
  command(s: ReflexState, base: ArrayLike<number>, out: Float64Array): void {
    const bx = base[0] as number, by = base[1] as number, byaw = base[2] as number;
    const q = s.qpos, v = s.qvel;
    const qw = q[3] as number, qx = q[4] as number, qy = q[5] as number, qz = q[6] as number;
    const yaw = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));
    const hy = -Math.sin(yaw) * (v[0] as number) + Math.cos(yaw) * (v[1] as number);
    if (!this.started || !Number.isFinite(hy)) {
      this.fast = by; this.slow = by; this.started = true;
    } else {
      this.fast += (DT / (FAST_TAU + DT)) * (hy - this.fast);
      this.slow += (DT / (SLOW_TAU + DT)) * (this.fast - this.slow);
    }
    const e = this.fast - this.slow;
    const ey = e > DEADBAND_Y ? e - DEADBAND_Y : e < -DEADBAND_Y ? e + DEADBAND_Y : 0;
    const dvy = Math.max(-MAX_DVY, Math.min(MAX_DVY, GAIN_Y * ey));
    out[0] = bx;
    out[1] = by + dvy;
    out[2] = byaw;
  }
}

