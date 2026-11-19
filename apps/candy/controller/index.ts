// CandyController: damped-least-squares IK, the pick-and-place machine, SSM_v1 and the suction model, composed.
//
// Control_Step (every 0.02 s), in this order:
//   1 read the true hand pose (mocap), push it into the delay line, read the delayed pose (Tracker_Lag)
//   2 scale = speedScale(separation(tip, delayed hand))      <- SSM_v1: the TIP only, see ssm.ts
//   3 before T_READY, or with nothing to do: hold or return to the Home_Pose
//   4 scale 0: hold every target and leave the suction switch alone; the machine does not advance
//   5 evaluate the guards of the current state and take at most one transition
//   6 commanded speed = min(vNom * scale, vPrev + aUp * dt); move the waypoint; IK from the previous targets
//   7 set the suction switch from the state (on from grasp to transfer)
// Everything is preallocated in the constructor: step and substep allocate nothing.
import {
  BOWLS, CANDY_COUNT, CONTROL_DT, CTRL, DWELL_STEPS, Q_HOME, T_READY, UD,
} from '../constants';
import type { Controller, SimContext } from '../contract';
import { chooseCandy } from '../geometry';
import { HandDelay } from './hand-delay';
import { candyIds, type CandyIds } from './ids';
import { IkSolver, makeIkResult } from './ik';
import { makeGuards, next, suctionOn, type Guards, type StateId, type Transition } from './machine';
import { separation, speedScale } from './ssm';
import { SuctionWorkspace, suctionStep, vacuumWarning } from './suction';

/** Commanded tip speed (m/s): at most vNom * scale, and rising by at most aUp * dt per step. Decreases are immediate. */
export function commandSpeed(vNom: number, scale: number, vPrev: number, dt: number, aUp: number): number {
  const cap = vNom * (scale > 0 ? (scale < 1 ? scale : 1) : 0);
  const rise = (vPrev > 0 ? vPrev : 0) + aUp * dt;
  return cap < rise ? cap : rise;
}

const NO_WARNINGS: readonly string[] = Object.freeze([]);

export class CandyController implements Controller {
  readonly ids: CandyIds;
  private readonly mj: any;
  private readonly ik: IkSolver;
  private readonly suction: SuctionWorkspace;
  private readonly delay = new HandDelay();
  private disposed = false;

  /** The state of the pick-and-place machine. */
  state: StateId = 'idle';
  /** Index of the candy being handled, or -1. */
  candy = -1;
  /** Speed scale of the last Control_Step. */
  lastScale = 1;
  /** Commanded tip speed of the last Control_Step (m/s). */
  vPrev = 0;
  /** Control_Steps spent in the current dwell (grasp, release). */
  dwell = 0;
  /** Joint position targets written to data.ctrl. */
  readonly qTarget = Float64Array.from(Q_HOME);
  /** Candies that IK could not reach: skipped for the rest of the trial. */
  readonly skip = new Uint8Array(CANDY_COUNT);

  private readonly active = new Uint8Array(CANDY_COUNT);
  private readonly candyPos = new Float64Array(3 * CANDY_COUNT);
  private readonly goal = new Float64Array(3);
  private readonly wp = new Float64Array(3);
  private readonly tip = new Float64Array(3);
  private readonly handTrue = new Float64Array(4);
  private readonly handRead = new Float64Array(4);
  private readonly guards: Guards = makeGuards();
  private readonly ikRes = makeIkResult();
  private readonly goalRes = makeIkResult();
  private goalFail = false;
  private seenWarnings = 0;

  private readonly data: any;
  private qpos!: Float64Array;
  private ctrl!: Float64Array;
  private mocapPos!: Float64Array;
  private mocapQuat!: Float64Array;
  private userdata!: Float64Array;
  private siteXpos!: Float64Array;

  constructor(ctx: SimContext, _rng: () => number) {
    // This controller draws no random number: the PRNG passed by the runner is accepted and left unused.
    this.mj = ctx.mj;
    this.ids = candyIds(ctx);
    this.ik = new IkSolver(ctx.mj, ctx.model, this.ids.tipSite);
    this.suction = new SuctionWorkspace(ctx);
    this.data = ctx.data;
    this.readViews(ctx.data);
  }

  private readViews(data: any): void {
    this.qpos = data.qpos; this.ctrl = data.ctrl; this.mocapPos = data.mocap_pos; this.mocapQuat = data.mocap_quat;
    this.userdata = data.userdata; this.siteXpos = data.site_xpos;
  }

  private sync(data: any): void {
    if (this.qpos.buffer.byteLength === 0 || this.ctrl.buffer.byteLength === 0 || this.siteXpos.buffer.byteLength === 0
      || this.mocapPos.buffer.byteLength === 0 || this.userdata.buffer.byteLength === 0) this.readViews(data);
  }

  // ------------------------------------------------------------ Controller

  /** Sim-rate work: the suction force (Controller.substep). */
  substep(ctx: SimContext, _tSim: number): void {
    suctionStep(this.mj, ctx, this.ids, this.suction);
  }

