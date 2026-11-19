// Records body poses at 30 fps into one preallocated Float32Array. Layout per frame:
// nbody x (x, y, z, qw, qx, qy, qz).
const FPS = 30;
const EPS = 1e-9;

export class PoseRecorder {
  private readonly frames: Float32Array;
  private readonly capacity: number;
  private count = 0;
  private lastT = 0;

  constructor(private readonly nbody: number, horizon: number) {
    this.capacity = Math.floor(horizon * FPS) + 2;
    this.frames = new Float32Array(nbody * 7 * this.capacity);
  }

  get frameCount(): number { return this.count; }

  maybeRecord(t: number, xpos: ArrayLike<number>, xquat: ArrayLike<number>): void {
    if (this.count >= this.capacity) return;
    if (this.count !== 0 && t - this.lastT < 1 / FPS - EPS) return;
    const base = this.count * this.nbody * 7;
    const f = this.frames;
    for (let b = 0; b < this.nbody; b++) {
      const o = base + 7 * b;
      f[o] = xpos[3 * b] as number;
      f[o + 1] = xpos[3 * b + 1] as number;
      f[o + 2] = xpos[3 * b + 2] as number;
      f[o + 3] = xquat[4 * b] as number;
      f[o + 4] = xquat[4 * b + 1] as number;
      f[o + 5] = xquat[4 * b + 2] as number;
      f[o + 6] = xquat[4 * b + 3] as number;
    }
    this.lastT = t;
    this.count++;
  }

  finish(): { fps: 30; nbody: number; frames: Float32Array } {
    return { fps: FPS, nbody: this.nbody, frames: this.frames.subarray(0, this.nbody * 7 * this.count) };
  }
}
