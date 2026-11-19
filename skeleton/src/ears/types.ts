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

export interface PredicateTemplate {
  phrase: string;
  signals: string[];
  margin(s: Record<string, number>, slots: Record<string, number>): number;
  unit: string;
  /** Optional: dimensions this predicate adds to the scenario space. */
  dims?(slots: Record<string, Quantity | [Quantity, Quantity] | string>): Dimension[];
}
export interface PerturbationTemplate {
  phrase: string;
  dims(slots: Record<string, Quantity | [Quantity, Quantity] | string>): Dimension[];
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
