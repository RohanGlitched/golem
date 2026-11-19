# Bugfix Requirements Document: golem-sim-hardening

## Introduction

An independent review of `skeleton/src/sim` (`docs/reviews/sim-audit.md`, probes `docs/reviews/sim-probe1..4.mts`) found eleven defects in the trial runner. Three of them can give a wrong verdict without any error: MuJoCo auto-reset hides blow-ups, divergence is only "qpos is NaN", and the model guard misses most model fields. One blocks the G1 app: there is no per-sim-step controller hook. This spec fixes defects 1 to 11 and adds five improvements that let an expert tell a numerical failure from a physical one (improvements 1 to 5 of the audit).

Terms:
- **Runner**: `runTrial` in `skeleton/src/sim/episode.ts`.
- **Trial step**: one `mj_step` after the trigger. **Warm-up step**: one `mj_step` before it.
- **mjMAXVAL**: `1e10`, the bound MuJoCo itself uses in `mj_checkPos`, `mj_checkVel` and `mj_checkAcc`.
- **Contact-rich test models**: `boxDropApp` (a box dropped on a plane) and `stoolApp` (a four-legged stool with PD-held hip joints), in `skeleton/src/sim/test-models.ts`.

The golem-sim criteria this spec supersedes are listed per defect. Every other golem-sim criterion still holds.

## Defect 1: auto-reset is never disabled (CRITICAL)

### Current Behavior
1.1 WHEN a trial produces bad accelerations (probe 3, step 6: a 1e30 N kick on a free box) THEN MuJoCo silently resets `qpos`, `qvel` and `data.time`, the trace looks healthy, the runner returns robustness +0.48 and no `diverged` event.

### Expected Behavior
1.2 WHILE a trial runs (warm-up included) THE runner SHALL set `mjDSBL_AUTORESET` (65536 in MuJoCo 4.0.1, read from `mj.mjtDisableBit`) in `model.opt.disableflags`.
1.3 WHEN the trial ends, by any path, THE runner SHALL restore `model.opt.disableflags` to its value before the trial.
1.4 WHEN the 1e30 N kick of 1.1 is applied THEN the trial SHALL end with one `diverged` event and a broken verdict, and `data.time` SHALL never decrease in the trace.

### Unchanged Behavior
1.5 WHEN no state exceeds mjMAXVAL THEN trials SHALL CONTINUE TO be bit-identical to the same trial before this fix (auto-reset never fires on a healthy state).

## Defect 2: divergence means only "qpos is NaN" (CRITICAL)

### Current Behavior
2.1 WHEN auto-reset is off and the state blows up to finite values (probe 1: qpos 1.6e27) THEN the runner sees no divergence, because it checks only `Number.isFinite(qpos)`.
2.2 WHEN a divergence is reported THEN the event carries only `{ name, t }`; nothing says which quantity failed or whether MuJoCo raised a warning.

### Expected Behavior
2.3 AFTER every warm-up and trial step THE runner SHALL check that every entry of `qpos`, `qvel` and `qacc` is finite with absolute value at most mjMAXVAL, without allocating.
2.4 WHEN the check fails THEN THE runner SHALL stop and record `{ name: 'diverged', t, phase, cause, index, value, warnings, solverIterations, contacts }`, where `cause` is `'qpos' | 'qvel' | 'qacc'`, `index` and `value` locate the first bad entry, and `warnings` holds MuJoCo's warning counters by name (`BADQACC`, ...).
2.5 WHEN a trial ends and any of the `BADQPOS`, `BADQVEL` or `BADQACC` counters is above 0 THEN THE runner SHALL treat the trial as diverged even if 2.3 did not fire, with `cause: 'warning'` and `t` equal to the time of the last step.

### Unchanged Behavior
2.6 THE trace of a diverged trial SHALL CONTINUE TO hold only the samples recorded before the divergence, with equal array lengths and exactly one `diverged` event (golem-sim 7.12).
2.7 `data.warning` SHALL be read only at divergence and at the end of the trial, never per step (it allocates one handle per element).

Supersedes golem-sim 7.11 (NaN-only check).

## Defect 3: no per-sim-step controller hook (BLOCKER for G1)

### Current Behavior
3.1 WHEN a controller needs to compute PD torque at the sim rate (Unitree: 500 Hz PD, 50 Hz policy) THEN it cannot, because the runner calls only `controller.step` once per control step.

### Expected Behavior
3.2 WHERE `controller.substep` is defined THE runner SHALL call `controller.substep(ctx, tSim)` before every `mj_step`, warm-up included, with `tSim` equal to the simulated time before that step (`simIndex * simDt`).
3.3 WITHIN every sim step (warm-up and trial) THE runner SHALL call, in order: clear `xfrc_applied`, `controller.substep`, each perturbation's `apply` (trial steps only), `mj_step`. Perturbations therefore get the last word on the inputs of the step.
3.4 THE total number of `substep` calls in a full trial SHALL equal `round(warmup/simDt) + round(horizon/controlDt) * n`.

