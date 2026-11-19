# Implementation Plan: stagger-app

## Overview

Build `apps/stagger` bottom-up: package scaffold and runtime state, the pure asset-pipeline libraries, the controller (policy, observation, PD law, latency, walker), signals, lexicon, the `RobotApp`, the robot's own EARS requirements, and the studio page. Pure logic comes first so that each step has fast Vitest and fast-check tests with no MuJoCo. Physics-backed tests (parity, smoke, determinism) come after the committed assets exist and use at most 2 s of simulated time.

Conventions for every task:
- TypeScript strict, ES modules, Node 20 or later. The `.mjs` asset scripts are plain ESM with JSDoc types.
- Import skeleton code only from `golem-spec`, `golem-spec/ui` and `golem-spec/node`. Use no `Math.random()` and allocate nothing in hot paths.
- Logic and its example tests land in the same task. Property tests are separate sub-tasks marked optional, one per design property group, with at least 100 runs (5 to 10 for physics-backed ones) and the tag comment `Feature: stagger-app, Property N: <title>`.
- Test files live in `apps/stagger/test/`. Each task names its own test file so tasks in one wave never write the same file.
- Never weaken an assertion, a tolerance, the parity fixture or a requirement line to make a test pass.

## Tasks

- [x] 1. Package scaffold and runtime state
  - [x] 1.1 Create the `apps/stagger` package scaffold
    - Add `package.json` (name `stagger`, ES modules, Node >= 20, Apache-2.0, script `assets` running `scripts/fetch-assets.mjs`, script `test` running `vitest --run`), `tsconfig.json` with `strict`, and `vitest.config.ts`
    - Dependencies: `golem-spec`, `@mujoco/mujoco`; dev dependencies: `quickhull3d`, `meshoptimizer`, `vitest`, `fast-check`, `typescript`, `vite`
    - Create the empty folders `controller/`, `robot/`, `scripts/lib/`, `web/`, `test/fixtures/`, and an Apache-2.0 `LICENSE` for app code at `apps/stagger/LICENSE`
    - Write `test/package.test.ts` (example): checks `package.json` fields, the `assets` script, strict TypeScript, and the dependency lists
    - _Requirements: 5.3, 10.1, 10.4, 10.6, 10.7, 21.5_

  - [x] 1.2 Implement `runtime.ts` with `StaggerRuntime`
    - Define `StaggerRuntime`, `runtimeFor(ctx)` (WeakMap lookup, allocates all arrays once per ctx) and `resetRuntime(rt)` exactly as in the design
    - Defaults: `command = [0.5, 0, 0]`, `delaySteps = 0`, trigger and push unlatched, `saved.has = false`
    - Write `test/runtime.test.ts` (example): the same ctx returns the same object, different ctx return different objects, `resetRuntime` restores defaults, and a second `runtimeFor` call allocates nothing new
    - _Requirements: 8.10, 15.3, 15.10, 21.3_

