# Implementation Plan: candy-app

## Overview

Build `apps/candy` bottom-up: package scaffold and constants, the two additive cross-spec changes, the asset script and generated scene, then the pure controller parts (suction, IK, SSM_v1, delay line, geometry, state machine), the controller composition, signals, lexicon, the `RobotApp`, the app's own EARS requirements, the studio page, and the `.kiro` pack. Pure logic comes first so that each step has fast Vitest and fast-check tests with no MuJoCo. Physics-backed tests come after the committed assets exist and use at most 3 s of simulated time (at most 2 s after warm-up).

Conventions for every task:
- TypeScript strict, ES modules, Node 20 or later. The asset scripts are plain `.mjs` with JSDoc types.
- Import the skeleton only from `golem-spec`, `golem-spec/ui` and `golem-spec/node`. Use no `Math.random()`, no `Date.now()` or `performance.now()` in `controller/`, `lexicon.ts` or `app.ts`, and allocate nothing in `step`, `substep` and `apply`.
- Logic and its example tests land in the same task. Each design property is its own optional sub-task with `numRuns` of at least 100 (5 to 10 for physics-backed ones) and the tag comment `Feature: candy-app, Property N: <title>`.
- Test files live in `apps/candy/test/`. Each task names its own test file, so tasks in one wave never write the same file.
- Never weaken an assertion, a tolerance or a requirement line to make a test pass. If a test is wrong, say why in the commit message.
- The requirement line `keep every link at least 0.10 m from the hand` is expected to be reported broken against SSM_v1. No task may add a second distance check or soften that line, its monitor or its tests.

## Tasks

- [x] 1. Package scaffold and constants
  - [x] 1.1 Create the `apps/candy` package scaffold
    - Update `package.json` (name `candy`, ES modules, Node >= 20, Apache-2.0, scripts `assets` running `scripts/fetch-assets.mjs`, `test` running `vitest --run`, `dev` running Vite for `web/`); dependencies `golem-spec`, `@mujoco/mujoco`; dev dependencies `meshoptimizer`, `vitest`, `fast-check`, `typescript`, `vite`
    - Make `tsconfig.json` strict and extend `tsconfig.base.json`; add `vitest.config.ts`
    - Add `web/vite.config.ts` with `optimizeDeps: { exclude: ['@mujoco/mujoco'] }`
    - Create the folders `controller/`, `scripts/lib/`, `web/`, `test/`, `test/fixtures/`, `.kiro/specs/candy-sorter/`, `.kiro/hooks/`, and an Apache-2.0 `LICENSE` for app code at `apps/candy/LICENSE`
    - Write `test/package.test.ts` (examples): package fields, the `assets` script, strict TypeScript, dependency lists, `optimizeDeps.exclude` in the Vite config
    - _Requirements: 13.1, 13.2, 13.6, 13.7, 13.8, 13.9, 1.11_

  - [x] 1.2 Implement `constants.ts`
    - Add every number from the design constants tables: `TABLE`, `TRAY`, `WORKSPACE`, `BOWLS` (index = colour), `Q_HOME`, `HAND_START`, `SUCTION`, `SSM`, `UD` and the controller and IK parameters
    - Write `test/constants.test.ts` (examples): bowls lie on the 0.72 m arc at -32°, 0° and +32°, `Q_HOME` has 7 entries inside the Panda joint limits, `UD` indexes are distinct and below 24, the hand start is at least 1.0 m from the Home_Pose Tip estimate, every Table edge point lies outside `WORKSPACE`
    - _Requirements: 2.5, 2.14, 3.5, 6.3, 6.4, 6.5, 9.3_

- [ ] 2. Cross-spec additions (additive only)
  - [ ] 2.1 Add optional `Controller.substep` and `Controller.dispose` to the skeleton
    - **Skipped (superseded).** `Controller.substep` already exists (golem-sim-hardening) and is used as is. `Controller.dispose` is not added: the skeleton is out of scope for this branch, and the Episode_Runner already calls `RobotApp.endTrial(ctx)` in its `finally` block, so the app disposes its controller there (task 13.1). A `dispose` hook in the skeleton can replace that later.
    - Add `substep?(ctx, t): void` and `dispose?(): void` to the `Controller` type in `skeleton/src`, and list both under "Approved additions" in `.kiro/steering/interfaces.md`
    - Make the Episode_Runner call `substep` once per Sim_Step after it clears `xfrc_applied` and before `mj_step` (also during warm-up), and call `dispose` once at Trial end, also on error paths
    - Write `skeleton/test/controller-hooks.test.ts` (examples): call order per step, `substep` runs in warm-up, `dispose` runs once on normal end and once when `apply` throws, apps without the fields behave as before
    - _Requirements: 3.13, 14.4, 10.13_

  - [ ] 2.2 Pass the hidden `horizon` slot to `PerturbationTemplate.dims`
    - **Skipped (skeleton change, out of scope for this branch).** `hand.entry` uses the 3.0 s fallback (`HAND_ENTRY_FALLBACK`) until golem-ears passes `horizon`. See `apps/candy/proposals.md`.
    - In the golem-ears compiler, pass the requirement Horizon to `dims` as the hidden slot `horizon` (a `Quantity`), and record it under "Approved additions" in `interfaces.md`
    - Write `skeleton/test/horizon-slot.test.ts` (examples): a perturbation `dims` sees `horizon`, an absent slot is tolerated, existing lexicons are unaffected
    - _Requirements: 9.3_

