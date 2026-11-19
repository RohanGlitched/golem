# Implementation Plan: golem-sim

## Overview

The plan builds `skeleton/src/sim` bottom-up in TypeScript (strict, ES modules, Node 20 or later), following the design's source layout. Pure and fake-`Mj` pieces come first (errors, PRNG, handle registry, loader, file writer, model cache, helpers, context, validation, pose recorder). Then the inline Test_App and the test fixtures follow. Then `runTrial` is built in four increments, and the property tests that need real physics come last.

Rules that apply to every task:

- A task that adds logic adds its Vitest example tests in the same task (testing.md). Each correctness property from the design has its own fast-check sub-task. Those property sub-tasks are not marked optional, because testing.md requires properties for every core module.
- Property tests use a fixed, logged fast-check seed. Physics properties run at least 25 cases, and pure properties run at least 100 cases. Every physics trial simulates at most 2 s (`warmup + horizon`).
- Never weaken an assertion or a requirement to make a test pass. If a test is wrong, say why in the commit message.
- The interfaces in `.kiro/steering/interfaces.md` are fixed. Only add-only changes are allowed: `RobotApp.names?` and `SimContext.lookup`.
- Apps and other modules import `sim` only through `skeleton/src/index.ts` and `skeleton/src/node.ts`. Tests inside `skeleton/src/sim` may import internals by relative path.
- No `Math.random()` anywhere in `skeleton/src/sim`. Every MuJoCo handle goes through the registry and is deleted exactly once. Follow `mujoco-wasm.md` for loading, `FS` use and handle rules.
- The 2 s load-and-compile budget for the Test_App is a CI test. The 5 s real-robot load-and-compile budget is an `evidence/` benchmark and is never a CI test.

## Tasks

- [x] 1. Foundations: errors, types, PRNG
  - [x] 1.1 Create `errors.ts`, `types.ts` and shared test support
    - `SimError` extends `Error` with `{ cause }` and plain-language messages.
    - `wrapTrialError(e, app, req, spec)` builds `Trial failed (app <id>, requirement <id>, seed <n>): <cause message>`, sets `cause`, and does not wrap a `SimError` twice.
    - `types.ts` holds `Mj`, `ObjType`, `EarlyStopHook`, `RunOptions` and the add-only `RobotApp.names?` and `SimContext.lookup` additions.
    - Add `test-support.ts` with the fixed logged fast-check seed, the `numRuns` constants (25 physics, 100 pure), and a failure reporter that prints app id, requirement id, scenario and seed.
    - Check that `vitest.config.ts` picks up `skeleton/src/sim/**/*.test.ts` and that `fast-check` is a devDependency of `skeleton`.
    - Example tests: `wrapTrialError` message contains app id, requirement id and decimal seed. It keeps `cause`, contains no stack text, and does not double-wrap.
    - _Requirements: 14.2, 14.3, 14.11, 15.1, 15.11_

  - [x] 1.2 Implement `prng.ts` (`mulberry32`)
    - Single `uint32` closure state, no BigInt, no per-draw allocation, output in [0, 1).
    - Example tests: same seed gives equal first 1000 values, different seeds differ, and values are in [0, 1).
    - Example test: source scan shows no `Math.random` under `skeleton/src/sim`.
    - _Requirements: 5.2, 5.3_

- [x] 2. Handle registry and Handle_Counter
  - [x] 2.1 Implement `handles.ts`
    - `HandleRegistry` (`track`, `release`, `live`), module-level `registry`, `liveHandleCount()`, and `TrialScope` (`track`, LIFO `disposeAll`).
    - The counter is derived from the live set. `release` is idempotent, and a second release makes no second WASM `.delete()` call.
    - `disposeAll` continues after a throwing `.delete()` and rethrows the first error only if none is already propagating.
    - Example tests: a throwing `.delete()` does not stop the remaining deletes, and LIFO order.
    - _Requirements: 10.12, 10.13, 10.16_

  - [x] 2.2 Write property test for the handle registry
    - **Property 19: Handle registry counts live handles**
    - **Validates: Requirements 10.12, 10.13, 10.16**

- [x] 3. Fake MuJoCo for fast tests
  - [x] 3.1 Create `test-fixtures.ts` with `withFakeMj()`
    - In-memory fake `Mj` with `FS` (`mkdirTree`, `writeFile`, `readFile`, directory listing), `MjModel.from_xml_path`, `MjData`, `DoubleBuffer`, `mj_name2id`, `mj_geomDistance`, and per-handle delete counters.
    - Fault injection: make `mkdirTree`, `writeFile`, `from_xml_path` or the buffer callback throw on demand.
    - The file is test-only and is not exported from `index.ts`.
    - Example tests for the fake itself: delete counters and FS round trip.
    - _Requirements: 2.1, 3.1, 10.2_

