// Episode runner: one trial is a pure function of (app, requirement, scenario, seed).
// After the model is in hand the whole body is synchronous, so trials never interleave in a worker.
import { SimError, wrapTrialError } from './errors.js';
import { TrialScope } from './handles.js';
import { buildContext } from './context.js';
import { PoseRecorder } from './pose-recorder.js';
import { readWarnings } from './helpers.js';
import { modelSnapshot, restoreModelSnapshot } from './model-snapshot.js';
import { mulberry32 } from './prng.js';
import type {
  CompiledRequirement, DivergenceInfo, IntegratorName, RobotApp, RunOptions, SimContext, Trace, TrialDiagnostics,
  TrialResult, TrialSpec,
} from './types.js';
import { validateTrial } from './validate.js';

/**
 * Robustness of a diverged trial (golem-sim-hardening defect 10): finite, so JSON keeps it, and below every
 * physical margin, so the sign test and sorting still work. TrialResult.diagnostics.diverged says why.
 */
export const DIVERGED_ROBUSTNESS = -Number.MAX_VALUE;

/** Clamps +-Infinity to +-Number.MAX_VALUE so JSON keeps it; NaN is rejected by the caller. */
function finiteRobustness(r: number): number {
  if (r === Infinity) return Number.MAX_VALUE;
  if (r === -Infinity) return -Number.MAX_VALUE;
  return r;
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
  // D6: the full snapshot taken when the model was compiled (every array in model.buffer, every opt field).
  const guard = modelSnapshot(model);
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

    const events: Array<{ name: string; t: number }> = [];
    const traceT = new Float64Array(N + 1);
    const out: Record<string, number> = {};
    const earlyStop = opts.earlyStop;
    let sigNames: string[] = [];
    let sigArrs: Float64Array[] = [];
    const signals: Record<string, Float64Array> = {};
    const traceView: Trace = { t: traceT, signals, events };
    let recorded = 0;
    let decided: number | undefined; // D9: the early-stop hook's decided robustness
    let pose: PoseRecorder | undefined;

    // ---- warm-up: no perturbation, no sample; xfrc is cleared before every step.
    // D8: a divergence here ends the trial as a counterexample (no trigger, empty trace), not an error.
    const hasSubstep = typeof controller.substep === 'function';
    let warmDiverged = false;
    warm: for (let c = 0; c < v.warmupControlSteps; c++) {
      controller.step(ctx, simIndex * simDt);
      refreshIfDetached();
      for (let j = 0; j < n; j++) {
        xfrc.fill(0);
        if (hasSubstep) { controller.substep!(ctx, simIndex * simDt); refreshIfDetached(); }
        mj.mj_step(model, data);
        if (afterStep('warmup')) { warmDiverged = true; break warm; }
      }
    }

    if (!warmDiverged) {
      // ---- prologue: trigger, then sample 0 (allocates the signal arrays once, D6)
      events.push({ name: 'trigger', t: warmup });
      xfrc.fill(0);
      // D7: one-off hooks at the trigger, in array order, before sample 0 and the first apply.
      for (let c = 0; c < nCalls; c++) {
        const call = calls[c] as (typeof calls)[number];
        if (typeof call.template.begin === 'function') call.template.begin(ctx, call.values);
      }
      refreshIfDetached();
      if (spec.record === 'poses') pose = new PoseRecorder(model.nbody as number, N * controlDt, simDt);
      const trigIndex = simIndex;

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
        if (pose !== undefined && k === 0) pose.recordStep(0, xpos, xquat);

        if (earlyStop !== undefined) {
          const r: unknown = earlyStop(traceView, recorded);
          if (r !== undefined) {
            if (typeof r !== 'number' || !Number.isFinite(r)) {
              throw new SimError(`Early-stop hook returned ${String(r)}; a finite number or undefined is required`);
            }
            decided = r;
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
          if (hasSubstep) { controller.substep!(ctx, tSim); refreshIfDetached(); }
          for (let c = 0; c < nCalls; c++) {
            const call = calls[c] as (typeof calls)[number];
            call.template.apply(ctx, tSim, warmup, call.values);
          }
          refreshIfDetached();
          mj.mj_step(model, data);
          if (afterStep('trial')) { diverged = true; break; }
          if (pose !== undefined) pose.recordStep(simIndex - trigIndex, xpos, xquat); // D5: sim-step schedule
        }
        if (diverged) break;
      }
    } // !warmDiverged

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
    let m: { robustness: number; worstAt: number; unit: string };
    if (warmDiverged) {
      // The empty trace gives no verdict; ask the monitor only for its unit.
      let unit = '';
      try { unit = req.monitor(trace).unit; } catch { unit = ''; }
      m = { robustness: DIVERGED_ROBUSTNESS, worstAt: simIndex * simDt, unit: typeof unit === 'string' ? unit : '' };
    } else {
      m = req.monitor(trace);
      if (divergence === undefined) {
        // D10: every number in a TrialResult must survive JSON.
        if (decided === undefined && Number.isNaN(m.robustness)) {
          throw new SimError(`The monitor of requirement ${req.id} returned robustness NaN; a number is required`);
        }
        if (!Number.isFinite(m.worstAt)) {
          throw new SimError(`The monitor of requirement ${req.id} returned worstAt ${String(m.worstAt)}; a finite time in seconds is required`);
        }
      }
    }
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
      robustness: divergence !== undefined ? DIVERGED_ROBUSTNESS : decided !== undefined ? decided : finiteRobustness(m.robustness),
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
      restoreModelSnapshot(model, guard);
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