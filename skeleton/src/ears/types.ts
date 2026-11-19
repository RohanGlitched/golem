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
  monitor(trace: Trace): { robustness: number; worstAt: number; unit: string };
}

// ---------- lexicon (sim types are opaque to ears) ----------
export interface SimContext { mj: any; model: any; data: any; ids: Record<string, number> }

/** The bound value of a template slot, as the matcher read it. */
export type SlotValue = Quantity | [Quantity, Quantity] | string;

/**
 * Declares the scenario Dimension a slot becomes. The compiler builds the Dimension from the
 * range written in the line (kind, min, max and wrap in SI) and takes the name and severity from here.
 */
export interface SlotDimension { dim: string; severity: 'up' | 'down' | 'none' }

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
}

export interface CompileOptions {
  enabledFeatures?: readonly string[];
  id?: string;
  episodeSeconds?: number;
}