- [x] 4. MuJoCo loader
  - [x] 4.1 Implement `loader.ts` (`loadMujoco`, `__setLoadFnForTests`)
    - Single memoised `inflight` promise per worker module. The failed attempt is cleared before waiters see the rejection. Errors are `SimError` naming `@mujoco/mujoco` and the cause. Load with `import load from '@mujoco/mujoco'` and make no network call other than the package's static WASM fetch.
    - Example tests with a fake load function: same object by reference, overlapping calls load once, all waiters reject with the same error, retry after failure succeeds, and the message names the package and the cause.
    - Example tests with real MuJoCo: the first load resolves in 2 s or less and exposes `MjModel`, `MjData`, `mj_step`, `mj_name2id`, `mj_geomDistance`, `DoubleBuffer` and `FS`. A second call returns the same object in 10 ms or less.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_

- [x] 5. File writer
  - [x] 5.1 Implement `file-writer.ts` (`validateRobotPaths`, `writeRobotFiles`)
    - Validate every path and the scene file before the first write (all-or-nothing). Reject empty, absolute, drive-letter, backslash, `..` and empty-segment paths, a missing scene file and an empty record. Then write with `mj.FS.mkdirTree` and `mj.FS.writeFile` in record-key order, never `MjVFS.addBuffer`. Wrap FS errors with app id, path and cause.
    - Example tests (fake `Mj`): one error test per rejection case asserting the message names the path or scene file and that the FS is unchanged, `mkdirTree` throwing names app id, path and cause, a 0-byte file, a 50 MiB file, overwrite on a second call, existing directory accepted, key-order writes, and no `addBuffer` call.
    - Timing example (real `Mj`, short): 200 small files of 20 MiB or less in total finish in 500 ms or less.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12_

  - [x] 5.2 Write property test for the file round trip
    - **Property 15: File round trip**
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.8, 15.7**

  - [x] 5.3 Write property test for invalid paths
    - **Property 16: Invalid paths change nothing**
    - **Validates: Requirements 2.6, 2.7, 2.10**

- [ ] 6. Model cache
  - [~] 6.1 Implement `model-cache.ts` (`ModelCache`)
    - A per-instance `Map<string, Promise>` with a `generation` counter. `getModel` stores the in-flight promise synchronously, deletes a failed entry, wraps errors with the app id, and deletes any partial model handle once. `dispose` deletes every settled model once, and a compile that finishes after `dispose` deletes itself and rejects.
    - Example tests (fake `Mj`): `files()` called once, a hit skips `files()`, FS and compile, concurrent requests share one compile, a failure leaves no entry and other ids unchanged, a retry after failure, and `dispose` then a new request compiles again.
    - Example test: the message includes the app id and the compiler message.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [~] 6.2 Write property test for the model cache
    - **Property 17: Model cache compiles once and recovers**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9**

- [x] 7. Handle helpers
  - [x] 7.1 Implement `helpers.ts` (`withDoubleBuffer`, `geomDistance`, `forEachContact`)
    - Validate `n` before creating a buffer. Track and release through the registry in `finally`. `geomDistance` copies `fromto` into a new array. `forEachContact` visits `0..ncon-1` in ascending order and still deletes the vector when `ncon` is 0.
    - Example tests (fake `Mj`): an invalid `n` names the length and creates no buffer, delete-once on return and on throw, the same error rethrown, `fromto` copy valid after delete, and a buffer length of 6.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11_

  - [x] 7.2 Write property test for the helpers
    - **Property 18: Helpers delete exactly once**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11**

- [x] 8. Context builder
  - [x] 8.1 Implement `context.ts` (`buildContext`)
    - Resolve names with `mj.mj_name2id(model, mj.mjtObj.<type>.value, name)`. Fill `ctx.ids` as `<type>:<name>` from `app.names`. Throw on an empty name without calling `mj_name2id`, on an unknown name, and on a name of the wrong type. Return the same `mj`, `model` and `data` references plus `lookup`.
    - Example tests (fake `Mj`): ids in range, the same name twice gives the same id, an empty name makes no `mj_name2id` call, a wrong-type name throws naming the requested type, an unknown declared name throws and leaves `ctx.ids` unchanged, and the object references are identical.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.9, 4.10, 4.11_

