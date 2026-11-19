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

/** Slot name → scenario Dimension name and severity; the ears compiler builds the Dimension. */
export interface SlotDimension { dim: string; severity: 'up' | 'down' | 'none' }
/** The parsed SI range of one slot (min === max when fixed). */
export interface SlotRange { kind: Kind; min: number; max: number; wrap: boolean }
type SlotValue = Quantity | [Quantity, Quantity] | string;

export interface PredicateTemplate {
  phrase: string;
  signals: string[];
  margin(s: Record<string, number>, slots: Record<string, number>): number;
  unit: string;
  slots?: Record<string, SlotDimension>;
  /** @deprecated declare `slots` instead. */
  dims?(slots: Record<string, SlotValue>, ranges: Record<string, SlotRange>): Dimension[];
}
export interface PerturbationTemplate {
  phrase: string;
  /** Optional short name that a PerturbationCall.template may use instead of the phrase. */
  name?: string;
  slots?: Record<string, SlotDimension>;
  /** Latest start of the effect in seconds after tTrigger (ears adds it to windows and horizons). */
  maxOnset?: number;
  /** @deprecated declare `slots` instead; ears calls it only when `slots` is absent. */
  dims?(slots: Record<string, SlotValue>, ranges: Record<string, SlotRange>): Dimension[];
  apply(ctx: SimContext, t: number, tTrigger: number, values: Record<string, number>): void;
  visual?(values: Record<string, number>): { force?: [number, number, number]; at?: string };
}
export interface Lexicon {
  robotNames: string[];
  predicates: PredicateTemplate[];
  perturbations: PerturbationTemplate[];
  episodeSeconds?: number;
  features?: string[];
}

export interface Controller { step(ctx: SimContext, t: number): void }
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
export interface TrialResult {
  spec: TrialSpec; robustness: number; worstAt: number; unit: string;
  wallMs: number;
  poses?: { fps: number; nbody: number; frames: Float32Array };
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
