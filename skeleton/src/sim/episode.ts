// Episode runner: one trial is a pure function of (app, requirement, scenario, seed).
// After the model is in hand the whole body is synchronous, so trials never interleave in a worker.
import { SimError, wrapTrialError } from './errors.js';
import { TrialScope } from './handles.js';
import { buildContext } from './context.js';
import { PoseRecorder } from './pose-recorder.js';
import { readWarnings } from './helpers.js';
import { mulberry32 } from './prng.js';
import type {
  CompiledRequirement, DivergenceInfo, IntegratorName, RobotApp, RunOptions, SimContext, Trace, TrialDiagnostics,
  TrialResult, TrialSpec,
} from './types.js';
import { validateTrial } from './validate.js';

// ------------------------------------------------------------------ model guard (D8)

const GUARD_ARRAYS = [
  'body_mass', 'body_inertia', 'geom_friction', 'geom_size', 'actuator_gainprm', 'actuator_biasprm',
  'dof_damping', 'dof_frictionloss',
] as const;
const GUARD_OPT_VECTORS = ['gravity', 'wind'] as const;
const GUARD_OPT_SCALARS = [
  'timestep', 'density', 'viscosity', 'impratio', 'tolerance', 'iterations', 'disableflags',
] as const;

interface ModelSnapshot {
  arrays: Array<[string, Float64Array]>;
  vectors: Array<[string, Float64Array]>;
  scalars: Array<[string, number]>;
}

function snapshotModel(model: any): ModelSnapshot {
  const snap: ModelSnapshot = { arrays: [], vectors: [], scalars: [] };
  for (const name of GUARD_ARRAYS) {
    const a = model[name];
    if (a && typeof a.length === 'number') snap.arrays.push([name, Float64Array.from(a)]);
  }
  const opt = model.opt;
  if (opt) {
    for (const name of GUARD_OPT_VECTORS) {
      const a = opt[name];
      if (a && typeof a.length === 'number') snap.vectors.push([name, Float64Array.from(a)]);
    }
    for (const name of GUARD_OPT_SCALARS) {
      if (typeof opt[name] === 'number') snap.scalars.push([name, opt[name]]);
    }
  }
  return snap;
}

function restoreModel(model: any, snap: ModelSnapshot): void {
  for (const [name, copy] of snap.arrays) model[name].set(copy);
  for (const [name, copy] of snap.vectors) model.opt[name].set(copy);
  for (const [name, value] of snap.scalars) {
    if (model.opt[name] !== value) model.opt[name] = value;
  }
}

const MAXVAL = 1e10; // mjMAXVAL: the bound MuJoCo's own mj_checkPos / mj_checkVel / mj_checkAcc use

/** Index of the first entry that is non-finite or above mjMAXVAL in magnitude, or -1. No allocation. */
function firstBad(a: Float64Array): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    if (!(x <= MAXVAL && x >= -MAXVAL)) return i;
  }
  return -1;
}

const INTEGRATORS: readonly IntegratorName[] = ['euler', 'rk4', 'implicit', 'implicitfast', 'discrete'];
const BAD_WARNINGS = ['BADQPOS', 'BADQVEL', 'BADQACC'] as const;

/** mjDSBL_AUTORESET (65536 in MuJoCo 4.0.1). */
function autoresetBit(mj: any): number {
  const v = mj?.mjtDisableBit?.mjDSBL_AUTORESET?.value;
  return typeof v === 'number' ? v : 65536;
}

// ------------------------------------------------------------------ runner