### Unchanged Behavior
3.5 `controller.step` SHALL CONTINUE TO be called once at the start of each control step, and an app without `substep` SHALL give bit-identical results.

## Defect 4: no `mj_forward` after `initState`

### Current Behavior
4.1 WHEN `initState` writes `qpos` THEN the first `controller.step` and sample 0 (with warm-up 0) see stale `xpos` and zero `sensordata` (probe 4: z = 0 when qpos z = 0.9).

### Expected Behavior
4.2 AFTER `initState` (or after creating MjData when there is no `initState`) and before `makeController`, THE runner SHALL call `mj_forward(model, data)`.

### Unchanged Behavior
4.3 THE PRNG draw order and the number of sim steps SHALL CONTINUE TO be the same.

## Defect 5: poses claim 30 fps but are 25 fps

### Current Behavior
5.1 WHEN poses are recorded with controlDt 0.02 s THEN frames land only on control samples at least 1/30 s apart, so 51 frames cover 2 s (25 fps) while `fps` says 30.

### Expected Behavior
5.2 THE pose recorder SHALL record frame `f` at the first sim step boundary at or after `warmup + f / fps` (step index `ceil(f / (fps * simDt))` after the trigger), so every frame is within one `simDt` of its nominal time and a full trial has `floor(horizon * fps) + 1` frames.
5.3 THE reported `fps` SHALL be 30, or `1 / simDt` when `simDt > 1/30 s`.

### Unchanged Behavior
5.4 Recording poses SHALL CONTINUE TO leave robustness, worstAt, trace and hash bit-identical (golem-sim Property 13), and frames SHALL CONTINUE TO stop at an early stop or a divergence.

Supersedes golem-sim 8.x wording "at Control_Rate_Samples at least 1/30 s apart".

## Defect 6: the model guard is an allow-list

### Current Behavior
6.1 WHEN a template or app changes `body_pos`, `actuator_ctrlrange`, `jnt_stiffness`, `geom_solref`, `dof_armature`, `eq_data` or any field outside the eight guarded arrays THEN the change leaks into the next trial (probe 3, step 5).

### Expected Behavior
6.2 THE sim SHALL take one full snapshot of each compiled model: the whole `model.buffer` (every model array lives in it) and every number and array field of `model.opt`.
6.3 WHEN a trial ends, by any path, after `app.endTrial` THE runner SHALL restore the model from that snapshot, so the cached model is byte-equal to the compiled model.
6.4 THE sim SHALL export `changedModelFields(model)` that names every model array and `opt` field that differs from the snapshot.

### Unchanged Behavior
6.5 `app.endTrial` SHALL CONTINUE TO run before the restore, and the restore SHALL CONTINUE TO run when the trial throws.

Supersedes golem-sim 3.10 (eight named arrays).

## Defect 7: templates have no "once at trigger" hook

### Current Behavior
7.1 WHEN a template must change the model once (for example, double a mass) THEN it can only do so in `apply`, which runs at every sim step, so `mass *= 2` compounds 500 times per second.

### Expected Behavior
7.2 WHERE `template.begin` is defined THE runner SHALL call `template.begin(ctx, values)` exactly once per call in `req.perturbations`, in array order, at the trigger (`data.time === warmup`), before sample 0 and before the first `apply`.

### Unchanged Behavior
7.3 `apply` SHALL CONTINUE TO be called at every trial step in array order with the same `values` object.

## Defect 8: divergence during warm-up throws

### Current Behavior
8.1 WHEN the state diverges during warm-up THEN the runner rejects with `Simulation diverged during warm-up`, so the falsifier records an error instead of a counterexample.

### Expected Behavior
8.2 WHEN the state diverges during warm-up THEN THE runner SHALL return a TrialResult with the diverged robustness, `worstAt` equal to the divergence time, an empty trace, one `diverged` event with `phase: 'warmup'` and no `trigger` event.

### Unchanged Behavior
8.3 Handles SHALL CONTINUE TO be released and the model restored.

Supersedes golem-sim 7.11 (warm-up part) and the error catalogue entry for it.

## Defect 9: the early-stop hook's number is ignored

### Current Behavior
9.1 WHEN the early-stop hook returns 123 THEN the runner stops but returns the monitor's prefix robustness (probe 3, step 4: -2.27).

### Expected Behavior
9.2 WHEN the hook returns a finite number THEN THE runner SHALL return exactly that number as `robustness`, with `worstAt` and `unit` from the monitor run on the prefix.

### Unchanged Behavior
9.3 A hook that returns a non-number, NaN or Infinity SHALL CONTINUE TO be rejected.

## Defect 10: -Infinity robustness serialises as null

