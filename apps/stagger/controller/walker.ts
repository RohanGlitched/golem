// The G1 walking controller. golem-sim calls `step` once per Control_Step (20 ms), at the start of
// the Control_Step, before its 10 Sim_Steps (golem-sim design, "Control_Step definition").
//
// Unitree's deploy script evaluates the policy after every 10th Sim_Step, from the state and time
// after that step, and holds the default pose for the first 10 Sim_Steps. Call k of `step` sees
// exactly that state and time (t = 0.02 k s), so the Walker evaluates the policy on every call
// except the first one after construction, which holds the default pose. The PD law runs inside
// MuJoCo at every Sim_Step (see pd.ts): the Walker writes the joint target to data.ctrl.
import type { Controller, SimContext } from '../contract.js';
import type { StaggerRuntime } from '../runtime.js';
import { LatencyBuffer } from './latency.js';
import { DEFAULT_POSE, buildObservation } from './observation.js';
import { ACT_DIM, OBS_DIM, type Policy } from './policy.js';
import { actionToTarget } from './pd.js';
import { REFLEX_LIMITS, Reflex } from './reflex.js';
import { KiroReflex } from './kiro-reflex.js';

export type ReflexKind = 'none' | 'kiro';
let reflexKind: ReflexKind = 'none';
/** Selects the balance reflex for Walkers created from now on: 'none' (Unitree's policy alone, the default) or 'kiro'. */
export function setReflex(kind: ReflexKind): void { reflexKind = kind; }
export const currentReflex = (): ReflexKind => reflexKind;

export class Walker implements Controller {
  readonly target = new Float64Array(ACT_DIM);
  readonly previousAction = new Float64Array(ACT_DIM);
  private readonly action = new Float64Array(ACT_DIM);
  private readonly obs = new Float64Array(OBS_DIM);
  private readonly delayedObs = new Float64Array(OBS_DIM);
  private readonly latency = new LatencyBuffer(OBS_DIM);
  private calls = 0;
  readonly reflex: Reflex | KiroReflex = reflexKind === 'kiro' ? new KiroReflex() : new Reflex();
  private readonly cmd = new Float64Array(3);
  private readonly rstate = { qpos: [] as ArrayLike<number>, qvel: [] as ArrayLike<number>, t: 0 };

  constructor(_ctx: SimContext, private readonly policy: Policy, private readonly rt: StaggerRuntime) {
    policy.reset();
    this.latency.reset();
    this.reflex.reset();
    this.target.set(DEFAULT_POSE);
  }

  /** Number of policy evaluations so far. */
  get policyCalls(): number { return this.calls > 0 ? this.calls - 1 : 0; }

  step(ctx: SimContext, t: number): void {
    const data = ctx.data;
    if (this.calls > 0) {
      const rs = this.rstate; rs.qpos = data.qpos; rs.qvel = data.qvel; rs.t = t;
      this.reflex.command(rs, this.rt.command, this.cmd);
      const L = REFLEX_LIMITS, c = this.cmd;
      for (let k = 0; k < 3; k++) {
        const lim = k === 2 ? L.yaw : L.v, v = c[k] as number;
        c[k] = Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : (this.rt.command[k] as number);
      }
      buildObservation(data.qpos, data.qvel, c, this.previousAction, t, this.obs);
      this.latency.push(this.obs);
      this.latency.delayed(this.rt.delaySteps, this.delayedObs);
      this.policy.step(this.delayedObs, this.action);
      actionToTarget(this.action, this.target);
      this.previousAction.set(this.action);
    }
    this.calls++;
    const ctrl: Float64Array = data.ctrl;
    for (let j = 0; j < ACT_DIM; j++) ctrl[j] = this.target[j] as number;
  }
}