  step(ctx: SimContext, t: number): void {
    const ids = this.ids;
    const data = ctx.data;
    this.sync(data);
    const ud = this.userdata;

    // fresh kinematics: the tip where the arm is now
    this.mj.mj_kinematics(ctx.model, data);
    const s = 3 * ids.tipSite;
    this.tip[0] = this.siteXpos[s] as number; this.tip[1] = this.siteXpos[s + 1] as number; this.tip[2] = this.siteXpos[s + 2] as number;
    const count = Math.min(CANDY_COUNT, Math.round(ud[UD.count] as number));
    for (let i = 0; i < CANDY_COUNT; i++) {
      const q = ids.candyQpos[i] as number;
      this.candyPos[3 * i] = this.qpos[q] as number; this.candyPos[3 * i + 1] = this.qpos[q + 1] as number; this.candyPos[3 * i + 2] = this.qpos[q + 2] as number;
      this.active[i] = i < count ? 1 : 0;
    }

    // 1 and 2: the hand as the controller reads it, and SSM_v1
    const m = ids.handMocap;
    const qw = this.mocapQuat[4 * m] as number, qz = this.mocapQuat[4 * m + 3] as number;
    this.handTrue[0] = this.mocapPos[3 * m] as number; this.handTrue[1] = this.mocapPos[3 * m + 1] as number;
    this.handTrue[2] = this.mocapPos[3 * m + 2] as number; this.handTrue[3] = 2 * Math.atan2(qz, qw);
    this.delay.push(this.handTrue[0] as number, this.handTrue[1] as number, this.handTrue[2] as number, this.handTrue[3] as number);
    this.delay.read(HandDelay.steps(ud[UD.lag] as number), this.handRead);
    const scale = speedScale(separation(this.tip, this.handRead));
    this.lastScale = scale;

    // 3: not ready yet
    if (t < T_READY) { this.vPrev = 0; this.writeCtrl(); return; }
    // 4: stopped by SSM_v1. Hold every target; the machine, the dwell timers and the suction switch stay as they are.
    if (scale <= 0) { this.vPrev = 0; this.writeCtrl(); return; }

    // 5: guards and at most one transition
    this.evalGuards();
    const tr = next(this.state, this.guards);
    if (tr !== undefined) this.apply(tr);
    if (this.state === 'grasp' || this.state === 'release') this.dwell++;

    // 6: motion
    const v = commandSpeed(CTRL.vNom, scale, this.vPrev, CONTROL_DT, CTRL.aUp);
    this.vPrev = v;
    if (this.state === 'idle' || this.state === 'homing') this.rampHome(v);
    else this.moveWaypoint(v);
    this.writeCtrl();

    // 7: the suction switch follows the state
    ud[UD.switch] = suctionOn(this.state) ? 1 : 0;
  }

  // ------------------------------------------------------------ guards and actions

