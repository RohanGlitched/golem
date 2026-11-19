// Fixed-step accumulator: decouples physics steps from frame rate.
export class FixedStepAccumulator {
  acc = 0;
  constructor(readonly dt: number, readonly stepCap: number) {}

  /** dtWall in seconds, >= 0. Returns the number of physics steps to run. */
  add(dtWall: number): number {
    if (!(dtWall > 0) || !Number.isFinite(dtWall)) dtWall = 0;
    this.acc += dtWall;
    const n = Math.floor(this.acc / this.dt + 1e-9);
    if (n > this.stepCap) {
      this.acc -= this.stepCap * this.dt;
      this.acc -= Math.floor(this.acc / this.dt + 1e-9) * this.dt;
      if (this.acc < 0) this.acc = 0;
      return this.stepCap;
    }
    this.acc -= n * this.dt;
    if (this.acc < 0) this.acc = 0;
    return n;
  }

  resumeAfterHidden(): void { this.acc = 0; }
}