- [ ] 3. Asset script and generated scene
  - [ ] 3.1 Implement the pure asset libraries
    - `scripts/lib/hash.mjs` (sha256 of bytes), `scripts/lib/obj.mjs` (parse and write OBJ with `toFixed(6)`), `scripts/lib/hull.mjs` (dependency-free quickhull), and a mesh pipeline that simplifies visual meshes to at most 3000 faces with `MeshoptSimplifier` and collision meshes to at most 200 faces then convex hull
    - Write `test/assets.libs.test.ts` (examples): OBJ round trip, hash of known bytes, hull of a cube, one real OBJ through both pipelines
    - _Requirements: 1.4, 1.5, 1.6, 1.11_

  - [ ]* 3.2 Write property test for the mesh pipeline
    - **Property 1: Mesh pipeline respects face bounds**
    - File `test/p01-mesh.test.ts`
    - **Validates: Requirements 1.4, 1.5**

  - [ ] 3.3 Implement `patch.mjs` and `scene.mjs`
    - `scripts/lib/patch.mjs`: anchored string edits on `panda_nohand.xml` that add the cup body and `tip` site (0.008 m inside the cup face) inside `link7`, rewrite the `collision` default class to `contype 2 / conaffinity 1`, remove any gripper, and fail when an anchor is missing
    - `scripts/lib/scene.mjs`: write `scene.xml` with the Table, Tray marking, three Bowls (box walls, cylinder floor), six Candies (box, sphere, capsule, 0.020 kg, default colours), the mocap Hand (palm sphere, forearm capsule, `contype 0`), lights, floor, `opt.timestep 0.002`, `nuserdata 24`, sorted output and fixed number formatting
    - Write `test/assets.scene-gen.test.ts` (examples): output is identical on two calls, a missing anchor throws and names the anchor, the collision table matches the design, no actuator for the cup
    - _Requirements: 1.3, 1.6, 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.8, 2.9, 2.11, 2.12, 3.1_

  - [ ] 3.4 Implement `scripts/fetch-assets.mjs`
    - Constants `MENAGERIE_COMMIT` and `ASSET_HASHES`, both `null` until resolved; default mode exits non-zero with the "Run --resolve once" message while they are `null`
    - Modes: default (download into memory, verify hashes, write nothing until all files verify, write only below `apps/candy/robot/`, copy the Menagerie `LICENSE` to `robot/LICENSE`), `--resolve` (print commit and hashes, write nothing under `robot/`), `--check`
    - Skip the download and print "Assets are current." when every output exists with the expected hash; no network access outside an explicit run
    - Write `test/assets.script.test.ts` (examples, stubbed network): a failed download exits non-zero and names URL, status and file path; a hash mismatch names the path and both hashes; a second run is a no-op; `--resolve` writes nothing under `robot/`; earlier valid files stay unchanged after a failure
    - _Requirements: 1.1, 1.2, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 15.11_

  - [ ] 3.5 Resolve the pinned commit, generate `robot/`, and test the scene
    - Run `node scripts/fetch-assets.mjs --resolve` once, paste the printed commit and hashes into the script, then run the script to write `robot/` (`panda.xml`, `scene.xml`, `assets/*.obj`, `LICENSE`); do not invent the values
    - Write `test/scene.test.ts` (examples): `scene.xml` compiles with `mj.MjModel.from_xml_path` and contains six Candies, three Bowls, one Hand and the site `tip`; seven position actuators and none for the cup; `opt.timestep` is 0.002; loads in under 4 s; Tip at Home_Pose is near (0.307, 0, 0.498); Hand start is at least 1.0 m from the Tip surface-to-point; a second script run leaves bytes identical
    - _Requirements: 1.2, 1.6, 2.1, 2.10, 2.11, 2.13, 2.5, 15.12_

  - [ ]* 3.6 Write property tests for the compiled scene
    - **Property 2: Scene structure invariants**
    - **Property 3: Collision filter table**
    - Files `test/p02-scene.test.ts` and `test/p03-collision.test.ts`
    - **Validates: Requirements 2.1 to 2.11, 2.14, 15.12; 2.9**