- [x] 2. Asset pipeline libraries and script
  - [x] 2.1 Implement `urls.mjs`, `zip.mjs`, `stl.mjs` and file naming
    - `PINNED_COMMIT` (40 lowercase hex, one constant), `upstreamUrl`, `isAllowedHost`
    - `readZipEntries` with stored and deflate entries using `node:zlib` only
    - `parseBinaryStl`, `writeBinaryStl` (length `84 + 50 * n`), `hullName`, `visualName`
    - Write `test/assets.urls-zip-stl.test.ts` (examples): URL shape, rejected hosts, STL byte length, a hand-built zip with stored and deflate entries, hull and visual names differ
    - _Requirements: 1.1, 1.8, 2.6, 2.7_

  - [x]* 2.2 Write property tests for URLs, STL and naming
    - **Property 1: Download URLs are built from the pinned commit**
    - **Property 4: STL write and parse round trip**
    - **Property 5: Hull and visual file names never collide**
    - **Validates: Requirements 1.1, 1.8, 2.6, 2.7, 2.9**

  - [x] 2.3 Implement `hull.mjs` and `simplify.mjs`
    - `buildHull(tris, name)` wraps `quickhull3d` and throws `<name>: fewer than 4 non-coplanar vertices`
    - `buildVisual(tris, maxTris = 3000)` wraps `meshoptimizer` and returns the input unchanged when it is already at or under the cap
    - Write `test/assets.hull-simplify.test.ts` (examples): a cube hull, a flat quad throws with the mesh name, a 10,000 triangle sphere reduces to at most 3,000, a small mesh is unchanged
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.8_

  - [x]* 2.4 Write property tests for hulls and visual meshes
    - **Property 2: Hull meshes enclose their source meshes**
    - **Property 3: Visual meshes respect the triangle cap**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

  - [x] 2.5 Implement `mjcf.mjs` (`rewriteMjcf`, `writeScene`)
    - Collision geoms point at hull meshes with `group` 3; visual geoms point at light meshes with `group` 2, `contype` 0, `conaffinity` 0
    - Preserve body, joint, joint range, actuator and inertial elements and nesting
    - `writeScene` includes the Robot_MJCF, adds a floor geom named `floor`, and sets `timestep` 0.002
    - Write `test/assets.mjcf.test.ts` (examples): a small G1-like MJCF, 12 leg joints in the required order, `pelvis` free joint, `floor` geom, timestep, motor actuators
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x]* 2.6 Write property tests for the MJCF rewrite
    - **Property 6: MJCF rewrite sets mesh groups and preserves structure**
    - **Property 7: MJCF rewrite is idempotent**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.9**

  - [x] 2.7 Implement `pack.mjs` (`WEIGHT_SPECS`, `extractWeights`, `packPolicy`, `unpackPolicy`)
    - Zip entries `policy_lstm_1/data/2` to `data/9` map to W1, b1, W2, b2, Wih, Whh, bih, bhh with the shapes of Requirement 4.2
    - Errors name the entry, expected bytes and actual bytes, or the missing entry
    - `policy.bin`: 4-byte LE header length, UTF-8 JSON header (`commit`, `gateOrder: "ifgo"`, tensors with name, shape, offset, bytes), 4-byte aligned float32 tensors
    - Write `test/assets.pack.test.ts` (examples): header fields, alignment, wrong length error text, missing entry error text
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x]* 2.8 Write property tests for zip extraction and policy.bin
    - **Property 8: policy.bin pack and unpack round trip**
    - **Property 9: Zip extraction maps entries to the right tensors**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.9**

  - [x] 2.9 Implement `scripts/fetch-assets.mjs`, then generate and commit `robot/`
    - Flow per the design: download MJCF, list meshes, download meshes, `LICENSE` and `motion.pt` through `upstreamUrl`, build hulls and visuals, rewrite MJCF, write scene, pack weights, write `SOURCE.json` (commit, upstream and local paths), print the Robot_Folder size in bytes, remove the temp dir in `finally`
    - `writeInsideRobot(path)` rejects paths outside `robot/` and the temp dir; non-200 prints URL and status and exits non-zero; a missing mesh prints the mesh name and exits non-zero
    - Expose a pure `runPipeline(inputs)` that the script calls, so tests need no network
    - Copy `LICENSE` unchanged to `robot/LICENSE` (keep the BSD-3-Clause notice)
    - Run `npm run assets` once and commit the resulting `robot/` contents
    - Write `test/assets.pipeline.test.ts` (examples with a stubbed `fetch`): file set, `LICENSE` byte-equal, `SOURCE.json` content, non-200 exit, missing mesh exit, write outside `robot/` rejected, only allowed hosts requested
    - Write `test/robot-folder.test.ts` (examples): committed folder has `scene.xml`, MJCF, meshes, `policy.bin`, `LICENSE`, `SOURCE.json`; timestep 0.002; `LICENSE` contains BSD-3-Clause
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 3.4, 3.5, 3.6, 3.7, 3.8, 5.1, 5.2, 5.5, 5.7_

  - [x]* 2.10 Write property test for pipeline reproducibility
    - **Property 10: The asset pipeline is reproducible**
    - **Validates: Requirements 5.4**

