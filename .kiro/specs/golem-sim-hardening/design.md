# Design: golem-sim-hardening

## Overview

All changes stay inside `skeleton/src/sim`. The runner keeps its shape (validate, set up, warm up, trigger, step loop, monitor, clean up). The fixes add checks and hooks to that loop and replace the per-trial allow-list guard with a compile-time full snapshot. No other module consumes sim yet (`falsify`, `pool` and `cli` are empty), so the contract additions below are the only cross-module change.

## Contract additions (add-only)

Recorded in `.kiro/steering/interfaces.md` under "Approved additions":

```ts
interface Controller { step(ctx, t): void; substep?(ctx: SimContext, tSim: number): void }
interface PerturbationTemplate { /* … */ begin?(ctx: SimContext, values: Record<string, number>): void }
interface TrialResult { /* … */ hash: string }
```

Sim-level additions (in `skeleton/src/sim/types.ts`, like the existing `RobotApp.names` and `SimContext.lookup`):

```ts
type IntegratorName = 'euler' | 'rk4' | 'implicit' | 'implicitfast';
interface DivergenceInfo {
  t: number; phase: 'warmup' | 'trial';
  cause: 'qpos' | 'qvel' | 'qacc' | 'warning';
  index: number; value: number;                 // first bad entry (-1 / NaN for 'warning')
  warnings: Record<string, number>;             // MuJoCo warning counters by name, e.g. BADQACC
  solverIterations: number; contacts: number;   // at the failing step
}
interface TrialDiagnostics {
  horizon: number; simSteps: number; timestep: number; integrator: IntegratorName;
  warnings: Record<string, number>;
  maxSolverIterations: number; solverSaturatedSteps: number; maxContacts: number;
  diverged?: DivergenceInfo; numerical: boolean;
}
interface TrialResult { /* … */ hash: string; diagnostics: TrialDiagnostics }
interface RunOptions { cache; earlyStop?; numerics?: { simDt?: number; integrator?: IntegratorName } }
const DIVERGED_ROBUSTNESS = -Number.MAX_VALUE;
```

The `diverged` trace event is `{ name: 'diverged', ...DivergenceInfo }`, which is assignable to the contract's `{ name: string; t: number }`.

## Runner flow after the fix

```
validate (horizon rounded up, D11)
snapshot = modelSnapshot(model)               // compile-time, D6
opt.disableflags |= AUTORESET                 // D1
apply RunOptions.numerics (timestep, integrator) // I2
data = new MjData; ctx; initState; mj_forward // D4
hash.update(qpos)                             // I3
controller = makeController
warm-up: for each control step: step(); for each sim step: substep(); mj_step; check(); hash
   check fails -> warm-up divergence result (D8)
trigger: xfrc = 0; template.begin() in order  // D7
for k = 0..N:
   reset known signals to NaN; app.signals    // D11
   record sample k; earlyStop -> decided value kept (D9)
   step()
   for each sim step: xfrc = 0; substep(); apply()...; mj_step; check(); hash; pose (D5)
end: read warnings once; BAD* > 0 -> diverged (D2)
monitor -> robustness: diverged ? DIVERGED_ROBUSTNESS : decided ?? clamp(monitor) (D10)
finally: endTrial; restoreModelSnapshot (D6, also undoes D1 and I2); dispose handles
```

## Decisions

**Divergence check (D2).** MuJoCo raises `BADQPOS`, `BADQVEL` and `BADQACC` exactly when an entry is non-finite or above mjMAXVAL (1e10). The runner applies the same test to the live `qpos`, `qvel` and `qacc` views after every step. This is a loop over `nq + 2 nv` doubles with no allocation, and it catches the blow-up at the step it happens, before the next step can make it worse. Reading `data.warning` per step was rejected: each read creates one embind handle per counter (measured: 200 000 reads grew WASM memory from 17.6 MB to 76 MB when the element handles were not deleted). The vector returned by `data.warning` is a reference into MjData and must never be `.delete()`d (doing so aborts the WASM module); its elements are copies and must be. The counters are read at divergence and at the end of the trial, and a non-zero BAD* counter at the end marks the trial diverged (`cause: 'warning'`), so no warning can be missed.

