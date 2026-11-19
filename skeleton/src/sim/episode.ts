// Episode runner: one trial is a pure function of (app, requirement, scenario, seed).
// After the model is in hand the whole body is synchronous, so trials never interleave in a worker.
import { SimError, wrapTrialError } from './errors.js';
import { TrialScope } from './handles.js';
import { buildContext } from './context.js';
import { PoseRecorder } from './pose-recorder.js';
import { mulberry32 } from './prng.js';
import type {
  CompiledRequirement, RobotApp, RunOptions, SimContext, Trace, TrialResult, TrialSpec,
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

function allFinite(a: ArrayLike<number>): boolean {
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i])) return false;
  }
  return true;
}

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
    const controller = app.makeController(ctx, rng);

    // Live views, read once. Re-read only when WASM memory growth detaches them.
    let qpos: Float64Array = data.qpos;
    let xfrc: Float64Array = data.xfrc_applied;
    let xpos: Float64Array = data.xpos;
    let xquat: Float64Array = data.xquat;
    const refreshIfDetached = (): void => {
      if (qpos.buffer.byteLength === 0 || xfrc.buffer.byteLength === 0
        || xpos.buffer.byteLength === 0 || xquat.buffer.byteLength === 0) {
        qpos = data.qpos; xfrc = data.xfrc_applied; xpos = data.xpos; xquat = data.xquat;
      }
    };

    const { simDt, controlDt, warmup } = app;
    const { n, calls } = v;
    const nCalls = calls.length;
    const N = v.controlSteps;
    let simIndex = 0;

    // ---- warm-up: no perturbation, no sample, xfrc stays zero
    for (let c = 0; c < v.warmupControlSteps; c++) {
      controller.step(ctx, simIndex * simDt);
      refreshIfDetached();
      for (let j = 0; j < n; j++) {
        mj.mj_step(model, data);
        simIndex++;
        if (!allFinite(qpos)) {
          throw new SimError(`Simulation diverged during warm-up at t = ${simIndex * simDt} s`);
        }
      }
      refreshIfDetached();
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
    let diverged = false;
    let divT = 0;

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
      for (let j = 0; j < n; j++) {
        xfrc.fill(0);
        const tSim = simIndex * simDt;
        for (let c = 0; c < nCalls; c++) {
          const call = calls[c] as (typeof calls)[number];
          call.template.apply(ctx, tSim, warmup, call.values);
        }
        mj.mj_step(model, data);
        simIndex++;
        if (!allFinite(qpos)) {
          diverged = true;
          divT = simIndex * simDt;
          break;
        }
      }
      if (diverged) break;
      refreshIfDetached();
    }

    // ---- end of trial
    if (diverged) events.push({ name: 'diverged', t: divT });
    let trace: Trace = traceView;
    if (recorded !== N + 1) {
      const sub: Record<string, Float64Array> = {};
      for (let i = 0; i < sigNames.length; i++) sub[sigNames[i] as string] = (sigArrs[i] as Float64Array).subarray(0, recorded);
      trace = { t: traceT.subarray(0, recorded), signals: sub, events };
    }
    const m = req.monitor(trace);
    const result: TrialResult = {
      spec,
      robustness: diverged ? -Infinity : m.robustness,
      worstAt: diverged ? divT : m.worstAt,
      unit: m.unit,
      wallMs: performance.now() - t0,
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
