// Records body poses into one preallocated Float32Array. Layout per frame: nbody x (x, y, z, qw, qx, qy, qz).
// Frames follow the sim-step schedule (golem-sim-hardening defect 5): frame f is recorded at the first
// sim step at or after f / fps seconds after the trigger, so each frame is within one simDt of its
// nominal time and the mean rate is exactly `fps`. fps is 30, or 1 / simDt when simDt is coarser.
const TARGET_FPS = 30;
const EPS = 1e-9;

export class PoseRecorder {
  readonly fps: number;
  private readonly frames: Float32Array;
  private readonly capacity: number;
  /** Sim steps per frame (fractional). */
  private readonly stepsPerFrame: number;
  private count = 0;
  private nextStep = 0;

  constructor(private readonly nbody: number, horizon: number, simDt: number) {
    this.fps = simDt > 1 / TARGET_FPS ? 1 / simDt : TARGET_FPS;
    this.stepsPerFrame = 1 / (this.fps * simDt);
    this.capacity = Math.floor(horizon * this.fps + EPS) + 2;
    this.frames = new Float32Array(nbody * 7 * this.capacity);
  }

  get frameCount(): number { return this.count; }

  /** The trial step at which frame `f` is recorded. */
  stepOfFrame(f: number): number {
    return Math.ceil(f * this.stepsPerFrame - EPS);
  }

  /** Call with `step` = sim steps since the trigger (0 at the trigger), in increasing order. */
  recordStep(step: number, xpos: ArrayLike<number>, xquat: ArrayLike<number>): void {
    if (this.count >= this.capacity || step < this.nextStep) return;
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
    this.count++;
    this.nextStep = this.stepOfFrame(this.count);
  }

  finish(): { fps: number; nbody: number; frames: Float32Array } {
    return { fps: this.fps, nbody: this.nbody, frames: this.frames.subarray(0, this.nbody * 7 * this.count) };
  }
}