- [x] 9. Trial validation
  - [x] 9.1 Implement `validate.ts` (`validateTrial`, `normaliseScenario`)
    - Run checks in the design's order: app id, `simDt` and `controlDt`, warm-up, horizon, seed, scenario (missing, non-finite, normalised), template names and param dimension names. Build the `ResolvedCall` list with its `values` objects once. Touch no MuJoCo handle.
    - Example tests: one per error (app-id mismatch naming both ids, bad `controlDt/simDt`, bad warm-up naming seconds, bad horizon, bad seed, missing dimensions all named, non-finite value, out of range naming dimension and range in SI, unknown template, unknown param dimension), each leaving the handle counter and cache unchanged.
    - _Requirements: 5.12, 5.13, 5.14, 6.5, 6.6, 6.11, 6.12, 7.2, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10_

  - [x] 9.2 Write property test for scenario normalisation
    - **Property 10: Scenario normalisation**
    - **Validates: Requirements 14.4, 14.5, 14.6, 14.7, 14.8, 6.5, 6.11**

- [x] 10. Pose recorder
  - [x] 10.1 Implement `pose-recorder.ts` (`PoseRecorder`)
    - Allocate `nbody*7*(floor(horizon*30)+2)` float32 values once. `maybeRecord` records the first frame, then frames at least `1/30 - 1e-9` s apart. A capacity guard keeps it safe. `finish()` returns a subarray with `fps: 30`.
    - Example tests: frame layout `(x, y, z, qw, qx, qy, qz)` per body, float32 conversion only, non-finite values stored unchanged, spacing and capacity, `finish()` length equals `nbody*7*frameCount`, and no growth after construction.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.8, 8.11_

- [ ] 11. Test_App
  - [~] 11.1 Implement `test-app.ts` (`testApp`, `makeTestRequirement`, `makeAlwaysHook`, `makeEventuallyHook`)
    - Inline MJCF from the design under `scene.xml` (`files()` returns exactly one entry). `simDt` 0.002 s, `controlDt` 0.02 s, `warmup` 0.2 s. `names` for `box`, `bob`, `hinge`, `drive`. Signals `box.z`, `bob.angle`, `bob.speed`. PD controller clamped to `ctrlrange`, reading only hinge angle and speed. `initState` makes exactly one PRNG draw within Â±0.1 rad. The `push` template writes `xfrc_applied` only inside `[tTrigger, tTrigger + duration)` and writes nothing at 0 N. Hand-built `CompiledRequirement` fixtures with no dependency on `ears`.
    - Example tests (real MuJoCo, no trial loop): model compiles through the loader, writer and `buildContext` in 2 s or less (the CI budget), contains `box` with a free joint, `bob`, `hinge` and `drive`, timings match, `mj timestep === simDt`, signals finite, the torque is clamped, `initState` draws once and stays within 0.1 rad, `push` is zero outside its window, and a 0 N push leaves `xfrc_applied` zero.
    - The app imports nothing outside `skeleton/src/sim` except `@mujoco/mujoco` types and contract types.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.10, 13.11, 3.12_

- [ ] 12. Behaviour fixtures
  - [~] 12.1 Add app wrappers to `test-fixtures.ts`
    - `withThrowingController`, `withThrowingSignals`, `withNaNControl`, `withModelAlteringTemplate`, `withSpyTemplate`, `withNoDraws`.
    - Example tests per wrapper confirming that it changes only its one behaviour, for example the spy log records `(t, tTrigger, values identity, xfrc snapshot)`.
    - _Requirements: 6.13, 7.13, 3.11, 11.9_

