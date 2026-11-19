// Type-only re-exports of the sibling contracts the kit uses, plus the approved optional additions
// (design, "Approved optional additions"). Nothing here renames or removes a field of interfaces.md.
import type {
  CompiledRequirement as BaseCompiledRequirement, Lexicon, PredicateTemplate, Scenario, ScenarioSpace, Trace,
} from '../ears/index.js';
import type { RobotApp as SimRobotApp } from '../sim/types.js';
import type { Counterexample, TrialPool, TrialResult, TrialSpec, Verdict } from '../falsify/contract.js';

export type { Lexicon, PredicateTemplate, Counterexample, Scenario, ScenarioSpace, Trace, TrialPool, TrialResult, TrialSpec, Verdict };

/** A predicate with its slot values and optional time window, for explain_margin (approved optional addition). */
export interface PredicateBinding {
  predicate: PredicateTemplate;
  slots: Record<string, number>;
  window?: { t0: number; t1: number };
}

/** Approved optional additions: `predicates` on the compiled requirement, `margins` on the monitor result. */
export type MonitorResult = ReturnType<BaseCompiledRequirement['monitor']> & { margins?: Record<string, number> };
export type CompiledRequirement = Omit<BaseCompiledRequirement, 'monitor'> & {
  monitor(trace: Trace): MonitorResult;
  predicates?: PredicateBinding[];
};

/** `RobotApp` plus the approved optional `signalUnits`. */
export type RobotApp = SimRobotApp & { signalUnits?: Record<string, string> };

/** `TrialResult` plus the approved optional `trace`. */
export type TracedTrialResult = TrialResult & { trace?: Trace };