  private dist(a: Float64Array, bx: number, by: number, bz: number): number {
    const dx = (a[0] as number) - bx, dy = (a[1] as number) - by, dz = (a[2] as number) - bz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private evalGuards(): void {
    const g = this.guards;
    g.candidate = false; g.ikFail = false; g.atAbove = false; g.nearCandy = false; g.lost = false;
    g.dwellDone = false; g.lifted = false; g.atBowl = false; g.homeReached = false;
    const c = this.candy;
    const guard = CTRL.guardRadius;
    switch (this.state) {
      case 'idle':
        g.candidate = chooseCandy(this.candyPos, this.active, this.skip) >= 0;
        break;
      case 'approach':
        g.ikFail = this.goalFail || this.ikRes.error > CTRL.skipError;
        g.atAbove = this.dist(this.tip, this.goal[0] as number, this.goal[1] as number, this.goal[2] as number) <= guard;
        break;
      case 'descend':
        g.ikFail = this.goalFail || this.ikRes.error > CTRL.skipError;
        g.nearCandy = this.dist(this.tip, this.candyPos[3 * c] as number, this.candyPos[3 * c + 1] as number, this.candyPos[3 * c + 2] as number) <= guard;
        break;
      case 'grasp':
        g.lost = this.lostCandy(c);
        g.dwellDone = this.dwell >= DWELL_STEPS;
        break;
      case 'lift':
        g.lost = this.lostCandy(c);
        g.lifted = Math.abs((this.tip[2] as number) - CTRL.liftHeight) <= guard;
        break;
      case 'transfer':
        g.lost = this.lostCandy(c);
        g.atBowl = this.dist(this.tip, this.goal[0] as number, this.goal[1] as number, this.goal[2] as number) <= guard;
        break;
      case 'release':
        g.dwellDone = this.dwell >= DWELL_STEPS;
        break;
      case 'homing': {
        let ok = true;
        for (let j = 0; j < 7; j++) {
          if (Math.abs((this.qpos[this.ids.jointQpos[j] as number] as number) - (Q_HOME[j] as number)) > CTRL.homeGuard) { ok = false; break; }
        }
        g.homeReached = ok;
        break;
      }
    }
  }

  private lostCandy(c: number): boolean {
    return this.dist(this.tip, this.candyPos[3 * c] as number, this.candyPos[3 * c + 1] as number, this.candyPos[3 * c + 2] as number) > CTRL.guardRadius;
  }

  private apply(tr: Transition): void {
    this.state = tr.to;
    const c = this.candy;
    switch (tr.action) {
      case 'chooseCandy': {
        this.candy = chooseCandy(this.candyPos, this.active, this.skip);
        const i = this.candy;
        this.wp[0] = this.tip[0] as number; this.wp[1] = this.tip[1] as number; this.wp[2] = this.tip[2] as number;
        this.setGoal(this.candyPos[3 * i] as number, this.candyPos[3 * i + 1] as number, (this.candyPos[3 * i + 2] as number) + CTRL.approachHeight);
        this.dwell = 0;
        this.ikRes.error = 0;
        break;
      }
      case 'skipCandy':
        if (c >= 0) this.skip[c] = 1;
        this.candy = -1; this.goalFail = false; this.ikRes.error = 0;
        break;
      case 'startDescent':
        this.setGoal(this.candyPos[3 * c] as number, this.candyPos[3 * c + 1] as number, (this.candyPos[3 * c + 2] as number) + CTRL.descendOffset);
        break;
      case 'switchOn':
        this.dwell = 0;
        this.setGoal(this.wp[0] as number, this.wp[1] as number, this.wp[2] as number);
        break;
      case 'switchOff':   // the candy slipped: it stays a candidate
        this.candy = -1; this.dwell = 0;
        break;
      case 'startLift':
        this.setGoal(this.candyPos[3 * c] as number, this.candyPos[3 * c + 1] as number, CTRL.liftHeight);
        break;
      case 'startTransfer': {
        const colour = Math.min(2, Math.max(0, Math.round(this.userdata[UD.colour + c] as number)));
        const b = BOWLS[colour] as { x: number; y: number };
        this.setGoal(b.x, b.y, CTRL.releaseHeight);
        break;
      }
      case 'release':
        this.dwell = 0;
        this.setGoal(this.wp[0] as number, this.wp[1] as number, this.wp[2] as number);
        break;
      case 'startHoming':
        this.candy = -1;
        break;
      case 'none':
        this.candy = -1;
        break;
    }
  }

  /** Sets the goal and checks, once, that IK can reach it from the current targets (an unreachable goal skips the candy). */
  private setGoal(x: number, y: number, z: number): void {
    this.goal[0] = x; this.goal[1] = y; this.goal[2] = z;
    if (this.state === 'approach' || this.state === 'descend') {
      const r = this.ik.solve(this.goal, this.qTarget, this.goalRes);
      this.goalFail = !(r.error <= CTRL.skipError);
    } else {
      this.goalFail = false;
    }
  }

  // ------------------------------------------------------------ motion

  private moveWaypoint(v: number): void {
    const wp = this.wp, goal = this.goal;
    const dx = (goal[0] as number) - (wp[0] as number), dy = (goal[1] as number) - (wp[1] as number), dz = (goal[2] as number) - (wp[2] as number);
    const remaining = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (remaining > 0) {
      const step = Math.min(v * CONTROL_DT, remaining);
      const k = step / remaining;
      wp[0] = (wp[0] as number) + dx * k; wp[1] = (wp[1] as number) + dy * k; wp[2] = (wp[2] as number) + dz * k;
    }
    const r = this.ik.solve(wp, this.qTarget, this.ikRes);
    if (Number.isFinite(r.error)) for (let j = 0; j < 7; j++) this.qTarget[j] = r.q[j] as number;
  }

  /** Joint-space ramp toward the Home_Pose at 0.5 rad/s, scaled by the speed scale. */
  private rampHome(v: number): void {
    const maxStep = CTRL.homingRate * CONTROL_DT * (v / CTRL.vNom);
    for (let j = 0; j < 7; j++) {
      const d = (Q_HOME[j] as number) - (this.qTarget[j] as number);
      this.qTarget[j] = (this.qTarget[j] as number) + (d > maxStep ? maxStep : d < -maxStep ? -maxStep : d);
    }
  }

  private writeCtrl(): void {
    for (let j = 0; j < 7; j++) this.ctrl[this.ids.actuator[j] as number] = this.qTarget[j] as number;
  }

  // ------------------------------------------------------------ housekeeping

  /** Warnings recorded since the last call (a clamped vacuum ratio). Allocates only when there is something new. */
  warnings(): readonly string[] {
    this.sync(this.data);
    const n = this.userdata[UD.warnCount] as number;
    if (n === this.seenWarnings) return NO_WARNINGS;
    this.seenWarnings = n;
    return [vacuumWarning(this.userdata[UD.warnValue] as number)];
  }

  /** Deletes the IK solver's handles. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ik.dispose();
  }
}