- [~] 13. Checkpoint - Building blocks complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Episode runner
  - [~] 14.1 Implement `episode.ts`: setup and warm-up
    - `runTrial(app, req, spec, opts)`: validate before any handle, get the model from `opts.cache`, snapshot the guarded model fields, open a `TrialScope`, create the `MjData`, create `mulberry32(seed)`, call `buildContext`, then `initState` once, then `makeController` once with the same rng. Read the six views once. Warm up with exactly `round(warmup/controlDt)` control steps and `round(warmup/simDt)` sim steps, with no `apply` call, no `xfrc_applied` write and no sample. Throw on divergence during warm-up. `finally` restores the model, then runs `disposeAll`. Errors go through `wrapTrialError`.
    - Example tests: call order `initState` then `makeController` with the same rng, step counts at the trigger, zero `apply` calls in warm-up, `initState` throwing and `makeController` throwing both leave the handle counter unchanged, validation errors create no `MjData`, and an error message carries app id, requirement id, seed and `cause`.
    - _Requirements: 5.1, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 3.10, 3.11, 14.1, 14.2, 14.3_

  - [~] 14.2 Extend `episode.ts`: trigger, perturbations, sampling, monitor, result
    - Push the `trigger` event, clear `xfrc_applied`, allocate the Trace arrays (the signal arrays in the sample-0 prologue, per design D6), then sample `k` with `t = warmup + k*controlDt`, one `controller.step` per control step, and `n` sim steps each clearing `xfrc_applied` then applying calls in array order with `t` as the start of the step. Stop at the horizon, call the monitor once on the trimmed trace, and return `TrialResult` with the spec, `wallMs` and the monitor result.
    - Example tests: trigger precedes sample 0 and the first `apply`, an empty `perturbations` array still gives the trigger event, `ctrl` is Bit-identical across a control step's sim steps, `signals` is called once per control step before its sim steps, non-finite signal values are stored unchanged, `apply` throws and `signals` throws and `controller.step` throws and `monitor` throws each reject with the cause and no leaked handle, and `result.spec` deep-equals the input with `wallMs` finite and at least 0.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.13, 6.14, 7.1, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.13, 9.1, 9.5, 9.8, 9.9, 9.10, 9.11_

  - [~] 14.3 Extend `episode.ts`: divergence, early stop, poses
    - Add the `qpos` finite check after each sim step with one `diverged` event and `-Infinity` robustness, and call the monitor on the recorded prefix. Add the early-stop hook once per sample, with reject for `NaN` or non-number returns and stopping after the current sample, with no further sim step. Add the `PoseRecorder` after the trigger, with `finish()` in the result.
    - Example tests: a hook returning `NaN`, a string or an object rejects and deletes `MjData`, a hook throwing rejects without calling the monitor, a decided value at the final sample ends the trial there, divergence gives `worstAt` equal to the divergence time, and the pose count and `poses` absence with `record` `'none'` are right.
    - _Requirements: 7.11, 7.12, 8.6, 8.9, 9.2, 9.3, 9.4, 9.6, 9.7, 9.12, 9.13, 9.14, 9.15_

  - [~] 14.4 Extend `episode.ts`: view refresh and allocation discipline
    - Compare `view.buffer` identity once per control step and re-read the views before the next `mj_step`. Ensure the Step_Loop uses index loops and reuses `out`, `values` and the signal pairs, with no closures or strings.
    - Example tests (Test_App, at most 2 s simulated): a probe around `mj_step` and `controller.step` shows an unchanged handle counter and zero new `Float64Array` or `Float32Array` instances inside the loop, `out` identity is equal at every call, forced WASM memory growth in a controller gives the same trace as no growth, and heap growth with a 1.5 s horizon and forced GC is 64 KiB or less (only when run with `--expose-gc`). Also a 2 s trial with a warm model completes in under 1 s.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 13.9_

- [ ] 15. Runner property tests (Test_App, at most 2 s simulated per trial)
  - [~] 15.1 Write property test for determinism
    - **Property 1: Determinism**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 15.2**

  - [~] 15.2 Write property test for trace length
    - **Property 2: Trace length**
    - **Validates: Requirements 7.6, 7.7, 7.8, 15.3**

  - [~] 15.3 Write property test for the exact time axis
    - **Property 3: Time axis is exact**
    - **Validates: Requirements 7.5, 7.9, 5.8**

  - [~] 15.4 Write property test for the trigger event
    - **Property 4: Trigger event**
    - **Validates: Requirements 6.1, 6.2, 6.14, 15.4**

  - [~] 15.5 Write property test for warm-up isolation
    - **Property 5: Warm-up isolation and step counts**
    - **Validates: Requirements 5.7, 5.8, 5.9, 6.4**

  - [~] 15.6 Write property test for early-stop soundness
    - **Property 6: Early stop is sound**
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.15, 15.5**

  - [~] 15.7 Write property test for perturbation call order
    - **Property 7: Perturbation calls are ordered, fresh and stable**
    - **Validates: Requirements 6.3, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 11.10**

  - [~] 15.8 Write property test for handle leaks
    - **Property 8: No handle leaks**
    - **Validates: Requirements 5.10, 5.11, 6.13, 7.13, 9.10, 9.11, 9.12, 10.14, 10.15, 14.1, 14.10, 15.6**

  - [~] 15.9 Write property test for failed-trial identity
    - **Property 9: Failed trials report their identity**
    - **Validates: Requirements 14.2, 14.3, 14.11**

  - [~] 15.10 Write property test for finite robustness unless diverged
    - **Property 11: Finite robustness unless diverged**
    - **Validates: Requirements 7.11, 7.12, 9.13, 15.9**

  - [~] 15.11 Write property test for the pose frame layout
    - **Property 12: Pose frame layout**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.8, 8.9, 8.11**

  - [~] 15.12 Write property test for pose-recording invariance
    - **Property 13: Pose recording does not change the result**
    - **Validates: Requirements 8.7, 15.8**

  - [~] 15.13 Write property test for the unchanged cached model
    - **Property 14: The cached model is unchanged by trials**
    - **Validates: Requirements 3.10, 3.11**

  - [~] 15.14 Write property test for PRNG and seed behaviour
    - **Property 20: PRNG and seed behaviour**
    - **Validates: Requirements 5.2, 5.14, 11.9**