- [ ] 4. Suction model
  - [ ] 4.1 Implement the pure suction functions
    - In `controller/suction.ts` add `suctionForce(out, tip, vTip, candy, vCandy, cap)` (spring-damper, magnitude capped, direction kept, zero when `|F| = 0`) and `sanitizeRatio(v)` (clamp to [0, 1], non-finite to 0)
    - Write `test/suction.test.ts` (examples): default cap 3 N, 1.5 N at ratio 0.5, uncapped small force equals the spring-damper value, `sanitizeRatio(NaN) = 0`, 10 000 calls allocate under a small heap threshold
    - _Requirements: 3.3, 3.4, 3.5, 3.11, 3.12, 3.14, 3.15_

  - [ ]* 4.2 Write property test for the suction law
    - **Property 4: Suction force is capped, directed, and follows the spring-damper law**
    - File `test/p04-suction-law.test.ts`
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.11**

  - [ ]* 4.3 Write property test for ratio sanitising
    - **Property 5: Vacuum ratio sanitising**
    - File `test/p05-ratio.test.ts`
    - **Validates: Requirements 3.12**

  - [ ] 4.4 Implement `suctionStep`
    - In `controller/suction.ts` add `suctionStep(mj, ctx, ids, ws)`: read the switch (`UD.switch`) and ratio (`UD.vacuum`), return with no write while the switch is off, pick the nearest active candy (lower index on ties) within 0.01 m of the Tip site, add the capped force to that candy's `xfrc_applied` row, record `UD.target`, count and record clamp warnings in `UD.warnCount` and `UD.warnValue`; add `warnings()` that builds a message only when the count changed
    - Write `test/suction-step.test.ts` (examples, fake `ctx`): zero force with the switch off, one target only, tie to the lower index, no candy within 0.01 m gives no force, the warning names the original value
    - _Requirements: 3.2, 3.6, 3.7, 3.8, 3.12, 3.13, 3.14_

  - [ ]* 4.5 Write property test for switch gating and single target
    - **Property 6: Switch gating and single target**
    - File `test/p06-gating.test.ts`
    - **Validates: Requirements 3.2, 3.6, 3.7, 3.8**

  - [ ]* 4.6 Write property test that suction adds without disturbing other forces
    - **Property 7: Suction adds without disturbing other forces**
    - File `test/p07-additive.test.ts`
    - **Validates: Requirements 3.13**

  - [ ]* 4.7 Write property test that suction is a pure function
    - **Property 8: Suction is a pure function**
    - File `test/p08-pure.test.ts`
    - **Validates: Requirements 3.15**

  - [ ] 4.8 Add the suction physics fixture and examples
    - Create `test/fixtures/suction.xml`: a mocap-driven cup with a `tip` site and one free candy of each shape, at `opt.timestep 0.002`, plus a helper that runs 0.5 s
    - Write `test/suction-physics.test.ts` (examples): a 20 g candy stays within 0.01 m of the Tip at 0.5 m/s and up to 5 m/s² (Vacuum_Ratio 1); stability sweep from 5 g to 60 g with the cup at rest keeps the Trace finite
    - _Requirements: 3.1, 3.9, 15.3_

  - [ ]* 4.9 Write property test for the engage radius hold
    - **Property 9: A 20 g candy stays within the engage radius**
    - File `test/p09-hold.test.ts`
    - **Validates: Requirements 3.9, 15.3**

  - [ ]* 4.10 Write property test for slip above the carry mass
    - **Property 10: Candies above the carry mass slip**
    - File `test/p10-slip.test.ts`
    - **Validates: Requirements 3.10, 15.4**