### Current Behavior
10.1 WHEN a diverged result (robustness `-Infinity`) or a monitor result of `±Infinity` is written with `JSON.stringify` (seeds, `report.json`, MCP) THEN it becomes `null`.

### Expected Behavior
10.2 THE runner SHALL report a diverged trial with `robustness = DIVERGED_ROBUSTNESS` (`-Number.MAX_VALUE`, exported), which is below every physical margin and survives a JSON round trip.
10.3 THE runner SHALL clamp a monitor robustness of `±Infinity` to `±Number.MAX_VALUE`, and SHALL reject a NaN robustness or a non-finite `worstAt` with an error that names the requirement.
10.4 FOR ALL TrialResults, `JSON.parse(JSON.stringify(r))` SHALL give equal `robustness`, `worstAt` and `hash`.

### Unchanged Behavior
10.5 The sign of robustness SHALL CONTINUE TO decide the verdict.

Supersedes golem-sim 9.13 and Property 11 (`-Infinity`).

## Defect 11: low-severity defects

### Current Behavior
11.1 A horizon that is not a multiple of `controlDt` is rounded to the nearest step, so 0.25 s at 0.02 s silently becomes 0.24 s.
11.2 `ValidatedTrial.warmupSimSteps` is computed and never used.
11.3 A signal that the app stops writing keeps its last value in every later sample.
11.4 Robot files stay in the MuJoCo in-memory FS after compiling, doubling memory per worker.
11.5 About 20 `any` types sit in sim internals where `MjModel` and `MjData` types exist.
11.6 26 files in `skeleton/src/sim` start with a UTF-8 BOM.

### Expected Behavior
11.7 THE runner SHALL round the horizon up to whole control steps (within 1e-9 relative), so the trial covers at least the requested horizon, and SHALL report the simulated horizon in `TrialResult.diagnostics.horizon`.
11.8 `warmupSimSteps` SHALL be removed.
11.9 BEFORE each `app.signals` call THE runner SHALL set every known signal to NaN, so a missing write shows as NaN.
11.10 AFTER compiling THE model cache SHALL unlink every file it wrote.
11.11 Sim internals SHALL use `MjModel` and `MjData` from `@mujoco/mujoco`; `any` SHALL remain only in the contract shapes of `interfaces.md` (`SimContext`) and where the bindings type a field as `any`.
11.12 No file in `skeleton/src/sim` SHALL start with a BOM.

### Unchanged Behavior
11.13 A horizon that is already a multiple of `controlDt` SHALL CONTINUE TO give `round(horizon/controlDt) + 1` samples.

## Improvement 1: numerical versus physical failure

1.I1 THE runner SHALL return `TrialResult.diagnostics` with: `horizon`, `simSteps`, `timestep`, `integrator`, the final `warnings` counters by name, `maxSolverIterations`, `solverSaturatedSteps` (steps whose solver used `opt.iterations` iterations), `maxContacts`, `diverged` (the divergence record of 2.4, if any) and `numerical` (true when the trial diverged or a BAD* counter is above 0).
1.I2 The per-step part SHALL read only integer fields and live views, with no allocation.

## Improvement 2: timestep and integrator re-check

2.I1 THE sim SHALL export `recheckTrial(app, req, spec, { cache })`, which runs the trial three times: as given, at `simDt / 2` (the same `controlDt`, so twice the sim steps per control step) and with the other integrator (Euler becomes implicitfast; every other integrator becomes Euler).
2.I2 It SHALL return each variant's robustness, divergence and hash, plus `survives` (the base trial failed and both variants failed) and `numericalSuspect` (the base failed, and a variant held or any run diverged).
2.I3 `runTrial` SHALL accept `RunOptions.numerics: { simDt?, integrator? }`, set them on the model for that trial only and restore them afterwards.

## Improvement 3: trajectory hash

3.I1 THE runner SHALL return `TrialResult.hash`, a 16-hex-digit hash of the IEEE-754 bytes of `qpos` after `mj_forward` and after every sim step (warm-up included), plus `nq` and the step count, computed with 32-bit integer operations only so that every JavaScript engine gives the same digest for the same trajectory.
3.I2 Pose recording and the early-stop hook decision SHALL NOT change the hash of the steps that were run.

## Improvement 4: sim-rate PD hook and torque saturation

4.I1 Defect 3 adds `Controller.substep`.
4.I2 THE sim SHALL export `createSaturationMeter(model)`, which copies `actuator_ctrlrange` and `actuator_ctrllimited` once and returns a function of `ctrl` giving `max_i |2 ctrl_i - (lo_i + hi_i)| / (hi_i - lo_i)` over ctrl-limited actuators (0 when there are none). A value of 1 or more means at least one command is at or past its limit. The function does not allocate.

## Improvement 5: full snapshot and restore

5.I1 Defect 6 provides the snapshot, the restore and `changedModelFields`, so a test can show that randomising any model field in one trial leaves no trace in the next.
