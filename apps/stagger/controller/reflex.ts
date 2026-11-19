// Balance reflex: the one place a tuner may change how the G1 reacts to a push.
//
// Unitree's policy is frozen: it maps an observation, including a velocity command, to joint targets.
// The reflex sits in front of it and may rewrite that command every Control_Step from the robot's
// state, for example to step into a push. It never touches the policy, the PD law or the model.
//
// The shipped reflex is the identity: the policy sees the operator's command unchanged, so the
// parity test against Unitree's reference still holds bit for bit.
//
// Contract (tested in test/reflex.test.ts):
// - `command` writes three numbers (vx m/s, vy m/s, yaw rate rad/s) into `out` and allocates nothing.
// - It is a pure function of (state, base command, its own internal state); `reset` clears that state.
// - Outputs must be finite. |vx|, |vy| <= 1.0 m/s and |yaw| <= 1.0 rad/s are enforced by the Walker.

export interface ReflexState {
  /** Generalised positions (free joint first: x y z qw qx qy qz, then 12 leg joints). Live view. */
  qpos: ArrayLike<number>;
  /** Generalised velocities (free joint: vx vy vz wx wy wz in the world frame, then 12 joints). Live view. */
  qvel: ArrayLike<number>;
  /** Time since the episode started, in s. */
  t: number;
}

export class Reflex {
  reset(): void {}

  /** Writes the command the policy will see. `base` is the operator's command (vx, vy, yaw). */
  command(_s: ReflexState, base: ArrayLike<number>, out: Float64Array): void {
    out[0] = base[0] as number;
    out[1] = base[1] as number;
    out[2] = base[2] as number;
  }
}

/** Command limits the Walker applies after the reflex. */
export const REFLEX_LIMITS = { v: 1.0, yaw: 1.0 } as const;
