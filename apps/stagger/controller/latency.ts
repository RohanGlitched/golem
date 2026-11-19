// Observation delay in whole Control_Steps (sensor latency perturbation).
import { OBS_DIM } from './policy.js';

export const CONTROL_DT = 0.02;

/** clamp(round(duration / 0.02 s), 0, 25) */
export function delaySteps(duration: number): number {
  const d = Math.round(duration / CONTROL_DT);
  if (!(d > 0)) return 0;
  return d > LatencyBuffer.MAX_DELAY ? LatencyBuffer.MAX_DELAY : d;
}

export class LatencyBuffer {
  static readonly MAX_DELAY = 25;
  private readonly rows: Float64Array;
  private readonly width: number;
  private head = -1;   // row of the newest observation
  private count = 0;

  constructor(width: number = OBS_DIM) {
    this.width = width;
    this.rows = new Float64Array((LatencyBuffer.MAX_DELAY + 1) * width);
  }

  reset(): void { this.rows.fill(0); this.head = -1; this.count = 0; }

  /** Copies obs into the next row. */
  push(obs: ArrayLike<number>): void {
    const R = LatencyBuffer.MAX_DELAY + 1;
    this.head = (this.head + 1) % R;
    const o = this.head * this.width;
    for (let i = 0; i < this.width; i++) this.rows[o + i] = obs[i] as number;
    if (this.count < R) this.count++;
  }

  /** The observation d pushes before the newest one, or the oldest stored one if fewer exist. */
  delayed(d: number, out: Float64Array): void {
    if (this.count === 0) { out.fill(0); return; }
    const R = LatencyBuffer.MAX_DELAY + 1;
    let k = d < 0 ? 0 : d > LatencyBuffer.MAX_DELAY ? LatencyBuffer.MAX_DELAY : d | 0;
    if (k > this.count - 1) k = this.count - 1;
    const o = ((this.head - k + R) % R) * this.width;
    for (let i = 0; i < this.width; i++) out[i] = this.rows[o + i] as number;
  }
}