- [x] 3. Controller
  - [x] 3.1 Implement `controller/policy.ts`
    - `OBS_DIM`, `ACT_DIM`, `HIDDEN`, class `Policy` with `reset`, `step`, `fromBytes`, and free functions `lstmStep`, `linear`, `elu`
    - Convert weights to Float64 once, preallocate all scratch, gate order `i, f, g, o`, throw named errors on shape or length mismatch
    - Write `test/policy.test.ts` (examples): hand-computed single LSTM step, ELU at negative and positive inputs, wrong input length error text, wrong tensor shape error text, `h` and `c` zero after construct and `reset`, source scan finds no allocation inside `Policy.step`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10_

  - [x]* 3.2 Write property tests for the Policy
    - **Property 11: The Policy matches a reference network**
    - **Property 12: Policy output is finite**
    - **Property 13: Policy is deterministic and reset restores the initial state**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.6, 6.7, 6.11, 6.12, 6.13**

  - [x] 3.3 Implement `controller/observation.ts`
    - `DEFAULT_POSE`, `GAIT_PERIOD`, `gaitPhase`, `projectedGravity`, `buildObservation` with the exact slice layout of the design, writing into a caller-supplied Float64Array(47)
    - Write `test/observation.test.ts` (examples): hand-written layout case, upright quaternion gives `(0, 0, -1)`, phase 0 at `t = 0`, first-step previous action is zero, source scan finds no allocation
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.10, 7.11, 7.12, 7.13_

  - [x]* 3.4 Write property tests for the observation
    - **Property 14: Observation layout**
    - **Property 15: Projected gravity is a unit vector and is yaw invariant**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.13**

  - [x] 3.5 Implement `controller/pd.ts` and `controller/latency.ts`
    - `KP`, `KD`, `ACTION_SCALE`, `actionToTarget`, `pdTorque`
    - `LatencyBuffer` (26 preallocated rows, `reset`, `push`, `delayed`) and `delaySteps(duration)` clamped to [0, 25]
    - Write `test/pd.test.ts` and `test/latency.test.ts` (examples): gains values, zero torque at target, delay 0 identity, oldest-row fallback, clamp at 25, `delaySteps(0.5) = 25`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.8, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_

  - [x]* 3.6 Write property tests for the PD law and the latency buffer
    - **Property 16: PD law and action mapping**
    - **Property 31: Latency delay is a whole number of Control_Steps**
    - **Property 32: Latency buffer returns the observation from d steps earlier**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.8, 8.9, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.11, 15.12, 15.13**

  - [x] 3.7 Implement `controller/walker.ts`
    - `Walker implements Controller`: constructor resets policy, previous action, latency buffer, call counter and target; `step` is called once per Control_Step, holds Default_Pose on the first call, runs the Policy on every later call and writes the target to `data.ctrl`; the Robot_MJCF PD actuators apply the PD law every Sim_Step (design revision)
    - Uses `rt.command` and `rt.delaySteps`; allocates nothing inside `step`
    - Write `test/walker.test.ts` (examples with a counting Policy stub and a typed-array stub ctx): policy call count, Default_Pose on the first call, constructor state reset, source scan finds no allocation inside `Walker.step`
    - _Requirements: 8.5, 8.6, 8.7, 8.10, 8.11, 8.12, 15.9, 15.10_

  - [x]* 3.8 Write property test for the Walker schedule
    - **Property 17: The Walker evaluates the Policy once per Control_Step and holds its target in data.ctrl**
    - **Validates: Requirements 8.5, 8.6, 8.7**