- [ ] 5. Inverse kinematics
  - [ ] 5.1 Implement `IkSolver`
    - In `controller/ik.ts` implement the damped-least-squares solver from the design: 5 task rows (3 position, 2 tilt weighted by 0.15 m/rad), adaptive damping from manipulability, in-place Cholesky, 0.10 rad step limit, 200 iterations, joint-limit clamp, best-so-far result, scratch `MjData` owned by the solver, `jacp` and `jacr` buffers allocated once, `dispose()` idempotent; export the pure `dlsStep(J, e, lambda, out)` so it can be tested without MuJoCo
    - A non-finite Jacobian entry returns the start joints and `Infinity`; `data.qpos` is never written
    - Write `test/ik.test.ts` (examples): Home_Pose round trip, tray and bowl grid is reachable, an unreachable target returns the best error and at most 200 iterations, a non-finite Jacobian returns `Infinity`, `dispose` twice deletes each handle once
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.9, 4.10, 4.11, 4.12_

  - [ ]* 5.2 Write property test for the DLS step
    - **Property 11: IK step equals the damped-least-squares reference**
    - File `test/p11-dls.test.ts`
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 5.3 Write property test for IK convergence
    - **Property 12: IK converges on reachable points**
    - File `test/p12-ik-converge.test.ts` (reachable box from the constants table; at most 1 mm in fewer than 200 iterations; cup axis within 5°)
    - **Validates: Requirements 4.5, 4.8, 15.2**

  - [ ]* 5.4 Write property test for the IK failure contract
    - **Property 13: IK failure contract**
    - File `test/p13-ik-fail.test.ts`
    - **Validates: Requirements 4.6, 4.11**

  - [ ]* 5.5 Write property test for joint limits and step limit
    - **Property 14: IK joint limits and step limit**
    - File `test/p14-ik-limits.test.ts`
    - **Validates: Requirements 4.4, 4.12**

  - [ ]* 5.6 Write property test for IK determinism and purity
    - **Property 15: IK is deterministic and leaves state untouched**
    - File `test/p15-ik-determinism.test.ts`
    - **Validates: Requirements 4.7, 4.9**

- [ ] 6. SSM_v1 and the hand delay line
  - [ ] 6.1 Implement `ssm.ts`
    - Implement `separation(tip, hand)` (palm sphere and forearm capsule, Tip position only) and `speedScale(d)` (0 at or below 0.15 m or non-finite, 1 at or above 0.40 m, linear between)
    - The source header states that SSM_v1 measures from the Tip only, that this is the known limit of v1, and that no link check may be added
    - Write `test/ssm.test.ts` (examples): boundary values, a non-finite hand gives 0, the source header contains the Tip-only statement, the function signature has no link argument
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.11, 6.12_

  - [ ]* 6.2 Write property test for the speed scale
    - **Property 18: Speed scale range, boundaries, and monotonicity**
    - File `test/p18-speed-scale.test.ts`
    - **Validates: Requirements 6.3, 6.4, 6.5, 6.8, 15.5**

  - [ ]* 6.3 Write property test that SSM measures from the Tip only
    - **Property 19: SSM measures from the Tip only**
    - File `test/p19-tip-only.test.ts`
    - **Validates: Requirements 6.1, 6.2**

  - [ ] 6.4 Implement `hand-delay.ts`
    - A ring buffer in one `Float64Array(16 * 4)` with `push(x, y, z, yaw)` and `read(lagSteps)`; the first push fills all slots; `lagSteps = clamp(round(lag / 0.02), 0, 15)`; no growth
    - Write `test/hand-delay.test.ts` (examples): lag 0 returns the newest sample, lag 0.3 s returns the sample 15 steps older, early reads never return garbage, the buffer length stays 64
    - _Requirements: 6.9, 6.10, 14.3, 14.5_

  - [ ]* 6.5 Write property test for the delay line
    - **Property 21: Delay line reads the sample `lag` steps earlier**
    - File `test/p21-delay.test.ts`
    - **Validates: Requirements 6.9, 6.10, 14.5**

- [ ] 7. Geometry helpers
  - [ ] 7.1 Implement `geometry.ts`
    - `classifyCandies` (resting at or below 0.05 m/s, Bowl membership, `droppedOutside`, `active`), `handPose` (the hand-reach path with entry point on the Table edge, nearest Bowl target, hold on arrival), `resolveOverlaps` (+0.01 m in x until pairs are at least 0.036 m apart), `chooseCandy` (smallest `floor(1000 * r)`, lower id on ties, `-1` when none)
    - Write `test/geometry.test.ts` (examples): the all-same-point overlap case ends at x <= 0.59 m, a carried candy at 0.15 m is not dropped, a candy on the floor is dropped, the hand holds at the start pose before entry, `chooseCandy` skips masked and off-tray candies
    - _Requirements: 5.2, 5.10, 7.5, 7.6, 7.7, 7.13, 9.2, 9.4, 9.5, 9.6, 9.15_

  - [ ]* 7.2 Write property test for candy classification
    - **Property 24: Candy classification and workspace test**
    - File `test/p24-classify.test.ts`
    - **Validates: Requirements 7.5, 7.6, 7.7, 7.9, 7.13**

  - [ ]* 7.3 Write property test for the hand path
    - **Property 28: Hand path**
    - File `test/p28-hand-path.test.ts`
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6, 15.15**

  - [ ]* 7.4 Write property test for candy placement
    - **Property 30: Candy placement and the overlap rule are deterministic**
    - File `test/p30-overlap.test.ts`
    - **Validates: Requirements 9.13, 9.14, 9.15**

  - [ ]* 7.5 Write property test for candy selection
    - **Property 16: Candy selection depends only on positions and ids**
    - File `test/p16-select.test.ts`
    - **Validates: Requirements 5.2, 5.10**

