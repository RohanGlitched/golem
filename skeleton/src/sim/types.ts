// Contract shapes used by sim. They mirror .kiro/steering/interfaces.md exactly (plus the
// approved add-only fields). sim never imports from ears/falsify/pool/ui, so the shapes are
// repeated here; TypeScript's structural typing keeps them compatible.
import type { ModelCache } from './model-cache.js';

/** The MuJoCo namespace returned by `await load()` from `@mujoco/mujoco`. */
export type Mj = Awaited<ReturnType<typeof import('@mujoco/mujoco').default>>;

export type ObjType = 'body' | 'geom' | 'site' | 'joint' | 'actuator';

export type Kind =
  | 'force' | 'duration' | 'length' | 'speed' | 'angle' | 'mass' | 'ratio' | 'count' | 'phase';
export interface Quantity { kind: Kind; si: number; text: string }
export interface Dimension {
  name: string; kind: Kind; min: number; max: number;
  severity: 'up' | 'down' | 'none'; wrap?: boolean;
}
export interface ScenarioSpace { dims: Dimension[] }
export type Scenario = Record<string, number>;

export interface Trace {
  t: Float64Array;
  signals: Record<string, Float64Array>;
  events: { name: string; t: number }[];
}

export interface PerturbationCall { template: string; params: Record<string, string | number> }
export interface CompiledRequirement {
  id: string;
  source: string;
  pattern: 'ubiquitous' | 'event' | 'state' | 'unwanted' | 'optional';
  space: ScenarioSpace;
  perturbations: PerturbationCall[];
  horizon: number;
  monitor(trace: Trace): { robustness: number; worstAt: number; unit: string };
}

export interface NameLookups {
  body(name: string): number; geom(name: string): number; site(name: string): number;
  joint(name: string): number; actuator(name: string): number;
}
/** `lookup` is an add-only field of the contract SimContext. */
export interface SimContext {
  mj: any; model: any; data: any; ids: Record<string, number>;
  lookup?: NameLookups;
}

export interface PredicateTemplate {
  phrase: string;
  signals: string[];
  margin(s: Record<string, number>, slots: Record<string, number>): number;
  unit: string;
  dims?(slots: Record<string, Quantity | [Quantity, Quantity] | string>): Dimension[];
}
export interface PerturbationTemplate {
  phrase: string;
  /** Optional short name that a PerturbationCall.template may use instead of the phrase. */
  name?: string;
  dims(slots: Record<string, Quantity | [Quantity, Quantity] | string>): Dimension[];
  apply(ctx: SimContext, t: number, tTrigger: number, values: Record<string, number>): void;
  /**
   * Approved addition (golem-sim-hardening): called once per perturbation call at the trigger, in array
   * order, before sample 0 and the first apply. For one-off edits; the runner restores the model afterwards.
   */
  begin?(ctx: SimContext, values: Record<string, number>): void;
  visual?(values: Record<string, number>): { force?: [number, number, number]; at?: string };
}
export interface Lexicon {
  robotNames: string[];
  predicates: PredicateTemplate[];
  perturbations: PerturbationTemplate[];
  episodeSeconds?: number;
}

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
  /** Add-only: names resolved into ctx.ids (as `<type>:<name>`) before the first Sim_Step. */
  names?: Partial<Record<ObjType, string[]>>;
}

export interface TrialSpec { app: string; reqId: string; scenario: Scenario; seed: number; record?: 'none' | 'poses' }

export type IntegratorName = 'euler' | 'rk4' | 'implicit' | 'implicitfast' | 'discrete';

/** Where and how a trial diverged (golem-sim-hardening defect 2). Also carried by the `diverged` event. */
export interface DivergenceInfo {
  /** Simulated time after the failing step, in seconds. */
  t: number;
  phase: 'warmup' | 'trial';
  /** Which array held the first entry that was non-finite or above 1e10 in magnitude, or 'warning'. */
  cause: 'qpos' | 'qvel' | 'qacc' | 'warning';
  /** Index of the first bad entry in that array (-1 for 'warning'). */
  index: number;
  /** Its value (NaN for 'warning'). */
  value: number;
  /** MuJoCo warning counters by name (INERTIA, CONTACTFULL, CNSTRFULL, BADQPOS, BADQVEL, BADQACC, BADCTRL). */
  warnings: Record<string, number>;
  /** Constraint solver iterations of the failing step. */
  solverIterations: number;
  /** Active contacts at the failing step. */
  contacts: number;
}

/** Numerical health of a trial, so a numerical failure can be told from a physical one. */
export interface TrialDiagnostics {
  /** Simulated seconds after the trigger that the runner planned (the horizon, rounded up to control steps). */
  horizon: number;
  /** mj_step calls made, warm-up included. */
  simSteps: number;
  timestep: number;
  integrator: IntegratorName;
  /** Final MuJoCo warning counters by name. */
  warnings: Record<string, number>;
  maxSolverIterations: number;
  /** Steps whose solver used all `opt.iterations` iterations (did not converge). */
  solverSaturatedSteps: number;
  maxContacts: number;
  diverged?: DivergenceInfo;
  /** True when the trial diverged or a BADQPOS, BADQVEL or BADQACC counter is above 0. */
  numerical: boolean;
}

export interface TrialResult {
  spec: TrialSpec; robustness: number; worstAt: number; unit: string;
  wallMs: number;
  poses?: { fps: number; nbody: number; frames: Float32Array };
  /**
   * Approved addition (golem-sim-hardening improvement 3): 16 hex digits hashing the qpos trajectory (the
   * initial state and the state after every sim step), the same in every JavaScript engine.
   */
  hash: string;
  /** Sim-level add-only field (golem-sim-hardening improvement 1). */
  diagnostics: TrialDiagnostics;
}

/**
 * Called once after each Control_Rate_Sample with the full-capacity trace arrays and the number
 * of valid samples `n`. Return undefined to continue, or a finite number (the decided robustness).
 */
export type EarlyStopHook = (trace: Trace, n: number) => number | undefined;

export interface RunOptions {
  earlyStop?: EarlyStopHook;
  cache: ModelCache;
}
