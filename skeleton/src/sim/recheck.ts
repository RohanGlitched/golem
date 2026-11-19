// Timestep and integrator re-check (golem-sim-hardening improvement 2). The falsifier calls this on a
// shrunk counterexample: a failure that also appears at half the timestep and with another integrator
// is physical; one that disappears is a numerical artefact of the chosen timestep or integrator.
import { runTrial } from './episode.js';
import type { ModelCache } from './model-cache.js';
import type { CompiledRequirement, IntegratorName, RobotApp, TrialResult, TrialSpec } from './types.js';

export interface RecheckVariant {
  label: 'base' | 'half-step' | 'other-integrator';
  simDt: number;
  integrator: IntegratorName;
  robustness: number;
  unit: string;
  /** robustness <= 0: the requirement did not hold. */
  failed: boolean;
  diverged: boolean;
  hash: string;
}

export interface RecheckReport {
  spec: TrialSpec;
  base: RecheckVariant;
  halfStep: RecheckVariant;
  otherIntegrator: RecheckVariant;
  /** The base trial failed, and so did both variants. */
  survives: boolean;
  /** The base trial failed, and a variant held or some run diverged. */
  numericalSuspect: boolean;
}

/** Euler becomes implicitfast; every other integrator becomes Euler. */
export function otherIntegrator(i: IntegratorName): IntegratorName {
  return i === 'euler' ? 'implicitfast' : 'euler';
}

function variant(label: RecheckVariant['label'], simDt: number, r: TrialResult): RecheckVariant {
  return {
    label, simDt, integrator: r.diagnostics.integrator, robustness: r.robustness, unit: r.unit,
    failed: !(r.robustness > 0), diverged: r.diagnostics.diverged !== undefined, hash: r.hash,
  };
}

/** Runs the trial as given, at simDt / 2, and with the other integrator, each to its full horizon. */
export async function recheckTrial(
  app: RobotApp, req: CompiledRequirement, spec: TrialSpec, opts: { cache: ModelCache },
): Promise<RecheckReport> {
  const baseResult = await runTrial(app, req, spec, { cache: opts.cache });
  const integ = baseResult.diagnostics.integrator;
  const half = app.simDt / 2;
  const halfResult = await runTrial(app, req, spec, { cache: opts.cache, numerics: { simDt: half, integrator: integ } });
  const otherResult = await runTrial(app, req, spec, { cache: opts.cache, numerics: { integrator: otherIntegrator(integ) } });
  const base = variant('base', app.simDt, baseResult);
  const halfStep = variant('half-step', half, halfResult);
  const other = variant('other-integrator', app.simDt, otherResult);
  const survives = base.failed && halfStep.failed && other.failed;
  return {
    spec, base, halfStep, otherIntegrator: other, survives,
    numericalSuspect: base.failed && (!survives || base.diverged || halfStep.diverged || other.diverged),
  };
}