- [ ] 8. Pick-and-place state machine
  - [ ] 8.1 Implement `machine.ts`
    - Export frozen `STATES` and `TRANSITIONS` (the table from the design) and the pure `next(state, guards)`; no wall-clock read and no random call
    - Write `test/machine.test.ts` (examples): one nominal cycle driven by synthetic guards visits `idle, approach, descend, grasp, lift, transfer, release, homing, idle`; `lost` and `ikFail` lead to `idle`; the source has no `Date.now`, `performance.now` or `Math.random`
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.11, 5.12, 5.13, 5.14, 5.15_

  - [ ]* 8.2 Write property test for the transition table
    - **Property 17: Transition table is enumerable and total**
    - File `test/p17-machine.test.ts`
    - **Validates: Requirements 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.11, 5.12, 5.13**

- [ ] 9. Checkpoint - Pure logic complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Controller composition
  - [ ] 10.1 Implement `controller/ids.ts`
    - Resolve once per trial the ids from the design table (`body:link0..link7`, `body:cup`, `body:hand`, candy bodies and free joints, `geom:table`, hand geoms, `joint:joint1..7`, `actuator:actuator1..7`, `site:tip`); collect Arm_Collision_Geoms (`contype 2` on `link0..link7` and `contype 8` on the cup) into an `Int32Array`; cache in a `WeakMap<SimContext, CandyIds>`
    - Write `test/ids.test.ts` (examples): each name resolves once, the arm geom list is non-empty and excludes candy and hand geoms, a missing name throws a message that names it
    - _Requirements: 7.11, 10.6_

  - [ ] 10.2 Implement `CandyController`
    - In `controller/index.ts` compose the steps from the design table: hand read, delay line, `speedScale(separation(...))`, state machine, speed limit `min(v_nom * scale, v_prev + a_up * 0.02)`, hold when the scale is 0 (targets and switch unchanged), waypoint advance, IK from the previous targets, `data.ctrl[0..6]`, switch from the state; `substep` calls `suctionStep`; `dispose` deletes the solver handles once; `warnings()`
    - The controller allocates all typed arrays in the constructor and nothing inside `step` or `substep`; it reads no wall clock and uses only the passed PRNG
    - Write `test/controller.test.ts` (examples): holds Home_Pose before `T_READY = 1.3 s`, a non-finite hand stops the arm, an allocation probe over `step` and `substep`, `dispose` twice deletes each handle once
    - _Requirements: 4.3, 5.1, 5.10, 6.6, 6.7, 6.11, 10.6, 14.1, 14.2, 14.3, 14.4_

  - [ ]* 10.3 Write property test for commanded speed and the stop rule
    - **Property 20: Commanded speed follows the scale, and a non-finite hand stops the arm**
    - File `test/p20-speed-command.test.ts`
    - **Validates: Requirements 6.6, 6.7, 6.11**

- [ ] 11. Signals
  - [ ] 11.1 Implement `signals.ts`
    - Write the eight Requirement 7.1 signals plus `candies_active`: `min_link_hand_distance` (`mj_geomDistance` over arm geoms and both hand geoms, `distmax` 0.6 m, true hand pose, one shared `fromto` buffer), `fastest_link_speed` and `tip_speed` (`mj_objectVelocity`), candy counts via `classifyCandies`, `table_force` (Contact_Iterator, normal force from `mj_contactForce`), `hand_in_workspace`
    - Use the Buffer_Helper and Contact_Iterator so every buffer and the contact vector are deleted
    - Write `test/signals.test.ts` (examples): `mj_geomDistance` ignores contype for a filtered pair, a pressed cup gives a positive `table_force`, no hand within 0.6 m gives exactly 0.6, the Handle_Counter is unchanged after 100 calls, `candies_active` equals `UD.count`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.8, 7.9, 7.10, 7.11, 7.12, 7.14_

  - [ ]* 11.2 Write property test for the link-hand distance signal
    - **Property 23: Link-hand distance signal**
    - File `test/p23-distance.test.ts`
    - **Validates: Requirements 7.2, 7.14**