- [x] 4. Signals
  - [x] 4.1 Implement `signals.ts`
    - `SIGNAL_NAMES` (five named signals plus `episode_time`), `heading`, `tiltDeg`, `MovingAverage` (50-sample ring, allocated up front), `writeSignals(ctx, rt, out)`
    - Latch trigger pose and Heading in the runtime at the first call with `data.time >= warmup` when no perturbation latched one
    - Write `test/signals.test.ts` (examples): upright tilt 0, 90 deg roll gives 90, partial window average, drift for a hand-made geometry, source scan finds no allocation inside `writeSignals`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9_

  - [x]* 4.2 Write property tests for signals
    - **Property 18: Moving average semantics**
    - **Property 19: forward_speed is invariant under a common yaw rotation**
    - **Property 20: Tilt range and lateral drift geometry**
    - **Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.10, 11.11, 11.12**

- [ ] 5. Lexicon
  - [ ] 5.1 Implement `predicates.ts`
    - The four `PredicateTemplate`s with signals, units and margins from the design; `stay upright` carries the required comment (margin formula, 60 deg forced -0.01 m, reason); the speed predicate forgives `episode_time < 2`
    - Write `test/lexicon.test.ts` (examples): phrases, declared signals and units, the comment text above `stay upright`, margin spot values
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

  - [ ]* 5.2 Write property tests for predicate margins
    - **Property 21: stay upright margin**
    - **Property 22: Height, speed and drift margins are exact and monotone**
    - **Property 23: Settling time is forgiven**
    - **Validates: Requirements 12.1, 12.2, 12.4, 12.5, 12.6, 12.7, 12.10, 12.11, 12.12, 12.13**

  - [ ] 5.3 Implement the pure perturbation helpers in `perturbations.ts`
    - `pushStartOffset`, `pushForce`, `slopeGravity`, `validateRatio` (diagnostic like `ratio 130% is outside 0% to 100%`), all allocation-free and writing into caller arrays
    - Write `test/perturbations.test.ts` (examples): 0 deg pushes along the Heading, 180 deg pushes opposite, force is zero outside the window, zero slope leaves gravity unchanged, ratio error text
    - _Requirements: 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 14.2, 14.13_

  - [ ]* 5.4 Write property tests for the perturbation helpers
    - **Property 24: Push force magnitude and window**
    - **Property 25: Push direction follows the latched Heading**
    - **Property 26: Push start offset hits the requested gait phase**
    - **Property 27: Slope keeps the gravity norm**
    - **Property 28: Payload adds mass exactly**
    - **Property 29: Friction ratio scales sliding friction and out-of-range ratios are rejected**
    - **Validates: Requirements 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 14.2, 14.5, 14.7, 14.10, 14.11, 14.13**

  - [ ] 5.5 Implement the perturbation templates and `lexicon.ts`
    - Six `PerturbationTemplate`s with the dimensions of the design (push, slope, payload, friction, latency, command); each `apply` saves the original model values into `rt.saved` before the first change, applies from the start of the Active Phase, and allocates nothing
    - `lexicon.ts` exports `lexicon` with `robotNames: ['golem', 'G1', 'robot']`, the four predicates and six perturbations; the `{ratio}` slot handler calls `validateRatio`
    - Write `test/lexicon-structure.test.ts` (examples): phrases, dimension kinds, severities and wrap flags, `robotNames`, source scan finds no allocation inside each `apply` and no `Math.random()`
    - _Requirements: 12.9, 13.1, 13.2, 13.13, 14.1, 14.4, 14.7, 14.12, 15.1, 15.8, 15.9, 15.10, 21.1_

