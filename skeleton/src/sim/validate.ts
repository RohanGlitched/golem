// Pure trial validation: no MuJoCo handle is touched and the model cache is not consulted.
import { SimError } from './errors.js';
import type {
  CompiledRequirement, Dimension, Kind, PerturbationTemplate, RobotApp, Scenario, TrialSpec,
} from './types.js';

export interface ResolvedCall {
  template: PerturbationTemplate;
  /** Built once from the normalised scenario and reused for every Sim_Step. */
  values: Record<string, number>;
}

export interface ValidatedTrial {
  scenario: Scenario;
  calls: ResolvedCall[];
  warmupControlSteps: number;
  controlSteps: number;
  /** Sim steps per control step. */
  n: number;
  warmupSimSteps: number;
}

const UNIT: Record<Kind, string> = {
  force: ' N', duration: ' s', length: ' m', speed: ' m/s', angle: ' rad', mass: ' kg',
  ratio: '', count: '', phase: '',
};

const REL_TOL = 1e-9;

function isIntegerWithin(x: number): boolean {
  return Math.abs(x - Math.round(x)) <= REL_TOL * Math.max(1, Math.abs(x));
}

/** Clamps within 1e-9 relative tolerance, wraps `wrap` dimensions into [min, max), rejects the rest. */
export function normaliseScenario(dim: Dimension, value: number): number {
  const { min, max } = dim;
  if (dim.wrap) {
    const span = max - min;
    if (!(span > 0)) return min;
    let v = value - span * Math.floor((value - min) / span);
    if (v >= max) v = min;
    if (v < min) v = min;
    return v;
  }
  const tol = REL_TOL * (Math.max(Math.abs(min), Math.abs(max)) || 1);
  if (value < min - tol || value > max + tol) {
    const u = UNIT[dim.kind];
    throw new SimError(`Scenario value ${dim.name} = ${value}${u} is outside [${min}${u}, ${max}${u}]`);
  }
  return Math.min(Math.max(value, min), max);
}

export function validateTrial(app: RobotApp, req: CompiledRequirement, spec: TrialSpec): ValidatedTrial {
  if (spec.app !== app.id) {
    throw new SimError(`Trial is for app "${spec.app}" but this app is "${app.id}"`);
  }
  const { simDt, controlDt, warmup } = app;
  if (!Number.isFinite(simDt) || !(simDt > 0)) throw new SimError(`simDt must be a finite number above 0 s, got ${simDt} s`);
  if (!Number.isFinite(controlDt) || !(controlDt > 0)) throw new SimError(`controlDt must be a finite number above 0 s, got ${controlDt} s`);
  const n = Math.round(controlDt / simDt);
  if (n < 1 || !isIntegerWithin(controlDt / simDt)) {
    throw new SimError(`controlDt (${controlDt} s) must be an integer multiple of simDt (${simDt} s)`);
  }
  if (!Number.isFinite(warmup) || warmup < 0) throw new SimError(`warmup must be a finite number of at least 0 s, got ${warmup} s`);
  if (!isIntegerWithin(warmup / controlDt)) {
    throw new SimError(`warmup (${warmup} s) must be an integer multiple of controlDt (${controlDt} s)`);
  }
  if (!Number.isFinite(req.horizon) || !(req.horizon > 0)) {
    throw new SimError(`Requirement horizon must be a finite number above 0 s, got ${req.horizon} s`);
  }
  const seed = spec.seed;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
    throw new SimError(`Seed must be an integer from 0 to 4294967295, got ${String(seed)}`);
  }

  const dims = req.space.dims;
  const missing = dims.filter((d) => !(d.name in spec.scenario)).map((d) => d.name);
  if (missing.length > 0) throw new SimError(`Scenario is missing dimension(s): ${missing.join(', ')}`);
  const scenario: Scenario = {};
  for (const d of dims) {
    const v = spec.scenario[d.name] as number;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new SimError(`Scenario value ${d.name} = ${String(v)} is not a finite number`);
    }
    scenario[d.name] = normaliseScenario(d, v);
  }

  const calls: ResolvedCall[] = [];
  for (const call of req.perturbations) {
    const template = app.lexicon.perturbations.find((t) => t.name === call.template)
      ?? app.lexicon.perturbations.find((t) => t.phrase === call.template);
    if (!template) throw new SimError(`Unknown perturbation template "${call.template}" in app "${app.id}"`);
    const values: Record<string, number> = {};
    for (const key of Object.keys(call.params)) {
      const p = call.params[key] as string | number;
      if (typeof p === 'string') {
        if (!(p in scenario)) throw new SimError(`Perturbation "${call.template}" parameter "${key}" names unknown dimension "${p}"`);
        values[key] = scenario[p] as number;
      } else {
        values[key] = p;
      }
    }
    calls.push({ template, values });
  }

  return {
    scenario, calls,
    warmupControlSteps: Math.round(warmup / controlDt),
    controlSteps: Math.round(req.horizon / controlDt),
    n,
    warmupSimSteps: Math.round(warmup / simDt),
  };
}