- [ ] 12. Lexicon
  - [ ] 12.1 Implement the predicates in `lexicon.ts`
    - `robotNames = ['arm', 'Panda', 'robot']` and the five predicates with the margins from the design (`-Infinity` on any non-finite input; `drop every candy` reads `candies_active` and gives `+1` or `-n`; a compile warning when `length` is above 0.6 m)
    - Write `test/lexicon.test.ts` (examples): robot names, exact phrases, units, the margin of each predicate for a hand-picked case, the `length > 0.6 m` warning
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13_

  - [ ]* 12.2 Write property test for margin soundness
    - **Property 25: Predicate margins are sound**
    - File `test/p25-margins.test.ts`
    - **Validates: Requirements 8.2 to 8.12, 15.6**

  - [ ]* 12.3 Write property test for threshold monotonicity
    - **Property 26: Margins are monotone in the threshold**
    - File `test/p26-monotone.test.ts`
    - **Validates: Requirements 8.14, 8.15**

  - [ ]* 12.4 Write property test for non-finite input
    - **Property 27: Non-finite input gives negative infinity**
    - File `test/p27-nonfinite.test.ts`
    - **Validates: Requirements 8.13**

  - [ ] 12.5 Implement the perturbations in `lexicon.ts`
    - Add the five perturbations with the Dimensions from the design: hand reach (`hand.angle` with `wrap` for `any direction`, `hand.speed`, `hand.entry` over the hidden `horizon` slot with a 3.0 s fallback, `hand.height`), `candy.mass` (sets mass and scales inertia, idempotent), `vacuum.ratio` (writes `UD.vacuum`), `tracker.lag` (writes `UD.lag`), candy placement (`candy.<i>.x` and `.y`, applied once at the first Sim_Step of the Active Phase)
    - `apply` clamps each value into its Dimension range and allocates nothing; add `visual?` for the hand arrow if useful
    - Write `test/perturbations.test.ts` (examples): defaults of 0.020 kg, ratio 1 and lag 0 s when no perturbation is named, Dimension names and kinds, an allocation probe over `apply`, a hand path before entry equals the start pose
    - _Requirements: 9.1, 9.3, 9.4, 9.5, 9.7, 9.8, 9.10, 9.11, 9.12, 9.13, 9.14, 9.16, 9.17, 9.18_

  - [ ]* 12.6 Write property test for candy mass restore
    - **Property 29: Candy mass is set and restored**
    - File `test/p29-mass.test.ts`
    - **Validates: Requirements 9.8, 9.9**

  - [ ]* 12.7 Write property test for clamping
    - **Property 31: Out-of-range scenario values are clamped**
    - File `test/p31-clamp.test.ts`
    - **Validates: Requirements 9.16**

- [ ] 13. The RobotApp
  - [ ] 13.1 Implement `app.ts`
    - Export the `RobotApp` with `id 'candy'`, `name`, `files()` (Node reads `robot/`; browser fetches static files; a missing `robot/` rejects with "Assets are missing from robot/: run node scripts/fetch-assets.mjs."), `sceneFile 'scene.xml'`, `simDt 0.002`, `controlDt 0.02`, `warmup 1.0`, `lexicon`, `makeController`, `signals`, and `initState` (Panda at `Q_HOME`, defaults in `userdata`, 18 PRNG draws in the fixed order, overlap rule, parked inactive candies); add `endTrial` only if a perturbation changes a model field outside `apply`
    - Write `test/app.test.ts` (examples): field values, `files()` keys and bytes, the missing-assets message, `initState` draws exactly 18 values, colours in {0, 1, 2}
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11_

  - [ ]* 13.2 Write property test for `initState`
    - **Property 34: `initState` is deterministic**
    - File `test/p34-initstate.test.ts`
    - **Validates: Requirements 10.7, 10.8, 10.9**

  - [ ] 13.3 Add the 3 s smoke Trial
    - Write `test/smoke.test.ts` (examples): a 3 s Trial of the app in Node returns a finite `robustness`, leaves the Handle_Counter unchanged, and finishes in under 2 s wall time as a CI budget; a Trial in which `apply` throws also leaves the Handle_Counter unchanged and calls `dispose`
    - _Requirements: 10.13, 14.6, 14.7, 15.10_

  - [ ]* 13.4 Write property test for Trial determinism
    - **Property 35: Trials are deterministic**
    - File `test/p35-determinism.test.ts` (5 to 10 runs, at most 2 s after warm-up)
    - **Validates: Requirements 10.6, 10.12, 14.1, 15.8**

  - [ ]* 13.5 Write property test for handle hygiene
    - **Property 36: Handles are returned**
    - File `test/p36-handles.test.ts`
    - **Validates: Requirements 3.14, 4.1, 7.12, 10.13, 14.3, 14.4, 14.7, 15.10**

  - [ ]* 13.6 Write property test for tracker lag
    - **Property 22: Tracker lag changes only the controller's reading**
    - File `test/p22-lag.test.ts`
    - **Validates: Requirements 9.11, 9.12**