export async function runTrial(
  app: RobotApp,
  req: CompiledRequirement,
  spec: TrialSpec,
  opts: RunOptions,
): Promise<TrialResult> {
  const t0 = performance.now();
  let v: ReturnType<typeof validateTrial>;
  let mj: any;
  let model: any;
  try {
    v = validateTrial(app, req, spec);
    ({ mj, model } = await opts.cache.getModel(app));
  } catch (e) {
    throw wrapTrialError(e, app, req, spec);
  }

  const scope = new TrialScope();
  const guard = snapshotModel(model);
  let ctx: SimContext | undefined;
  let propagating = false;
  let cleanupError: unknown;
  let hasCleanupError = false;
  try {
    // D1: MuJoCo's auto-reset would silently repair a blown-up state. The restore below undoes it.
    model.opt.disableflags = model.opt.disableflags | autoresetBit(mj);
    const data = scope.track(new mj.MjData(model), 'MjData');
    const rng = mulberry32(spec.seed);
    ctx = buildContext(mj, model, data, app.names);
    app.initState?.(ctx, rng);
    // D4: derived quantities (xpos, sensordata, ...) must match the state initState wrote.
    mj.mj_forward(model, data);
    const controller = app.makeController(ctx, rng);

    // Live views, read once. Re-read only when WASM memory growth detaches them.
    let qpos: Float64Array = data.qpos;
    let qvel: Float64Array = data.qvel;
    let qacc: Float64Array = data.qacc;
    let niter: Int32Array = data.solver_niter;
    let xfrc: Float64Array = data.xfrc_applied;
    let xpos: Float64Array = data.xpos;
    let xquat: Float64Array = data.xquat;
    const refreshIfDetached = (): void => {
      if (qpos.buffer.byteLength === 0 || qvel.buffer.byteLength === 0 || qacc.buffer.byteLength === 0
        || niter.buffer.byteLength === 0 || xfrc.buffer.byteLength === 0
        || xpos.buffer.byteLength === 0 || xquat.buffer.byteLength === 0) {
        qpos = data.qpos; qvel = data.qvel; qacc = data.qacc; niter = data.solver_niter;
        xfrc = data.xfrc_applied; xpos = data.xpos; xquat = data.xquat;
      }
    };

    const { simDt, controlDt, warmup } = app;
    const { n, calls } = v;
    const nCalls = calls.length;
    const N = v.controlSteps;
    const solverCap = model.opt.iterations as number;
    let simIndex = 0;

    // ---- per-step health check (D2, I1): integer fields and live views only, no allocation
    let maxIter = 0;
    let saturated = 0;
    let maxContacts = 0;
    let lastIter = 0;
    let divergence: DivergenceInfo | undefined;
    const afterStep = (phase: 'warmup' | 'trial'): boolean => {
      simIndex++;
      refreshIfDetached();
      const ncon = data.ncon as number;
      const nisland = data.nisland as number;
      let it = 0;
      if (nisland > 0) {
        const m = nisland < niter.length ? nisland : niter.length;
        for (let i = 0; i < m; i++) if ((niter[i] as number) > it) it = niter[i] as number;
      } else {
        it = niter[0] as number;
      }
      lastIter = it;
      if (it > maxIter) maxIter = it;
      if (it >= solverCap && solverCap > 0) saturated++;
      if (ncon > maxContacts) maxContacts = ncon;
      let arr = qpos;
      let cause: DivergenceInfo['cause'] = 'qpos';
      let idx = firstBad(qpos);
      if (idx < 0) { arr = qvel; cause = 'qvel'; idx = firstBad(qvel); }
      if (idx < 0) { arr = qacc; cause = 'qacc'; idx = firstBad(qacc); }
      if (idx < 0) return false;
      divergence = {
        t: simIndex * simDt, phase, cause, index: idx, value: arr[idx] as number,
        warnings: readWarnings(mj, data), solverIterations: it, contacts: ncon,
      };
      return true;
    };

    // ---- warm-up: no perturbation, no sample, xfrc stays zero
    for (let c = 0; c < v.warmupControlSteps; c++) {
      controller.step(ctx, simIndex * simDt);
      refreshIfDetached();
      for (let j = 0; j < n; j++) {
        mj.mj_step(model, data);
        if (afterStep('warmup')) {
          throw new SimError(`Simulation diverged during warm-up at t = ${simIndex * simDt} s`);
        }
      }
    }

    // ---- prologue: trigger, then sample 0 (allocates the signal arrays once, D6)
    const events: Array<{ name: string; t: number }> = [{ name: 'trigger', t: warmup }];
    xfrc.fill(0);
    const pose = spec.record === 'poses' ? new PoseRecorder(model.nbody as number, req.horizon) : undefined;
    const traceT = new Float64Array(N + 1);
    const out: Record<string, number> = {};
    const earlyStop = opts.earlyStop;
    let sigNames: string[] = [];
    let sigArrs: Float64Array[] = [];
    const signals: Record<string, Float64Array> = {};
    const traceView: Trace = { t: traceT, signals, events };

    let recorded = 0;

    for (let k = 0; k <= N; k++) {
      app.signals(ctx, out);
      refreshIfDetached();
      if (k === 0) {
        sigNames = Object.keys(out);
        sigArrs = sigNames.map((name) => {
          const a = new Float64Array(N + 1);
          signals[name] = a;
          return a;
        });
      }
      traceT[k] = warmup + k * controlDt;
      for (let i = 0; i < sigNames.length; i++) {
        (sigArrs[i] as Float64Array)[k] = out[sigNames[i] as string] as number;
      }
      recorded = k + 1;
      if (pose !== undefined) pose.maybeRecord(traceT[k] as number, xpos, xquat);

      if (earlyStop !== undefined) {
        const r: unknown = earlyStop(traceView, recorded);
        if (r !== undefined) {
          if (typeof r !== 'number' || !Number.isFinite(r)) {
            throw new SimError(`Early-stop hook returned ${String(r)}; a finite number or undefined is required`);
          }
          break;
        }
      }
      if (k === N) break;

      controller.step(ctx, traceT[k] as number);
      refreshIfDetached();
      let diverged = false;
      for (let j = 0; j < n; j++) {
        xfrc.fill(0);
        const tSim = simIndex * simDt;
        for (let c = 0; c < nCalls; c++) {
          const call = calls[c] as (typeof calls)[number];
          call.template.apply(ctx, tSim, warmup, call.values);
        }
        refreshIfDetached();
        mj.mj_step(model, data);
        if (afterStep('trial')) { diverged = true; break; }
      }
      if (diverged) break;
    }

    // ---- end of trial: the warning counters are read once (D2: any BAD* count means divergence)
    const warnings = readWarnings(mj, data);
    if (divergence === undefined && BAD_WARNINGS.some((w) => (warnings[w] ?? 0) > 0)) {
      divergence = {
        t: simIndex * simDt, phase: 'trial', cause: 'warning', index: -1, value: NaN,
        warnings, solverIterations: lastIter, contacts: data.ncon as number,
      };
    }
    if (divergence !== undefined) {
      const ev: { name: string; t: number } = { name: 'diverged', ...divergence };
      events.push(ev);
    }
    let trace: Trace = traceView;
    if (recorded !== N + 1) {
      const sub: Record<string, Float64Array> = {};
      for (let i = 0; i < sigNames.length; i++) sub[sigNames[i] as string] = (sigArrs[i] as Float64Array).subarray(0, recorded);
      trace = { t: traceT.subarray(0, recorded), signals: sub, events };
    }
    const m = req.monitor(trace);
    const integ = model.opt.integrator as number;
    const diagnostics: TrialDiagnostics = {
      horizon: N * controlDt,
      simSteps: simIndex,
      timestep: model.opt.timestep as number,
      integrator: INTEGRATORS[integ] ?? 'euler',
      warnings,
      maxSolverIterations: maxIter,
      solverSaturatedSteps: saturated,
      maxContacts,
      numerical: divergence !== undefined || BAD_WARNINGS.some((w) => (warnings[w] ?? 0) > 0),
    };
    if (divergence !== undefined) diagnostics.diverged = divergence;
    const result: TrialResult = {
      spec,
      robustness: divergence !== undefined ? -Infinity : m.robustness,
      worstAt: divergence !== undefined ? divergence.t : m.worstAt,
      unit: m.unit,
      wallMs: performance.now() - t0,
      diagnostics,
    };
    if (pose !== undefined) result.poses = pose.finish();
    return result;
  } catch (e) {
    propagating = true;
    throw wrapTrialError(e, app, req, spec);
  } finally {
    try {
      if (ctx !== undefined) app.endTrial?.(ctx);
    } catch (e) {
      hasCleanupError = true;
      cleanupError = e;
    }
    try {
      restoreModel(model, guard);
    } catch (e) {
      if (!hasCleanupError) { hasCleanupError = true; cleanupError = e; }
    }
    try {
      scope.disposeAll(propagating || hasCleanupError);
    } catch (e) {
      if (!propagating && !hasCleanupError) { hasCleanupError = true; cleanupError = e; }
    }
    if (hasCleanupError && !propagating) throw wrapTrialError(cleanupError, app, req, spec);
  }
}