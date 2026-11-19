// Hero_Sim: the live robot on the stage. Fixed-step physics decoupled from the frame rate,
// the same controller and initial state as the trials, and no allocation in the step loop.
import { FixedStepAccumulator } from '../core/accumulator.js';
import type { RobotApp, SimContext } from '../types.js';

export const DIVERGED_TEXT = 'The simulation diverged and was reset';
export const SLEEP_TEXT = 'Paused to save power: shove the robot to wake it';

export interface HeroViews {
  qpos: Float64Array; qvel: Float64Array; xpos: Float64Array; xquat: Float64Array; xipos: Float64Array; xfrc: Float64Array;
}

/** Writes rows of xfrc_applied for this physics step. Returns false when it has ended. */
export type ForceProvider = (v: HeroViews, simTime: number) => boolean;

export interface HeroDeps {
  mj: any; model: any; data: any; ctx: SimContext; app: RobotApp; rng: () => number;
  stepCap: number; idleSleepMs: number;
  scheduler: { acquire(r: 'simulating'): void; release(r: 'simulating'): void };
  now(): number;
  onDiverged?(): void;
  onSleepChange?(sleeping: boolean): void;
  onSlowChange?(slow: boolean): void;
  /** Writes body poses into the stage body groups. */
  sync?(xpos: Float64Array, xquat: Float64Array): void;
}

type Slot = 'shove' | 'key';

export class HeroSim {
  readonly acc: FixedStepAccumulator;
  readonly nCtrl: number;
  private controller: { step(ctx: SimContext, t: number): void };
  private ctrlCountdown = 0;
  simTime = 0;
  views!: HeroViews;
  private xfrcBuf: ArrayBufferLike | undefined;
  private readonly providers: Record<Slot, ForceProvider | null> = { shove: null, key: null };
  private readonly onEnd: Record<Slot, (() => void) | null> = { shove: null, key: null };
  private lastActivity: number;
  sleeping = false;
  paused = false;
  slow = false;
  private holding = false;
  private disposed = false;
  private snap: { qpos: Float64Array; qvel: Float64Array; time: number; simTime: number; act?: Float64Array } | undefined;
  controllerCalls = 0;

  constructor(private readonly d: HeroDeps) {
    this.acc = new FixedStepAccumulator(d.app.simDt, d.stepCap);
    this.nCtrl = Math.max(1, Math.round(d.app.controlDt / d.app.simDt));
    this.refreshViews();
    d.app.initState?.(d.ctx, d.rng);
    d.mj.mj_forward?.(d.model, d.data);
    this.controller = d.app.makeController(d.ctx, d.rng);
    this.lastActivity = d.now();
    this.updateHold();
    this.sync();
  }

  private refreshViews(): void {
    const data = this.d.data;
    this.views = {
      qpos: data.qpos, qvel: data.qvel, xpos: data.xpos, xquat: data.xquat,
      xipos: data.xipos ?? data.xpos, xfrc: data.xfrc_applied,
    };
    this.xfrcBuf = this.views.xfrc.buffer;
  }

  private get running(): boolean { return !this.paused && !this.sleeping && !this.disposed; }

  private updateHold(): void {
    const want = this.running;
    if (want && !this.holding) { this.holding = true; this.d.scheduler.acquire('simulating'); }
    else if (!want && this.holding) { this.holding = false; this.d.scheduler.release('simulating'); }
  }

  /** Steps the physics for dtWall seconds of wall time (fixed steps, capped). */
  advance(dtWall: number, nowMs: number): { steps: number; diverged: boolean } {
    if (!this.running) return { steps: 0, diverged: false };
    if (nowMs - this.lastActivity > this.d.idleSleepMs && !this.providers.shove && !this.providers.key) {
      this.sleeping = true;
      this.updateHold();
      this.d.onSleepChange?.(true);
      return { steps: 0, diverged: false };
    }
    if (this.d.data.xfrc_applied.buffer !== this.xfrcBuf) this.refreshViews();
    const n = this.acc.add(dtWall);
    const v = this.views;
    const { mj, model, data, ctx } = this.d;
    const simDt = this.d.app.simDt;
    for (let i = 0; i < n; i++) {
      if (this.ctrlCountdown === 0) {
        this.controller.step(ctx, this.simTime);
        this.controllerCalls++;
        this.ctrlCountdown = this.nCtrl;
      }
      this.ctrlCountdown -= 1;
      v.xfrc.fill(0);
      if (this.providers.shove && !this.providers.shove(v, this.simTime)) this.endProvider('shove');
      if (this.providers.key && !this.providers.key(v, this.simTime)) this.endProvider('key');
      mj.mj_step(model, data);
      this.simTime += simDt;
    }
    if (n > 0 && this.d.data.xfrc_applied.buffer !== this.xfrcBuf) this.refreshViews();
    const slow = n >= this.d.stepCap;
    if (slow !== this.slow) { this.slow = slow; this.d.onSlowChange?.(slow); }
    let diverged = false;
    const q = this.views.qpos;
    let sum = 0;
    for (let i = 0; i < q.length; i++) sum += q[i] as number;
    if (!Number.isFinite(sum)) {
      diverged = true;
      this.reset();
      this.d.onDiverged?.();
    }
    this.sync();
    return { steps: n, diverged };
  }