- [ ] 16. Error catalogue
  - [~] 16.1 Write `errors.catalogue.test.ts`
    - One example test for each error condition in Requirements 1, 2, 3, 4, 5, 6, 7, 9, 10 and 14 not already covered by an earlier example test. Each asserts that the message contains the identifiers the criterion names. Reference the covering test for conditions covered elsewhere.
    - _Requirements: 15.10, 15.11_

- [ ] 17. Public exports and wiring
  - [~] 17.1 Wire `skeleton/src/sim/index.ts`, `skeleton/src/index.ts` and `skeleton/src/node.ts`
    - Export `loadMujoco`, `writeRobotFiles`, `validateRobotPaths`, `ModelCache`, `buildContext`, `liveHandleCount`, `withDoubleBuffer`, `geomDistance`, `forEachContact`, `mulberry32`, `runTrial`, `PoseRecorder`, `testApp`, `makeTestRequirement`, `SimError` and the types. Keep `HandleRegistry`, `TrialScope`, test seams and fixtures internal.
    - Example tests: the export surface matches the list, and nothing under `sim` imports from `ears`, `falsify`, `pool` or `ui`.
    - _Requirements: 10.13, 13.1, 13.10_

- [ ] 18. Evidence benchmarks (not CI)
  - [~] 18.1 Add `evidence/sim-model-load.bench.ts`
    - Time the first loader load plus the first `ModelCache` compile for the Unitree G1 (`apps/stagger/robot`) and report against the 5 s budget. If the assets are not present, print a message that says so and exit 0. Write the result as JSONL under `evidence/`. Do not register it with the Vitest CI run.
    - _Requirements: 1.9, 3.12_

  - [~] 18.2 Add `evidence/sim-cross-runtime.ts`
    - Run a fixed Test_App `TrialSpec` in Node, write `t` and `signals` to JSONL, and provide the comparison step for a browser run: `t` Bit-identical, `signals` within 1e-9 relative. Not a CI test.
    - _Requirements: 1.11_

- [~] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Property tests are required here and are not marked optional, because testing.md says every core module has properties.
- Tests for conditions that need `ears` monitors use the hand-built `makeTestRequirement` fixtures, so `sim` has no dependency on `ears`.
- Property 20 covers the PRNG range and equal-seed behaviour, seed rejection, and seed independence. It sits at 15.14 because the seed-independence part needs `withNoDraws` and a full `runTrial`.
- Requirement 12.9 (heap growth) is an example test that runs only when Node starts with `--expose-gc`. If the flag is absent, the test reports that it was skipped. It is never silently passed.
- Requirement 1.11 (Node against browser) and the 5 s robot-app budget are `evidence/` work (tasks 18.1 and 18.2). They are not part of the CI suite.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1", "4.1", "8.1", "9.1", "10.1"] },
    { "id": 2, "tasks": ["2.2", "5.1", "7.1", "9.2"] },
    { "id": 3, "tasks": ["5.2", "5.3", "6.1", "7.2", "11.1"] },
    { "id": 4, "tasks": ["6.2", "12.1"] },
    { "id": 5, "tasks": ["13"] },
    { "id": 6, "tasks": ["14.1"] },
    { "id": 7, "tasks": ["14.2"] },
    { "id": 8, "tasks": ["14.3"] },
    { "id": 9, "tasks": ["14.4"] },
    { "id": 10, "tasks": ["15.1", "15.2", "15.3", "15.4", "15.5", "15.6", "15.7", "15.8", "15.9", "15.10", "15.11", "15.12", "15.13", "15.14", "16.1", "17.1", "18.1", "18.2"] },
    { "id": 11, "tasks": ["19"] }
  ]
}
```