- [ ] 14. The app's own EARS requirements
  - [ ] 14.1 Write `apps/candy/.kiro/specs/candy-sorter/requirements.md`
    - Standard Kiro format with an Introduction, a Glossary and numbered Requirements, each with a user story and EARS criteria; one behaviour per line with the id first; every number carries a unit except candy counts
    - Cover the eight themes: separation distance (`WHEN a hand reaches in from any direction at up to 1.5 m/s THE arm SHALL keep every link at least 0.10 m from the hand`), fastest link near a hand, table contact force, candies dropped outside the bowls, sorting success (with `candies land anywhere on the tray`), heavier candies (0.005 kg to 0.060 kg), weaker vacuum (0.5 to 1), lagging tracker (up to 0.3 s)
    - The 0.10 m separation line may be reported broken against SSM_v1. That is a valid outcome. Do not weaken it, add a distance check, or edit the file to pass a run; a failing line leads to a controller change in a later spec or an entry in `proposals.md`
    - Write `test/requirements-compile.test.ts` (example): every acceptance criterion compiles against the lexicon with no error, using the golem-ears compiler
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.12, 15.9_

  - [ ]* 14.2 Write property test for requirement coverage
    - **Property 33: Every requirement line compiles**
    - File `test/p33-req-lines.test.ts` (every line compiles; at least one line per theme, including the two pairings of Requirements 11.2 and 11.3)
    - **Validates: Requirements 11.2, 11.3, 11.4, 11.8, 15.9**

  - [ ]* 14.3 Write property test for the parser round trip
    - **Property 32: Parser round trip over candy phrases**
    - File `test/p32-roundtrip.test.ts`
    - **Validates: Requirements 15.7**

- [ ] 15. Studio page
  - [ ] 15.1 Implement `web/hand-drag.ts`
    - Pure helpers: pick-ray to plane `z = h` intersection, clamp to a 1.5 m disc about (0.40, 0), per-frame step limit of `3 m/s * dt`, keyboard step of 0.05 m, height slider range 0.05 m to 0.25 m with Page Up and Page Down steps of 0.05 m
    - Write `test/web.test.ts` (examples): clamp, speed limit, keyboard step, release leaves the hand in place
    - _Requirements: 12.5, 12.6, 12.7, 12.8, 12.9, 12.17_

  - [ ]* 15.2 Write property tests for the hand-drag helpers
    - Properties from the Testing Strategy (`web.test.ts` row): the target is always within 1.5 m of the Table centre, the per-frame move never exceeds `3 m/s * dt`, a keyboard step is exactly 0.05 m
    - File `test/p-web-hand-drag.test.ts`
    - **Validates: Requirements 12.7, 12.9, 12.17**

  - [ ] 15.3 Implement `web/hud.ts` and `web/tablet.ts`
    - `hud.ts` shows live `min_link_hand_distance`, `tip_speed` and `candies_sorted`; `tablet.ts` binds each requirement line from the candy-sorter file to editable quantity controls, marks a line "running" within 100 ms of an edit, and sends the changed requirement to the TrialPool
    - Write `test/web-ui.test.ts` (examples, DOM stub): each quantity with a unit becomes a control, an edit marks the line running synchronously, HUD values update from a signal frame
    - _Requirements: 12.3, 12.4, 12.10_

  - [ ] 15.4 Implement `web/live.worker.ts` and `web/studio.ts`
    - `live.worker.ts`: one MuJoCo instance running the app, receives hand targets, posts poses and signals; `studio.ts`: worker client, ghost swarm, failing ghost in `--break` colour, "Replay the fall" replay, candy tints from `userdata[8 + i]`, render on demand with pixel ratio at most 1.5, paused off-screen, reduced-motion handling, sentence-case errors that say how to fix them
    - Import only from `golem-spec` and `golem-spec/ui`; no network access except static assets and no analytics
    - Write `test/web-studio.test.ts` (examples, stubbed worker): a failing trial adds a `--break` ghost to the reel, reduced motion steps replays frame by frame, a missing-asset error message names `robot/` and the fix
    - _Requirements: 12.1, 12.2, 12.11, 12.12, 12.13, 12.15, 12.16_

  - [ ] 15.5 Add the page shell
    - `web/index.html` (mobile viewport, no external fonts or scripts), `web/main.ts` (boot and wiring), `web/style.css` (design tokens from `design-language.md`, self-hosted B612 and B612 Mono, stage at 56vh on phones with the primary actions "Summon 64 ghosts", "Reach in" and "Reset hand" directly under it, 380 px tablet column from 1024 px)
    - Write `test/web-shell.test.ts` (examples): `index.html` has no external URLs, the CSS declares the 56vh rule and the three primary actions exist
    - _Requirements: 12.1, 12.2, 12.14, 12.15_