**Solver and contact stats (I1).** Per step the runner reads `data.ncon`, `data.nisland` and the live `solver_niter` view (an `Int32Array`). The solver iteration count of a step is the maximum over islands (`solver_niter[0]` when `nisland` is 0). A step is "saturated" when it used `opt.iterations` iterations, meaning the solver stopped without converging.

**Auto-reset (D1).** The bit is set on the shared model for the trial and undone by the snapshot restore. Read from `mj.mjtDisableBit.mjDSBL_AUTORESET.value` with 65536 as fallback.

**Full snapshot (D6, I5).** Every `mjModel` array lives in `model.buffer` (a `Uint8Array` view, 8.6 KB for the test box, a few MB for G1). The snapshot copies it once per compiled model, in `ModelCache.compile`, into a `WeakMap<model, snapshot>`; a model from elsewhere is snapshotted lazily on its first trial. The restore is an unconditional `buffer.set(copy)` (a memcpy, cheaper than comparing) plus every `opt` number and array. `vis` and `stat` are not snapshotted because they do not affect dynamics. Consequence: the cached model is always the compiled model after a trial, and edits made to it outside a trial are reverted at the end of the next trial. `changedModelFields` maps differing byte ranges back to field names by the byte offset of each array view inside `model.buffer`.

Alternative rejected: a per-trial snapshot (the old design) copies the whole buffer on every trial and still needs a full list of fields.

**Substep order (D3).** `substep` runs before `apply` so that a perturbation (actuator failure, torque scaling) can override what the PD loop wrote. `xfrc_applied` is cleared before `substep`, so a controller may also write external forces (a support harness) that perturbations then add to.

**begin (D7).** Called after warm-up, after `xfrc` is cleared, before sample 0. The snapshot restore undoes any model change `begin` made, so templates need no `endTrial` for model fields.

**Poses (D5).** The recorder counts sim steps after the trigger and records frame `f` at step `ceil(f / (fps · simDt) − 1e-9)`. Every frame is then within one `simDt` of `f / fps`, and the mean rate is exactly `fps`. Frame 0 is the state at the trigger. Reporting 25 fps (the other option in the audit) was rejected because the UI and reel assume 30.

**Warm-up divergence (D8).** The monitor is not given an empty trace for a verdict; it is called once in a `try` only to learn the unit, and the unit is `''` if it throws.

**Diverged robustness (D10).** `-Number.MAX_VALUE` is finite, so JSON keeps it, and it is below every physical margin, so sorting and the sign test still work. A JSON replacer was rejected because every writer would have to remember it.

**Horizon (D11).** Rounding up keeps "the trial covers the requirement's horizon". Rejecting non-multiples was rejected because requirement text such as "for 0.25 s" with 50 Hz control is legitimate.

**Hash (I3).** Two 32-bit lanes (FNV-1a and a Murmur3-style multiply-rotate), each finalised with `fmix32`, over the 32-bit words of `qpos` (a `Uint32Array` view on the same WASM memory, re-created only when memory growth detaches it). WASM memory is little-endian on every engine, so the words are the same everywhere. Only `Math.imul`, shifts and xor are used.

**Re-check (I2).** `recheckTrial` calls `runTrial` three times with `RunOptions.numerics`. Half step: `simDt / 2` and `opt.timestep = simDt / 2`, the same `controlDt`. Other integrator: Euler ↔ implicitfast, any other → Euler. A failure that survives both is reported as `survives: true`. The falsifier will call it on shrunk counterexamples and attach the report to the counterexample.

**Saturation (I4).** The meter copies the ranges at creation, which is per trial (in `makeController`), so it sees ranges set by domain randomisation in `initState` but allocates nothing per call.

## Test strategy

- Every defect gets a regression test that fails on the code before its fix. The final report records each test's failure before and pass after.
- New contact-rich models in `test-models.ts`: `boxDropApp` (free box on a plane, kick and shove templates, a site sensor) and `stoolApp` (torso on four hinged legs with motors and `ctrlrange`, a 50 Hz policy and a 500 Hz PD in `substep`, an inactive weld for `eq_data`, a free box on the floor for extra contacts).
- Hollow tests rewritten: P11 uses a real 1e30 N blow-up through the runner with no flag fiddling; P12 checks the frame count and frame times against the sim-step schedule; P14 mutates random fields drawn from the full list of model arrays and checks the whole `model.buffer` and `opt`.
- Physics tests keep ≤ 2 s simulated per trial, 25 runs per physics property, the fixed logged seed.
