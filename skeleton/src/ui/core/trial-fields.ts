// The `hash` and `diagnostics` fields of a TrialResult (golem-sim-hardening) for results the studio
// builds itself: the synthetic ghosts of the perf harness and the fake pools of the tests.
// A real trial gets both from `runTrial`; here they are filled the same way, so a consumer sees a result
// of the same shape. The hash is the sim's own 16-digit trajectory digest, taken over the pose frames
// (or over the spec when there are none), so equal trials give equal hashes.
import { TrajectoryHasher } from '../../sim/hash.js';
import type { TrialDiagnostics } from '../../sim/types.js';
import type { TrialResult, TrialSpec } from '../types.js';

export interface SyntheticFieldsOptions {
  /** Seconds of simulated time after the trigger. Default: the length of the pose frames, or 0. */
  horizon?: number;
  /** Seconds of warm-up before the trigger. Default 0. */
  warmup?: number;
  /** Sim timestep in seconds. Default 0.002. */
  timestep?: number;
}

/** Digest of the pose frames, one state per frame; without poses, of the seed and the scenario values by name. */
export function syntheticHash(spec: TrialSpec, poses?: TrialResult['poses']): string {
  const h = new TrajectoryHasher();
  if (poses && poses.nbody > 0 && poses.frames.length > 0) {
    const stride = poses.nbody * 7;
    const nFrames = Math.floor(poses.frames.length / stride);
    const { buffer, byteOffset } = poses.frames;
    for (let k = 0; k < nFrames; k++) h.update(new Uint32Array(buffer, byteOffset + k * stride * 4, stride));
    return h.digest(stride);
  }
  const names = Object.keys(spec.scenario).sort();
  const values = new Float64Array(names.length + 1);
  values[0] = spec.seed;
  names.forEach((n, i) => { values[i + 1] = spec.scenario[n] as number; });
  h.update(new Uint32Array(values.buffer));
  return h.digest(values.length * 2);
}

/** Diagnostics of a trial that ran cleanly: no warnings, no divergence, no saturated solver step. */
export function syntheticDiagnostics(o: SyntheticFieldsOptions = {}): TrialDiagnostics {
  const timestep = o.timestep ?? 0.002;
  const horizon = o.horizon ?? 0;
  return {
    horizon,
    simSteps: Math.round(((o.warmup ?? 0) + horizon) / timestep),
    timestep,
    integrator: 'implicitfast',
    warnings: {},
    maxSolverIterations: 0,
    solverSaturatedSteps: 0,
    maxContacts: 0,
    numerical: false,
  };
}

/** `hash` and `diagnostics` for a synthetic result; spread them into the result literal. */
export function syntheticTrialFields(
  spec: TrialSpec, poses?: TrialResult['poses'], o: SyntheticFieldsOptions = {},
): Pick<TrialResult, 'hash' | 'diagnostics'> {
  const horizon = o.horizon ?? (poses && poses.fps > 0 && poses.nbody > 0
    ? Math.max(0, poses.frames.length / (poses.nbody * 7) - 1) / poses.fps : 0);
  return { hash: syntheticHash(spec, poses), diagnostics: syntheticDiagnostics({ ...o, horizon }) };
}
