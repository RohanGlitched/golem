// Bullet time: when the first ghost of a generation breaks, the swarm plays at 0.1× for 1.2 s of wall time while the
// camera orbits 40° about the vertical axis through that ghost. Pure.
export const BULLET_RATE = 0.1;
export const BULLET_MS = 1200;
export const BULLET_ORBIT_DEG = 40;

const smooth = (p: number): number => p * p * (3 - 2 * p);

export class BulletTime {
  /** Wall time (ms) bullet time started, or NaN. */
  start = Number.NaN;
  /** The vertical axis the camera orbits (x, y in metres). */
  pivotX = 0;
  pivotY = 0;
  private lastAngle = 0;

  /** Starts bullet time unless it is already running. Returns true when it started. */
  trigger(nowMs: number, x: number, y: number): boolean {
    if (this.active(nowMs)) return false;
    this.start = nowMs;
    this.pivotX = x; this.pivotY = y;
    this.lastAngle = 0;
    return true;
  }

  active(nowMs: number): boolean { return nowMs >= this.start && nowMs - this.start < BULLET_MS; }

  /** Playback rate of the swarm at this instant. */
  rate(nowMs: number): number { return this.active(nowMs) ? BULLET_RATE : 1; }

  /** Orbit angle in degrees reached at this instant: 0 to 40, smooth, 40 once over. */
  angle(nowMs: number): number {
    if (!(nowMs >= this.start)) return 0;
    const p = (nowMs - this.start) / BULLET_MS;
    return BULLET_ORBIT_DEG * smooth(p > 1 ? 1 : p);
  }

  /** The angle (degrees) to rotate the camera by since the last call; 0 when nothing is left to turn. */
  takeDelta(nowMs: number): number {
    if (!(nowMs >= this.start) || this.lastAngle >= BULLET_ORBIT_DEG) return 0;
    const a = this.angle(nowMs);
    const d = a - this.lastAngle;
    this.lastAngle = a;
    return d;
  }

  /** True while the camera still has orbit left to turn. */
  turning(): boolean { return this.start === this.start && this.lastAngle < BULLET_ORBIT_DEG; }

  cancel(): void { this.start = Number.NaN; this.lastAngle = BULLET_ORBIT_DEG; }
}
