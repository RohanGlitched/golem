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

export class Walker implements Controller {
  readonly target = new Float64Array(ACT_DIM);
  readonly previousAction = new Float64Array(ACT_DIM);
  private readonly action = new Float64Array(ACT_DIM);
  private readonly obs = new Float64Array(OBS_DIM);
  private readonly delayedObs = new Float64Array(OBS_DIM);
  private readonly latency = new LatencyBuffer(OBS_DIM);
  private calls = 0;

  constructor(_ctx: SimContext, private readonly policy: Policy, private readonly rt: StaggerRuntime) {
    policy.reset();
    this.latency.reset();
    this.target.set(DEFAULT_POSE);
  }

  /** Number of policy evaluations so far. */
  get policyCalls(): number { return this.calls > 0 ? this.calls - 1 : 0; }

  step(ctx: SimContext, t: number): void {
    const data = ctx.data;
    if (this.calls > 0) {
      buildObservation(data.qpos, data.qvel, this.rt.command, this.previousAction, t, this.obs);
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