- [ ] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. App definition
  - [ ] 7.1 Implement `app.ts` (`stagger` RobotApp with `endTrial`)
    - Fields `id`, `name`, `sceneFile`, `simDt`, `controlDt`, `warmup`, `lexicon`
    - `files()`: Node reads every file listed in `SOURCE.json` plus the generated files, browser fetches from the page origin; rejects naming a missing file; returns equal bytes on every call
    - `makeController` loads `policy.bin` and builds the Walker without drawing from `rng`; `initState` restores leftovers, resets the runtime, sets the standing pose and adds `0.01 * normal(rng)` to the 12 leg joints in joint order (Box-Muller, fixed draw order); `signals` calls `writeSignals`; `endTrial` restores gravity, torso mass and inertia, floor friction and calls `mj_setConst` if mass changed
    - Delete every MuJoCo handle created by the app
    - Write `test/app.test.ts` (examples): field values, `files()` contents and repeatability, missing-file error names the file, `initState` draws exactly 12 values in a fixed order
    - _Requirements: 14.3, 14.6, 14.8, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 16.10, 16.11, 16.12, 21.4_

  - [ ]* 7.2 Write property tests for app determinism and model restoration
    - **Property 30: Trials leave the cached model unchanged**
    - **Property 33: initState noise is deterministic and in fixed order**
    - **Property 34: A trial is a deterministic function of scenario and seed**
    - Use `test/app.property.test.ts`; pure parts at 100 runs against a stub `SimContext`, physics parts at 5 to 10 runs with horizon of at most 2 s
    - **Validates: Requirements 9.8, 14.3, 14.6, 14.8, 14.9, 16.7, 16.8, 16.9, 16.13, 21.1, 21.2, 21.8**

  - [ ] 7.3 Add the parity fixture, parity test and smoke trial
    - Write `test/fixtures/parity.json` with the 12 initial noise values, command `(0.5, 0, 0)`, duration 2 s, reference pelvis `(0.79987, -0.02247, 0.76789) m` and tolerance 1e-3 m; never edit these values
    - Write `test/parity.test.ts`: runs in Node from the committed `robot/`, prints observed, reference and difference for x, y, z in metres on failure, bit-identical on a second run, under 10 s
    - Write `test/smoke.test.ts`: 2 s after warm-up with a 0 N push, fixed seed, finite robustness, expected trace length, handle counter returns to prior value plus the cached model, under 15 s; also checks that model compile gives 12 actuators and `nq` 19 within 5 s
    - _Requirements: 3.10, 3.11, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 18.4, 18.5, 18.6, 18.7, 18.8, 18.11_

- [ ] 8. Robot requirements file
  - [ ] 8.1 Write `.kiro/specs/g1-walking/requirements.md`
    - Standard Kiro format: Introduction, Glossary (with a table marking each requirement Expected_Hold or Expected_Break), numbered requirements with user stories and EARS lines, requirement ID first on every line
    - Cover push recovery (Expected_Hold: up to 100 N for 0.2 s from any direction at any point in the stride, stay upright for 3 s), speed tracking on level ground (Expected_Hold), slopes, payload, slipping and sensor latency, and at least two Expected_Break lines including a push of up to 250 N from behind for 0.2 s
    - Use only lexicon phrases and give every number a unit; the marks stay outside the EARS lines; record no discussion edits here (use `apps/stagger/proposals.md`)
    - Write `test/requirements.test.ts` (examples): structure checks, required lines present, units on every number, ID first, marks outside EARS lines, the 250 N from behind line exists, every line compiles with the public compile function (failure prints line, diagnostic, suggestion), `perturbations` non-empty or `ubiquitous`, finite positive `horizon`, `min <= max`
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 17.13, 17.14, 18.1, 18.2, 18.3_

  - [ ]* 8.2 Write property test for requirement compile round trip and the nominal scenario
    - **Property 35: Requirement lines compile and re-compile to the same space**
    - Use `test/requirements.property.test.ts`; also add the nominal-scenario check (0 N or nominal values give positive robustness for every Expected_Hold and Expected_Break line, horizon at most 2 s)
    - **Validates: Requirements 18.12, 18.13**

