// A delay line for the position estimate: it keeps the last control-rate samples of (x, y, z, vx, vy, vz) and reads
// the state as it was `lag` seconds ago, interpolating between samples. Before the first `lag` seconds of history
// exist, it returns the oldest sample it has. Allocation-free after construction.
import { CONTROL_DT, MAX_LAG } from '../constants';

export const DELAY_WIDTH = 6;

export class DelayLine {
  private readonly capacity: number;
  private readonly buf: Float64Array;
  private pushed = 0;

  constructor(maxLag: number = MAX_LAG, private readonly dt: number = CONTROL_DT) {
    this.capacity = Math.ceil(maxLag / dt) + 2;
    this.buf = new Float64Array(this.capacity * DELAY_WIDTH);
  }

  /** Number of samples currently kept. */
  get size(): number { return Math.min(this.pushed, this.capacity); }

  /** Appends one sample (the newest). */
  push(state: ArrayLike<number>): void {
    const row = (this.pushed % this.capacity) * DELAY_WIDTH;
    for (let i = 0; i < DELAY_WIDTH; i++) this.buf[row + i] = state[i] as number;
    this.pushed++;
  }

  /** Writes the state `lag` seconds before the newest sample into `out`. A negative or NaN lag reads the newest. */
  read(lag: number, out: Float64Array): void {
    if (this.pushed === 0) { out.fill(0, 0, DELAY_WIDTH); return; }
    const back = lag > 0 ? Math.min(lag / this.dt, this.size - 1) : 0;
    const lo = Math.floor(back);
    const frac = back - lo;
    const a = ((this.pushed - 1 - lo) % this.capacity) * DELAY_WIDTH;
    if (frac === 0) {
      for (let i = 0; i < DELAY_WIDTH; i++) out[i] = this.buf[a + i] as number;
      return;
    }
    const b = ((this.pushed - 2 - lo) % this.capacity) * DELAY_WIDTH;
    for (let i = 0; i < DELAY_WIDTH; i++) out[i] = (1 - frac) * (this.buf[a + i] as number) + frac * (this.buf[b + i] as number);
  }
}
