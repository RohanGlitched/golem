// Delay line for the hand pose that the controller reads (the Tracker_Lag perturbation).
// One Float64Array of DELAY_LENGTH samples of (x, y, z, yaw), allocated once. The true Hand is never altered.
import { CONTROL_DT, DELAY_LENGTH } from '../constants';

const W = 4;

export class HandDelay {
  /** Ring buffer, DELAY_LENGTH x 4. Its length never changes. */
  readonly buffer = new Float64Array(DELAY_LENGTH * W);
  private head = -1;

  /** Whole Control_Steps of delay for a lag in seconds: round(lag / 0.02) clamped to [0, DELAY_LENGTH - 1]. */
  static steps(lag: number): number {
    if (!(lag > 0)) return 0;
    const n = Math.round(lag / CONTROL_DT);
    return n > DELAY_LENGTH - 1 ? DELAY_LENGTH - 1 : n;
  }

  /** Stores the newest sample. The first push fills every slot, so an early read never sees garbage. */
  push(x: number, y: number, z: number, yaw: number): void {
    const b = this.buffer;
    if (this.head < 0) {
      for (let i = 0; i < DELAY_LENGTH; i++) { b[i * W] = x; b[i * W + 1] = y; b[i * W + 2] = z; b[i * W + 3] = yaw; }
      this.head = 0;
      return;
    }
    this.head = (this.head + 1) % DELAY_LENGTH;
    const o = this.head * W;
    b[o] = x; b[o + 1] = y; b[o + 2] = z; b[o + 3] = yaw;
  }

  /** Writes the sample `steps` older than the newest into `out` (4 values). `read(0, out)` is the newest. */
  read(steps: number, out: Float64Array): void {
    const b = this.buffer;
    let k = steps < 0 ? 0 : steps > DELAY_LENGTH - 1 ? DELAY_LENGTH - 1 : steps | 0;
    if (this.head < 0) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0; return; }
    k = (this.head - k + DELAY_LENGTH) % DELAY_LENGTH;
    const o = k * W;
    out[0] = b[o] as number; out[1] = b[o + 1] as number; out[2] = b[o + 2] as number; out[3] = b[o + 3] as number;
  }
}