- [ ] 9. Studio page
  - [ ] 9.1 Implement `web/copy.ts`
    - `STUDIO_COPY` (sentence case, at most 72 characters per line, units on every number, no safety or certification claim) covering robot description, Unitree policy with links to the repo and Pinned_Commit, BSD-3-Clause with a link to `robot/LICENSE`, shove instructions, and the "no counterexample found within N trials, not a proof" statement
    - `formatCounterexample(scenario)` returns `falls from <force> N at <angle> deg, <phase>% into the stride`
    - Write `test/copy.test.ts` (examples): required statements and links present, every line within 72 characters, no forbidden claims, example counterexample sentence
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.10_

  - [ ]* 9.2 Write property test for the counterexample sentence
    - **Property 36: Counterexample sentence is complete and fits the measure**
    - **Validates: Requirements 20.8, 20.9**

  - [ ] 9.3 Implement the studio page (`web/index.html`, `main.ts`, `worker.ts`, `vite.config.ts`)
    - Vite multi-page entry with `optimizeDeps.exclude: ['@mujoco/mujoco']`; page built from `golem-spec/ui` stage, ghosts, aura, tablet and reel
    - Buttons `Shove`, `Summon 64 ghosts`, `Replay the fall`, `Pin this seed`; tablet shows each requirement line with editable quantities and recompiles on edit; render on demand with pixel ratio capped at 1.5; reduced-motion handling; one MuJoCo instance per worker speaking the `TrialPool` message protocol; load failure shows `Could not load <file>. Reload the page.`; no network except own-origin static assets and no analytics
    - Write `test/web.test.ts` (examples with DOM stubs): button labels, `optimizeDeps.exclude`, load-failure message names the file, reduced-motion branch, no analytics script, no `skeleton/src` import
    - _Requirements: 19.1, 19.4, 19.5, 19.6, 19.7, 19.10, 19.11, 19.12, 19.13, 19.14, 19.15, 19.16, 21.6_

- [ ] 10. Repository hygiene and public-entry-point scan
  - [ ] 10.1 Add the import scan, README and `proposals.md`
    - Implement the scan helper (reports an import only when the specifier contains `skeleton/src`; accepts `golem-spec`, `golem-spec/ui`, `golem-spec/node`) in `test/helpers/importScan.ts`
    - Write `apps/stagger/README.md` with the regeneration command (`npm run assets`), licence notes and the evidence pointer; create `apps/stagger/proposals.md` with a short header
    - Write `test/layout.test.ts` (examples): scan all app sources for forbidden imports, no `Math.random()` in `controller/`, `lexicon.ts`, `app.ts`, no Python files, README contains the regeneration command, required files and folders exist
    - _Requirements: 5.6, 10.2, 10.3, 10.4, 10.5, 10.7, 10.8, 17.13, 21.5_

  - [ ]* 10.2 Write property test for the import scan
    - **Property 37: The import scan flags exactly the forbidden imports**
    - **Validates: Requirements 10.2, 10.3, 10.8**

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-test sub-tasks and can be skipped for a faster MVP. Example tests inside implementation tasks are not optional.
- Requirements 17.11, 17.12, 21.7 and the layout and visual rules of 19 and 20 (19.2, 19.3, 19.5, 19.8, 19.9, 19.11 look, 20.6 layout) are checked by evidence scripts in `evidence/` or by review, not by CI tasks here.
- `golem-sim` must call `endTrial` in a `finally` block (Property 30 relies on it; `initState` also restores leftovers).
- Physics-backed tests use horizons of at most 2 s simulated and small run counts. Long campaigns belong in `evidence/`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.3", "3.1", "3.3", "3.5", "5.1", "5.3"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.5", "2.7", "3.2", "3.4", "3.6", "3.7", "4.1", "5.2", "5.4", "5.5"] },
    { "id": 3, "tasks": ["2.6", "2.8", "2.9", "3.8", "4.2"] },
    { "id": 4, "tasks": ["2.10"] },
    { "id": 5, "tasks": ["6"] },
    { "id": 6, "tasks": ["7.1", "8.1", "9.1"] },
    { "id": 7, "tasks": ["7.2", "7.3", "8.2", "9.2", "9.3"] },
    { "id": 8, "tasks": ["10.1"] },
    { "id": 9, "tasks": ["10.2"] },
    { "id": 10, "tasks": ["11"] }
  ]
}
```
