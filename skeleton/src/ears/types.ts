// Shared types for the ears module. Cross-module shapes follow
// .kiro/steering/interfaces.md unchanged; new fields are optional.

// ---------- units & quantities ----------
export type Kind =
  | 'force' | 'duration' | 'length' | 'speed' | 'angle' | 'mass' | 'ratio' | 'count' | 'phase';
export interface Quantity { kind: Kind; si: number; text: string }

// ---------- scenario space ----------
export interface Dimension {
  name: string;
  kind: Kind;
  min: number;
  max: number;
  severity: 'up' | 'down' | 'none';
  wrap?: boolean;
}
export interface ScenarioSpace { dims: Dimension[] }
export type Scenario = Record<string, number>;

// ---------- traces ----------
export interface Trace {
  t: Float64Array;
  signals: Record<string, Float64Array>;
  events: { name: string; t: number }[];
}

// ---------- compiled requirement ----------
export interface PerturbationCall { template: string; params: Record<string, string | number> }
export interface CompiledRequirement {
  id: string;
  source: string;
  pattern: 'ubiquitous' | 'event' | 'state' | 'unwanted' | 'optional';
  space: ScenarioSpace;
  perturbations: PerturbationCall[];
  horizon: number;
  /** The STL formula the monitor computes, e.g. `G[t₀, t₀+3 s] margin("stay upright") > 0 m`. */
  formula: string;
  /** With { margins: true } the result also carries the per-signal breakdown (see MonitorResult in monitor.ts). */
  monitor(trace: Trace, opts?: { margins?: boolean }): {
    robustness: number; worstAt: number; unit: string;
    margins?: Record<string, number>; marginsAt?: Record<string, number>;
  };
}

// ---------- lexicon (sim types are opaque to ears) ----------
export interface SimContext { mj: any; model: any; data: any; ids: Record<string, number> }

/** The bound value of a template slot, as the matcher read it. */
export type SlotValue = Quantity | [Quantity, Quantity] | string;

/**
 * Declares the scenario Dimension a slot becomes. The compiler builds the Dimension from the
 * range written in the line (kind, min, max and wrap in SI) and takes the name and severity from here.
 */
export interface SlotDimension {
  dim: string;
  severity: 'up' | 'down' | 'none';
  /**
   * Optional. A declared slot that the phrase does not contain is a hidden slot: the compiler adds
   * a Dimension with exactly this range (SI) and passes it to `apply` under the slot name. Use it
   * for what the world does besides what the line says, such as a hand's entry time or where each
   * candy lands. The line cannot change it. Ignored for a slot that the phrase does contain.
   */
  range?: HiddenRange;
}

/** The SI range of a hidden slot. min === max means fixed. */
export interface HiddenRange { kind: Kind; min: number; max: number; wrap?: boolean }

/** The parsed SI range of one slot. A fixed value has min === max. */
export interface SlotRange { kind: Kind; min: number; max: number; wrap: boolean }

/** @deprecated Declare `slots` instead; the compiler then builds the Dimensions itself. */
export type LegacyDims = (slots: Record<string, SlotValue>, ranges: Record<string, SlotRange>) => Dimension[];

export interface PredicateTemplate {
  phrase: string;
  signals: string[];
  margin(s: Record<string, number>, slots: Record<string, number>): number;
  unit: string;
  /** Optional: slot name → the Dimension this predicate adds to the scenario space. */
  slots?: Record<string, SlotDimension>;
  /** @deprecated Optional: dimensions this predicate adds; used only when `slots` is absent. */
  dims?: LegacyDims;
}
export interface PerturbationTemplate {
  phrase: string;
  /** Slot name → Dimension name and severity. Slots not listed must hold fixed values. */
  slots?: Record<string, SlotDimension>;
  /** @deprecated Returns the Dimensions; used only when `slots` is absent. */
  dims?: LegacyDims;
  /**
   * Latest start of the effect, in seconds after tTrigger (for example one gait period when the
   * push waits for a stride phase). Response windows and horizons add it. Default 0.
   */
  maxOnset?: number;
  /** Values are keyed by slot name: a fixed slot's SI value, or the scenario value of its Dimension. */
  apply(ctx: SimContext, t: number, tTrigger: number, values: Record<string, number>): void;
  visual?(values: Record<string, number>): { force?: [number, number, number]; at?: string };
}
export interface Lexicon {
  robotNames: string[];
  predicates: PredicateTemplate[];
  perturbations: PerturbationTemplate[];
  /** Optional episode length in seconds (default 10). */
  episodeSeconds?: number;
  /** Feature names a WHERE clause may name, such as "the payload kit is fitted". */
  features?: string[];
}

// ---------- ears-internal ----------
export type Pattern = 'ubiquitous' | 'event' | 'state' | 'unwanted' | 'optional';

export type TokenType = 'number' | 'unit' | 'keyword' | 'word' | 'comma' | 'requirementId';

export interface Token {
  type: TokenType;
  text: string;
  /** [start, end) in UTF-16 units. */
  start: number;
  end: number;
  /** 1-based. */
  line: number;
  column: number;
}

export interface Span { start: number; end: number; line: number; column: number }

export type SlotKind = Kind | 'direction' | 'range';

export interface CompiledTemplate {
  phrase: string;
  pattern: (string | { slot: SlotKind; name: string })[];
  /** Lexicon order. */
  index: number;
}

export type TemporalWrapper =
  | { kind: 'always'; duration?: number }
  | { kind: 'eventually'; duration: number };

export interface MonitorSpec {
  pattern: Pattern;
  predicate: PredicateTemplate;
  slots: Record<string, number>;
  wrapper: TemporalWrapper;
  stateMargin?: { predicate: PredicateTemplate; slots: Record<string, number> };
  disabledFeature?: boolean;
  /** Seconds added to a `for` window and a `within` deadline (the trigger's maxOnset). Default 0. */
  onset?: number;
}

export interface CompileOptions {
  enabledFeatures?: readonly string[];
  id?: string;
  episodeSeconds?: number;
}