- [ ] 16. Kiro pack for the app
  - [ ] 16.1 Add the gate hook, README and proposals
    - `.kiro/hooks/gate.json`: an `agentStop` hook running `golem gate`; `apps/candy/README.md` with the `npm run assets` command, licence notes and the evidence pointer; `apps/candy/proposals.md` with a short header and a first entry for the expected SSM_v1 limit
    - Write `test/pack.test.ts` (examples): the hook file parses and runs `golem gate`, the README contains the regeneration command, `robot/LICENSE` is present, required files and folders exist
    - _Requirements: 13.2, 13.5, 13.10, 11.10_

- [ ] 17. Source hygiene
  - [ ] 17.1 Add the layout and import tests
    - Write `test/hygiene.test.ts` (examples): required files and folders exist, `package.json` declares `golem-spec`, no source file imports a path containing `skeleton/src`, every skeleton import uses `golem-spec`, `golem-spec/ui` or `golem-spec/node`, no `Math.random` in the app, no `Date.now` or `performance.now` in `controller/`, `lexicon.ts` or `app.ts`
    - _Requirements: 13.2, 13.3, 13.4, 15.13, 10.10, 5.14, 5.15_

  - [ ]* 17.2 Write property test for source hygiene
    - **Property 37: Source hygiene**
    - File `test/p37-hygiene.test.ts` (scan generated and mutated import lines; the scan flags exactly the forbidden ones)
    - **Validates: Requirements 5.14, 5.15, 10.9, 10.10, 13.3, 13.4, 15.13**

- [ ] 18. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-test sub-tasks and can be skipped for a faster MVP. Example tests inside implementation tasks are not optional.
- Task 3.5 needs network access once, in an explicit run of the asset script. After that, CI never touches the network.
- Task 14.1 depends on the golem-ears compiler. If it is not ready, keep the test and mark the dependency in the commit message; do not loosen the lines.
- Requirements 1.3 (anchored patches), 2.12, 2.13 and 12.2, 12.14 (look and layout) are checked by example tests and review. Long campaigns and the actual verdict on the 0.10 m line belong in `evidence/`, reported by `golem falsify`.
- Requirement 15.14 (never weaken assertions) is a rule for every task, not a task of its own.
- Physics-backed tests use horizons of at most 2 s after warm-up and at most 3 s per Trial.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.2", "3.1", "15.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "4.1", "6.1", "6.4", "7.1", "8.1", "12.1", "15.2"] },
    { "id": 3, "tasks": ["3.4", "4.2", "4.3", "4.4", "6.2", "6.3", "6.5", "7.2", "7.3", "7.4", "7.5", "8.2", "12.2", "12.3", "12.4", "12.5"] },
    { "id": 4, "tasks": ["3.5", "4.5", "4.6", "4.7", "4.8", "12.6", "12.7", "14.1"] },
    { "id": 5, "tasks": ["3.6", "4.9", "4.10", "5.1", "14.2", "14.3", "16.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6"] },
    { "id": 7, "tasks": ["9"] },
    { "id": 8, "tasks": ["10.1"] },
    { "id": 9, "tasks": ["10.2", "11.1"] },
    { "id": 10, "tasks": ["10.3", "11.2", "13.1"] },
    { "id": 11, "tasks": ["13.2", "13.3", "13.4", "13.5", "13.6", "15.3"] },
    { "id": 12, "tasks": ["15.4"] },
    { "id": 13, "tasks": ["15.5"] },
    { "id": 14, "tasks": ["17.1", "17.2"] },
    { "id": 15, "tasks": ["18"] }
  ]
}
```