  private endProvider(slot: Slot): void {
    this.providers[slot] = null;
    const cb = this.onEnd[slot];
    this.onEnd[slot] = null;
    cb?.();
  }

  /** Installs a per-step force writer; `onEnd` runs when it reports it has ended. */
  setForce(slot: Slot, f: ForceProvider | null, onEnd?: () => void): void {
    this.providers[slot] = f;
    this.onEnd[slot] = f ? onEnd ?? null : null;
    if (f) this.wake();
  }

  hasForce(slot: Slot): boolean { return this.providers[slot] !== null; }

  /** Writes the body poses to the stage. Reads fresh views: a controller that allocates (a second MjData for IK) may have grown the WASM heap. */
  sync(): void {
    if (this.d.data.xfrc_applied.buffer !== this.xfrcBuf) this.refreshViews();
    this.d.sync?.(this.views.xpos, this.views.xquat);
  }

  /** Position of mocap row `row` (a row of `mocap_pos`). The array is read fresh: WASM may have replaced its buffer. */
  mocapPos(row: number, out: Float64Array): void {
    const m = this.d.data.mocap_pos as Float64Array;
    out[0] = m[3 * row] as number; out[1] = m[3 * row + 1] as number; out[2] = m[3 * row + 2] as number;
  }

  /** Moves mocap row `row` and wakes the hero. The next physics step carries the body (and the controller's view of it) along. */
  setMocapPos(row: number, x: number, y: number, z: number): void {
    const m = this.d.data.mocap_pos as Float64Array;
    m[3 * row] = x; m[3 * row + 1] = y; m[3 * row + 2] = z;
    this.wake();
  }

  /** Restarts from the initial state with the studio PRNG stream. */
  reset(): void {
    const { mj, model, data, ctx, app, rng } = this.d;
    mj.mj_resetData?.(model, data);
    this.refreshViews();
    app.initState?.(ctx, rng);
    mj.mj_forward?.(model, data);
    this.controller = app.makeController(ctx, rng);
    this.ctrlCountdown = 0;
    this.simTime = 0;
    this.acc.resumeAfterHidden();
    this.wake();
    this.sync();
  }

  pause(): void { this.paused = true; this.updateHold(); }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.acc.resumeAfterHidden();
    this.lastActivity = this.d.now();
    this.updateHold();
  }

  /** Activity: a shove, key, reset, summon or replay. Wakes a sleeping hero. */
  wake(): void {
    this.lastActivity = this.d.now();
    if (this.sleeping) {
      this.sleeping = false;
      this.acc.resumeAfterHidden();
      this.d.onSleepChange?.(false);
    }
    this.updateHold();
  }

  snapshot(): void {
    const v = this.views;
    const act = this.d.data.act as Float64Array | undefined;
    this.snap = {
      qpos: v.qpos.slice(), qvel: v.qvel.slice(), time: Number(this.d.data.time ?? 0), simTime: this.simTime,
      ...(act && act.length ? { act: act.slice() } : {}),
    };
  }

  restore(): void {
    const s = this.snap;
    if (!s) return;
    if (this.d.data.xfrc_applied.buffer !== this.xfrcBuf) this.refreshViews();
    this.views.qpos.set(s.qpos);
    this.views.qvel.set(s.qvel);
    if (s.act && this.d.data.act) (this.d.data.act as Float64Array).set(s.act);
    try { this.d.data.time = s.time; } catch { /* read-only in some builds */ }
    this.simTime = s.simTime;
    this.d.mj.mj_forward?.(this.d.model, this.d.data);
    this.acc.resumeAfterHidden();
    this.sync();
  }

  poseOf(body: number, out: Float64Array): void {
    const v = this.views;
    out[0] = v.xpos[3 * body] as number; out[1] = v.xpos[3 * body + 1] as number; out[2] = v.xpos[3 * body + 2] as number;
    out[3] = v.xquat[4 * body] as number; out[4] = v.xquat[4 * body + 1] as number;
    out[5] = v.xquat[4 * body + 2] as number; out[6] = v.xquat[4 * body + 3] as number;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.updateHold();
    this.providers.shove = this.providers.key = null;
    this.d.data.delete();
    this.d.model.delete();
  }
}
