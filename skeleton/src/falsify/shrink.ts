// Phase 3 shrinker: bisect each severity dimension toward its milder end, seed held fixed.
import type { Dimension, Scenario, ScenarioSpace } from './contract.js';
import { errorMessage } from './errors.js';

export interface ShrinkLimits { tolerance: number; maxTrials: number }
export const DEFAULT_SHRINK: ShrinkLimits = { tolerance: 0.01, maxTrials: 60 };

export type ShrinkTrialOutcome = { robustness: number } | { error: string };
/** Returns null when the budget is gone. */
export type ShrinkRunner = (s: Scenario) => Promise<ShrinkTrialOutcome> | null;

export interface ShrinkTrialLog {
  dim: string;
  scenario: Scenario;
  robustness: number | null;
  failing: boolean;
  error?: string;
}

export interface ShrinkOutcome {
  scenario: Scenario;
  robustness: number;
  /** True iff the output differs from the input in at least one dimension. */
  shrunk: boolean;
  trials: ShrinkTrialLog[];
  errors: string[];
  budgetStopped: boolean;
}

/** Distance from the milder end, in the dimension's own units. */
export function severityOf(d: Dimension, v: number): number {
  return d.severity === 'down' && d.wrap !== true ? d.max - v : v - d.min;
}
function valueAt(d: Dimension, s: number): number {
  return d.severity === 'down' && d.wrap !== true ? d.max - s : d.min + s;
}
export function isSeverityDimension(d: Dimension): boolean {
  return d.min !== d.max && (d.severity === 'up' || d.severity === 'down');
}

export async function shrink(
  failing: { scenario: Scenario; seed: number; robustness: number },
  space: ScenarioSpace,
  runTrial: ShrinkRunner,
  limits: ShrinkLimits = DEFAULT_SHRINK,
): Promise<ShrinkOutcome> {
  let current: Scenario = { ...failing.scenario };
  let robustness = failing.robustness;
  const trials: ShrinkTrialLog[] = [];
  const errors: string[] = [];
  let budgetStopped = false;
  let stop = false;

  // One candidate trial. Returns true when failing; sets `stop` when no more trials may run.
  const attempt = async (d: Dimension, v: number): Promise<boolean> => {
    if (trials.length >= limits.maxTrials) { stop = true; return false; }
    const candidate: Scenario = { ...current, [d.name]: v };
    const pending = runTrial(candidate);
    if (pending === null) { budgetStopped = true; stop = true; return false; }
    let r: ShrinkTrialOutcome;
    try { r = await pending; } catch (e) { r = { error: errorMessage(e) }; }
    if ('error' in r || Number.isNaN(r.robustness)) {
      const msg = 'error' in r ? r.error : `trial returned NaN robustness at ${d.name}=${v}`;
      errors.push(msg);
      trials.push({ dim: d.name, scenario: candidate, robustness: null, failing: false, error: msg });
      return false;
    }
    const failingNow = r.robustness < 0;
    trials.push({ dim: d.name, scenario: candidate, robustness: r.robustness, failing: failingNow });
    if (failingNow) { current = candidate; robustness = r.robustness; }
    return failingNow;
  };

  for (const d of space.dims) {
    if (stop) break;
    if (!isSeverityDimension(d)) continue;
    const width = d.max - d.min;
    let hi = severityOf(d, current[d.name] as number);
    if (!(hi > 0)) continue;
    if (await attempt(d, valueAt(d, 0))) continue; // the milder end fails: accepted at once
    if (stop) break;
    let lo = 0;
    while (hi - lo > limits.tolerance * width && !stop) {
      const mid = (lo + hi) / 2;
      if (await attempt(d, valueAt(d, mid))) hi = mid; else lo = mid;
    }
  }

  const shrunk = space.dims.some((d) => current[d.name] !== failing.scenario[d.name]);
  return { scenario: current, robustness, shrunk, trials, errors, budgetStopped };
}
