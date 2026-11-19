// Contract shapes from .kiro/steering/interfaces.md. The ears shapes come from golem-spec; the app
// contract (RobotApp, Controller) is not exported by golem-spec yet, so it is repeated here.
// Structural typing keeps both compatible with golem-sim.
import type { Lexicon, Quantity, SimContext } from 'golem-spec';

export type {
  Kind, Quantity, Dimension, Scenario, SimContext, PredicateTemplate, PerturbationTemplate, Lexicon,
  CompiledRequirement, Trace,
} from 'golem-spec';

export type Slots = Record<string, Quantity | [Quantity, Quantity] | string>;
export interface Controller {
  step(ctx: SimContext, t: number): void;
  /** Approved addition (golem-sim-hardening): called before every mj_step, warm-up included. */
  substep?(ctx: SimContext, tSim: number): void;
}
export interface RobotApp {
  id: string; name: string;
  files(): Promise<Record<string, Uint8Array>>;
  sceneFile: string;
  simDt: number; controlDt: number; warmup: number;
  lexicon: Lexicon;
  makeController(ctx: SimContext, rng: () => number): Controller;
  signals(ctx: SimContext, out: Record<string, number>): void;
  initState?(ctx: SimContext, rng: () => number): void;
  endTrial?(ctx: SimContext): void;
  /** golem-sim add-only field: names resolved into ctx.ids as `<type>:<name>` before the first Sim_Step. */
  names?: Partial<Record<'body' | 'geom' | 'site' | 'joint' | 'actuator', string[]>>;
}
