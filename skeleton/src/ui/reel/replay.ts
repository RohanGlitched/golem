// Replay of a counterexample on the hero, at 0.25 times real time. No React.
import { nlerp } from '../core/pose-math.js';

export const REPLAY_SPEED = 0.25;

export interface ReplayPoses { fps: number; nbody: number; frames: Float32Array }

export interface ReplayDeps {
  hero: { snapshot(): void; restore(): void; pause(): void; resume(): void };
  scheduler: { acquire(r: 'replaying'): void; release(r: 'replaying'): void };
  reduced(): boolean;
  /** Called whenever the replay time or play state changes. */
  onChange?(): void;
}

export interface PoseTarget { position: { set(x: number, y: number, z: number): unknown }; quaternion: { set(x: number, y: number, z: number, w: number): unknown } }

/** Writes the replay pose at time t onto the hero body groups, with the ghosts' conversion (nlerp). */
export function applyReplayPose(groups: PoseTarget[], p: ReplayPoses, t: number, reduced: boolean, scratch: Float64Array): void {
  const per = p.nbody * 7;
  const n = per > 0 ? Math.floor(p.frames.length / per) : 0;
  if (n === 0) return;
  const x = Math.max(0, t) * p.fps;
  let f = Math.floor(x + 1e-9);
  let alpha = reduced ? 0 : x - f;
  if (f >= n - 1) { f = n - 1; alpha = 0; }
  const f1 = f < n - 1 ? f + 1 : f;
  for (let b = 0; b < p.nbody && b < groups.length; b++) {
    nlerp(p.frames, p.nbody, f, f1, b, alpha < 0 ? 0 : alpha, scratch);
    const g = groups[b] as PoseTarget;
    g.position.set(scratch[0] as number, scratch[1] as number, scratch[2] as number);
    g.quaternion.set(scratch[3] as number, scratch[4] as number, scratch[5] as number, scratch[6] as number);
  }
}

export class ReplayController {
  poses: ReplayPoses | undefined;
  frameCount = 0;
  t = 0;
  playing = false;
  active = false;
  worstTau = 0;

  constructor(private readonly deps: ReplayDeps) {}

  get fps(): number { return this.poses?.fps ?? 30; }
  get duration(): number { return this.frameCount > 1 ? (this.frameCount - 1) / this.fps : 0; }
  get frameIndex(): number { return Math.min(this.frameCount - 1, Math.max(0, Math.round(this.t * this.fps))); }

  load(poses: ReplayPoses, worstTau: number): void {
    this.poses = poses;
    const per = poses.nbody * 7;
    this.frameCount = per > 0 ? Math.floor(poses.frames.length / per) : 0;
    this.worstTau = worstTau;
    this.t = 0;
    this.playing = false;
  }

  /** Snapshots the live hero, pauses it, holds `replaying` and starts playing (unless reduced motion). */
  enter(): void {
    if (!this.poses || this.frameCount === 0) return;
    if (!this.active) {
      this.active = true;
      this.deps.hero.snapshot();
      this.deps.hero.pause();
      this.deps.scheduler.acquire('replaying');
    }
    this.t = 0;
    this.playing = !this.deps.reduced();
    this.changed();
  }

  /** "Back to live": restores the hero snapshot and releases `replaying`. */
  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.playing = false;
    this.deps.hero.restore();
    this.deps.hero.resume();
    this.deps.scheduler.release('replaying');
    this.changed();
  }

  advance(dtWall: number): void {
    if (!this.active || !this.playing || this.deps.reduced() || !(dtWall > 0)) return;
    const d = this.duration;
    this.t += REPLAY_SPEED * dtWall;
    if (this.t >= d) { this.t = d; this.playing = false; }
    this.changed();
  }

  play(): void {
    if (!this.active || this.deps.reduced()) return;
    if (this.t >= this.duration) this.t = 0;
    this.playing = true;
    this.changed();
  }

  pause(): void { this.playing = false; this.changed(); }

  seekFrame(i: number): void {
    const f = Math.min(this.frameCount - 1, Math.max(0, Math.round(i)));
    this.t = f > 0 ? f / this.fps : 0;
    this.playing = false;
    this.changed();
  }

  seekTime(t: number): void { this.seekFrame((Number.isFinite(t) ? t : 0) * this.fps); }

  stepFrame(dir: 1 | -1): void { this.seekFrame(this.frameIndex + dir); }

  private changed(): void { this.deps.onChange?.(); }
}
