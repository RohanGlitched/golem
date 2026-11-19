# Implementation Plan: golem-studio-ui

## Overview

This plan builds `skeleton/src/ui` (published as `golem-spec/ui`) in TypeScript (strict, ES modules). The design uses TypeScript, so no language question applies.

Order of work:

1. Scaffolding and shared test support.
2. Pure logic modules with their tests: core, aura data, ghost state, status and codecs, tablet logic, reel logic. These need no browser, no WebGL and no MuJoCo.
3. A checkpoint.
4. The 3D layer: stage, hero sim, shove, ghost swarm, aura view, run controller.
5. The React panels (tablet, verdict) and layout.
6. A checkpoint.
7. The reel, then `mountStudio`.
8. Playwright browser tests.
9. A final checkpoint.

Conventions for every task:

- Logic tasks include their example tests in the same task, in Vitest, per `testing.md`. Each design Correctness Property is its own sub-task using fast-check with at least 100 runs and the tag comment `Feature: golem-studio-ui, Property N: <title>`.
- Test names state behaviour, for example `it('rejects a force typed with a time unit')`. No assertion or requirement is weakened to make a test pass.
- CI physics uses horizons of at most 2 s of simulated time and small trial budgets. Long campaigns stay in `evidence/`.
- Test files are separate per task: `__tests__/<module>.test.ts` and `__tests__/<module>.prop.test.ts`. Shared generators go in `__tests__/generators/<name>.ts`, one file per generator group, so parallel tasks never edit the same file.
- No `Math.random()` in `skeleton/src/ui`. No React import in `core/`, `stage/`, `hero/`, `ghosts/`, `aura/` or `run/`. Apps import only `golem-spec/ui`.
- Paths below are relative to `skeleton/src/ui/`.

## Tasks

- [x] 1. Package and entry scaffolding
  - [x] 1.1 Create the `golem-spec/ui` entry point, studio-local types and test support
    - Create the directory layout from the design (`core/`, `stage/`, `hero/`, `ghosts/`, `aura/`, `run/`, `tablet/`, `reel/`, `verdict/`, `layout/`, `__tests__/`, `e2e/`).
    - Create `index.ts` exporting `mountStudio`, `StudioOptions`, `StudioHandle` and `PerturbationVisual` (a stub `mountStudio` that throws "not implemented" until task 19), and `types.ts` with the studio-local types from Data Models, including `TokenSet`, `LineModel`, `StudioState`, `Budget`, `FalsifyFn` and the additive optional `PerturbationTemplate.visual` field.
    - Add the `golem-spec/ui` export map entry to `skeleton/package.json`, add `react@18`, `react-dom@18`, `three`, `@testing-library/react` and `@axe-core/playwright` as needed per `tech.md`, and extend `skeleton/tsconfig.json` and `skeleton/vitest.config.ts` for `.tsx` and the `ui` folder.
    - Create the test doubles in `__tests__/fakes.ts`: `FakeRaf`, `FakeClock`, `FakeMj` (records `mj_step`, exposes `xfrc_applied` and `xpos`, counts `.delete()`), `FakePool` and `fakeFalsify` with a synthetic robustness function, `FakeStorage`, `FakeMatchMedia`, `FakeClipboard`.
    - Write an example test that imports `golem-spec/ui` types and checks the export list is exactly the documented API.
    - _Requirements: 1.3, 28.3, 28.4, 28.5, 28.7, 28.8, 28.12, 30.1, 30.15_

- [x] 2. Core pure modules
  - [x] 2.1 Implement `core/prng.ts` and `core/format.ts`
    - `mulberry32`, `deriveStream(seed, label)`, `formatSig` (no exponent), `formatQuantityValue`, `decimalsOf`, `roundTo`.
    - Example tests: same seed gives the same sequence, `formatSig(0.000123, 3)` prints no exponent, `roundTo` removes binary noise such as 0.30000000000000004.
    - _Requirements: 6.9, 16.11, 18.7, 28.1_

  - [x] 2.2 Write property test for seeded determinism
    - **Property 48: Seeded determinism**
    - Include the source scan that fails on any `Math.random` call under `skeleton/src/ui`.
    - **Validates: Requirements 6.9, 28.1**

  - [x] 2.3 Implement `core/theme-tokens.ts`
    - `TOKENS` for dark and light with the eight steering tokens from `design-language.md` plus the derived `--break-text` and `--hold-text`, `relativeLuminance`, `contrastRatio` (WCAG 2.2).
    - Example tests: token values equal the table in `design-language.md`, derived tokens equal the design table values.
    - _Requirements: 25.1, 25.6, 25.7_

  - [x] 2.4 Write property test for theme tokens and contrast
    - **Property 44: Theme tokens and contrast**
    - **Validates: Requirements 25.1, 25.6, 25.9**

  - [x] 2.5 Implement `core/units-ui.ts`
    - Step tables, ranges per kind and unit, `toDisplay` and `fromDisplay` through `toSI` and `fromSI` from `golem-ears`.
    - Example tests: force, duration, angle and percent conversions to the display unit of each kind.
    - _Requirements: 16.9, 16.10, 18.7_

  - [x]* 2.6 Write property test for display unit conversion round trip
    - **Property 34: Display unit conversion round trip**
    - **Validates: Requirements 16.10, 18.7**

  - [x] 2.7 Implement `core/pose-math.ts`
    - `frameToTRS`, `writeMatrixTRS` (column-major, scale 1), `nlerp` with the shortest-arc sign rule, `quatRotateWXYZ`. All scalar maths, no allocation.
    - Example tests: identity quaternion gives the identity matrix, a 90° rotation about z maps +x to +y.
    - _Requirements: 2.8, 6.6, 10.6, 21.13_

  - [x] 2.8 Write property test for pose conversion
    - **Property 4: Pose conversion matches the quaternion definition**
    - **Validates: Requirements 2.8, 2.9, 21.13**

  - [x] 2.9 Implement `core/accumulator.ts`
    - `FixedStepAccumulator` with `add`, step cap with excess discard, remainder in `[0, dt)`, `resumeAfterHidden`.
    - Example tests: cap case, zero-duration frame after resume runs zero steps.
    - _Requirements: 5.8, 6.1, 6.2, 6.3_

  - [x] 2.10 Write property test for fixed-step decoupling
    - **Property 6: Fixed-step decoupling**
    - **Validates: Requirements 5.8, 6.1, 6.2, 6.3, 6.5**

  - [x] 2.11 Implement `core/spring.ts`
    - `shovePlaneNormal`, `rayPlane`, `springForce` (cap 400 N), `keyPushDirection` (camera-relative, vertical component zero).
    - Example tests: camera straight down gives no plane, ray parallel to the plane gives no target.
    - _Requirements: 7.2, 7.4, 7.7, 7.11, 7.12, 8.2_

  - [x] 2.12 Write property test for spring force
    - **Property 8: Spring force**
    - **Validates: Requirements 7.4, 7.11, 7.12**

  - [x]* 2.13 Write property test for ray and Shove_Plane intersection
    - **Property 9: Ray and Shove_Plane intersection**
    - **Validates: Requirements 7.2, 7.7**

  - [x]* 2.14 Write property test for key push direction and magnitude
    - **Property 10: Key push direction and magnitude**
    - **Validates: Requirements 8.2, 8.5**

  - [x] 2.15 Implement `core/scheduler.ts`
    - `RenderScheduler` with injected `raf` and `caf`, reasons as a bitmask, `acquire`, `release` (final frame), `requestOnce`, `setVisible`, `active`, `pendingFrames`.
    - Example test: with no Render_Reason active and a fake renderer, no `requestAnimationFrame` callback is pending.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 5.11, 30.9_

  - [x] 2.16 Write property test for the render scheduler
    - **Property 11: Render scheduler draws no idle frames**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 5.11**

  - [x] 2.17 Implement `core/tween.ts`
    - `easeOutCubic`, `tweenValue` (clamped, exact at p = 1), `TweenLoop` with its own `requestAnimationFrame` loop that stops when all tweens end and sets the value at once under Reduced_Motion.
    - Example tests: loop stops when idle, Reduced_Motion sets the final value at once.
    - _Requirements: 23.7, 23.8, 23.12_

  - [x]* 2.18 Write property test for number tween bounds
    - **Property 43: Number tween bounds**
    - **Validates: Requirements 23.7, 23.8, 23.14**

  - [x] 2.19 Implement `core/announcer.ts`
    - `Announcer` with a polite element and an alert element, `announceProgress` limited to one per 2000 ms, `announceFinal` always emitted, errors to the alert element, no focus moves.
    - Example tests: errors go to the alert region, no focus change.
    - _Requirements: 26.3, 26.4, 26.5, 26.13_

  - [x]* 2.20 Write property test for announcement rate limit
    - **Property 47: Announcement rate limit**
    - **Validates: Requirements 26.3, 26.5**

  - [x] 2.21 Implement `core/store.ts`
    - `StudioStore` with `subscribe`, `getState`, coalesced notify (at most one per frame), typed actions used by later tasks.
    - Example tests: several updates in one frame notify once, unsubscribe stops notifications.
    - _Requirements: 19.7, 23.9_

- [x] 3. Aura data and summary
  - [x] 3.1 Implement `aura/aura-model.ts`
    - `AuraModel` with 36 bins, `add` (held at least zero, broke below zero, `NaN` ignored and counted), tick list (lowest 512, order independent), `reset`, `binOf`, `boundaryForce`, `radiusAt` (linear between bin centres), radius `1.2 · min(1, B/forceMax)`, texel encoding.
    - Read force from the first dimension of kind `force` and direction from the first of kind `angle`; no Aura when either is missing.
    - Example tests: robustness exactly 0 counts as held, `NaN` is ignored, reset on source change.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.11, 13.12, 14.1, 14.3, 14.4_

  - [x] 3.2 Write property test for Aura bins against a reference model
    - **Property 24: Aura bins match a reference model**
    - **Validates: Requirements 13.1, 13.3, 13.4, 13.5, 13.6, 13.9**

  - [x] 3.3 Write property test for Aura order independence
    - **Property 25: Aura is order independent**
    - **Validates: Requirements 13.8**

  - [x] 3.4 Write property test for Aura angle wrap
    - **Property 26: Aura angle wrap**
    - **Validates: Requirements 13.2, 13.10**

  - [x]* 3.5 Write property test for Aura radius and smoothing
    - **Property 27: Aura radius and smoothing**
    - **Validates: Requirements 14.1, 14.3, 14.4**

  - [x] 3.6 Implement `aura/aura-summary.ts`
    - `auraSummary` with the four texts from the design (no force or direction, no trials, weakest direction, no break found with trial count). Lowest bin index on ties, direction `5 + 10·i` deg.
    - Example tests: each of the four texts, tie on lowest index.
    - _Requirements: 13.11, 14.7, 14.8, 14.9, 14.12_

  - [x]* 3.7 Write property test for the Aura summary
    - **Property 28: Aura summary names the weakest direction**
    - **Validates: Requirements 14.7, 14.8, 14.9, 14.12**

- [x] 4. Ghost state and push arrow maths
  - [x] 4.1 Implement `ghosts/ghost-state.ts`
    - Constants `SUMMON_S`, `FADE_S`, `RETIRE_S`, `OPACITY_RUNNING`, `OPACITY_SURVIVOR`, and `evalGhost` writing into a reused struct (frame index, alpha, `breakMix`, opacity, rise, hidden), including Reduced_Motion steps and `-Infinity` robustness.
    - Example tests: survivor opacity is below running opacity, reduced motion has zero rise and a step fade.
    - _Requirements: 10.5, 10.6, 10.7, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9_

  - [x] 4.2 Write property test for the break state
    - **Property 15: Break state if and only if robustness is below zero**
    - **Validates: Requirements 11.1, 11.3, 11.8, 11.9**

  - [x]* 4.3 Write property test for break fade and summon bounds
    - **Property 16: Break fade and summon bounds**
    - **Validates: Requirements 11.2, 11.4, 11.5, 11.6, 11.7**

  - [x] 4.4 Implement `ghosts/push-arrow.ts`
    - `resolveArrow` from `PerturbationCall`, template `visual` and scenario (string params look up dimension names), length `clamp(0.3·|F|/100, 0.05, 0.9)`, no arrow for a zero force or a missing `visual`.
    - Example tests: missing `visual` gives no arrow, a 100 N force gives 0.3 m.
    - _Requirements: 12.1, 12.2, 12.3, 12.7, 12.8_

  - [x]* 4.5 Write property test for push arrow direction and length
    - **Property 23: Push arrow direction and length**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.7, 12.8**

- [x] 5. Status, codecs, pins and verdict rows
  - [x] 5.1 Implement `run/status.ts`
    - `statusOfVerdict`, `lineStatusOf` (compile error, running, verdict, untested), `marginText` (`-Infinity` gives "diverged"), `counterexampleSummary` with the phrase table, "falls" or "fails" verb selection, button label selection ("Replay the fall" or "Replay the failure"), "depends on the seed".
    - Example tests: "falls from 168 N at 135 deg, 62% into the stride", `seed-sensitive` suffix, never the words "proved" or "verified".
    - _Requirements: 17.7, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.12, 20.12_

  - [x]* 5.2 Write property test for status
    - **Property 36: Status is broken if and only if the verdict is broken**
    - **Validates: Requirements 17.7, 18.1, 18.2, 18.14**

  - [x]* 5.3 Write property test for margin text
    - **Property 37: Margin text**
    - **Validates: Requirements 18.3, 18.15**

  - [x]* 5.4 Write property test for counterexample summary units
    - **Property 38: Counterexample summary units**
    - **Validates: Requirements 18.4, 18.6, 18.7, 18.8**

  - [x] 5.5 Implement `run/seed-json.ts`
    - `seedToJson` (2-space indent, stable key order, sorted scenario keys, non-finite robustness as strings, `-0` normalised) and `seedFromJson` returning a result object, never throwing.
    - Example tests: `-Infinity` robustness round trip, invalid JSON gives an error message.
    - _Requirements: 22.1, 22.14_

  - [x] 5.6 Write property test for seed JSON round trip
    - **Property 40: Seed JSON round trip**
    - **Validates: Requirements 22.1, 22.14**

  - [x] 5.7 Implement `run/pins.ts`
    - `PinnedSeedStore` with `read`, `pin`, `remove`, `sameCounterexample` (same `reqId`, same `seed`, equal values per dimension name), key `golem:pins:v1:<appId>:<reqId>`, in-memory fallback with the announcement text, one warning with the count of ignored entries.
    - Example tests: storage missing, storage full, invalid JSON, valid mixed with invalid entries.
    - _Requirements: 22.3, 22.4, 22.6, 22.7, 22.16_

  - [x]* 5.8 Write property test for pinned seeds
    - **Property 41: Pinned seeds are stored once and invalid entries are skipped**
    - **Validates: Requirements 22.3, 22.4, 22.7, 22.16**

  - [x] 5.9 Implement `run/share-hash.ts`
    - `encodeShare` (`#g=` plus base64url of compact JSON, UTF-8, no `Buffer`), `decodeShare` (never throws, lists ignored parts), `buildShareState`, `fitShare` (4000 characters, drop lines equal to the original first, then edited lines from the end, `tooLong` and omitted ids).
    - Example tests: malformed hash loads the original with the message, unknown id ignored while valid ids apply, over-length message text.
    - _Requirements: 22.8, 22.9, 22.10, 22.11, 22.12, 22.15, 29.7_

  - [x] 5.10 Write property test for share hash round trip and limit
    - **Property 39: Share hash round trip and limit**
    - **Validates: Requirements 22.8, 22.10, 22.11, 22.12, 22.13**

  - [x] 5.11 Implement `verdict/verdict-rows.ts`
    - Format rows from a `Verdict` and the pool size: trials, random, guided, closest call, failure-rate bound (two significant figures, "not available"), wall time, pool size, the held sentence with the Budget, and no claim of proof.
    - Example tests: held sentence text, failure-rate bound "not available".
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.11, 18.12_

  - [x]* 5.12 Write property test for verdict display
    - **Property 42: Verdict display**
    - **Validates: Requirements 18.12, 23.1, 23.2, 23.3, 23.4, 23.5, 23.11, 23.13**

- [x] 6. Tablet logic
  - [x] 6.1 Implement `tablet/segments.ts`
    - `segmentLine` using `tokenize` from `golem-ears`: keyword, quantity and plain segments, inherited unit for `150 to 250 N`, numbers rejected by `parseQuantity` stay plain.
    - Example tests: `WHEN … with up to 200 N …` splits into the expected segments, range with inherited unit.
    - _Requirements: 15.2, 15.11, 16.1_

  - [x]* 6.2 Write property test for tablet text display
    - **Property 29: Tablet text display**
    - **Validates: Requirements 15.2, 15.11, 16.1**

  - [x] 6.3 Implement `tablet/quantity-edit.ts`
    - `effectiveStep`, `stepQuantity`, `dragQuantity` (`trunc(dx / 4)` steps), `rangeOf`, `rewriteSpan`, `formatSpan` (same unit and gap as written), `commitTyped` (unit of another kind rejected with "Write a force: 200 N, not 200 s", no unit uses the original unit).
    - Example tests: `it('rejects a force typed with a time unit')`, Shift multiplies by 10, Alt by 0.1.
    - _Requirements: 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.9, 16.10, 16.11, 16.12, 16.18_

  - [x] 6.4 Write property test for quantity step round trip
    - **Property 30: Quantity step round trip**
    - **Validates: Requirements 16.3, 16.4, 16.5, 16.11, 16.15**

  - [x] 6.5 Write property test for quantity clamp
    - **Property 31: Quantity clamp**
    - **Validates: Requirements 16.2, 16.9, 16.16**

  - [x] 6.6 Write property test for quantity rewrite
    - **Property 32: Quantity rewrite touches only its span**
    - **Validates: Requirements 16.10, 16.12, 16.17, 16.18**

  - [x]* 6.7 Write property test for typed values with the wrong unit
    - **Property 33: Typed values with the wrong unit are rejected**
    - **Validates: Requirements 16.6, 16.7**

  - [x] 6.8 Implement `tablet/diagnostics-view.ts`
    - `underlineRanges` clamping into `[0, text.length]`, sorted, disjoint, zero-width widened to one UTF-16 unit when inside the text.
    - Example tests: one test per `golem-ears` Diagnostic kind (`PATTERN_MISMATCH`, `MISSING_UNIT`, `UNKNOWN_PHRASE`, `BAD_RANGE`, `UNKNOWN_ROBOT`, `NON_EARS_LINE`) asserting that `kind`, `line` and `column` appear in the message list entry and the underline range.
    - _Requirements: 17.3, 17.4, 17.11, 17.12, 30.10_

  - [x]* 6.9 Write property test for diagnostic underline ranges
    - **Property 35: Diagnostic underline ranges**
    - **Validates: Requirements 17.11, 17.12, 17.13**

- [ ] 7. Reel logic
  - [ ] 7.1 Implement `reel/filmstrip.ts` frame selection
    - `filmstripFrames(worstTau, frameCount, fps)` returning eight entries spaced over `worstTau ± 0.35 s`, clamped, one marked worst (lowest index on ties). Rendering comes in task 18.
    - Example tests: a worst moment near the start clamps `tau` to 0, a single-frame recording returns eight entries at frame 0.
    - _Requirements: 20.1, 20.2, 20.5_

  - [ ]* 7.2 Write property test for filmstrip frame selection
    - **Property 45: Filmstrip frame selection**
    - **Validates: Requirements 20.1, 20.2**

  - [ ] 7.3 Implement `reel/replay.ts` controller
    - `ReplayController` at 0.25 times real time with `advance`, `seekFrame`, `stepFrame(±1)`, stop at the last frame, Reduced_Motion makes `advance` a no-op, `enter` and `exit` hooks that call injected `hero.snapshot()`, `hero.restore()`, `scheduler.acquire('replaying')` and `scheduler.release('replaying')`.
    - Example tests: enter and exit call the hooks once, "Back to live" restores the snapshot.
    - _Requirements: 21.1, 21.2, 21.4, 21.5, 21.7, 21.8, 21.9, 21.10_

  - [ ]* 7.4 Write property test for replay position
    - **Property 46: Replay position stays in range**
    - **Validates: Requirements 21.2, 21.4, 21.5, 21.8, 21.9**

- [ ] 8. Checkpoint - Pure logic complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Stage
  - [ ] 9.1 Implement `stage/stage-builder.ts`
    - `buildStage(modelLike, THREE, material)` for geom group 2 only, with box, sphere, capsule, cylinder, ellipsoid, mesh and plane, geometry baking per the design table, body groups keyed by `geom_bodyid`, `geom_pos` and `geom_quat` (wxyz to xyzw), `skipped`, `warnings`, `meshCount`, `geomInfo`. Read arrays once; keep no view into WASM memory.
    - Example tests: unsupported type warns once with geom id and type, zero-face mesh warns once with geom id, `meshCount` equals `meshes.length`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14_

  - [ ] 9.2 Write property test for stage mesh count and group filter
    - **Property 1: Stage mesh count and group filter**
    - **Validates: Requirements 2.1, 2.2, 2.7, 2.11, 2.12, 2.13**

  - [ ] 9.3 Write property test for primitive extents
    - **Property 2: Primitive extents match MuJoCo**
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.6**

  - [ ]* 9.4 Write property test for stage build determinism
    - **Property 3: Stage build is deterministic**
    - **Validates: Requirements 2.14**

  - [ ] 9.5 Implement `stage/clay-material.ts`
    - `CLAY_VERT`, `CLAY_FRAG`, `createClayMaterial(tokens)` as a `ShaderMaterial` with the uniforms from the design: key light at 35° azimuth and 15° elevation, fill ratio 0.33, grain amplitude 0.06, procedural noise, no texture, no time uniform.
    - Example tests: source strings contain no `sampler2D` and no time uniform, key elevation constant is at most 20°, fill to key ratio is at most 0.35, grain amplitude is at most 0.06.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.8_

  - [ ] 9.6 Implement `stage/floor.ts`
    - `createFloor` as a `MeshBasicMaterial` plane in `--ground` with extent `max(size, 20)` m, no grid, no reflection, no texture, and the fog that fades to `--ground` at the edge.
    - Example tests: extent for a small plane declaration is 20 m, colour equals the `--ground` token.
    - _Requirements: 2.6, 3.5, 3.7_

  - [ ] 9.7 Implement `stage/orbit.ts`
    - `createOrbit` wrapping three's `OrbitControls`: damping 0.12 (off under Reduced_Motion), polar limit above the floor, zoom limits from the bounding radius, touch rotate and pinch zoom, Shift plus arrow rotates 5°, `transition` reason acquired on `change` and released when travel is below 0.1 mm for one frame, no orbit when the press starts on a robot body.
    - Example tests: Shift plus ArrowLeft rotates 5°, `transition` is released after settling.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 26.8_

  - [ ] 9.8 Implement `stage/stage.ts`
    - `Stage` with renderer creation (injected `createRenderer`), camera (z-up, 40°), pixel ratio `min(devicePixelRatio, 1.5)`, `setModel`, `setTheme` (clay, floor, fog, background, ghost and aura uniforms, one render), `resize` (renderer size, camera aspect, one render), Visibility_Gate (`IntersectionObserver` and `visibilitychange` calling `scheduler.setVisible` and `hero.pause`), WebGL loss and restore messages, canvas `tabindex="0"`, `role="application"`, accessible name and the push instructions text, the "Loading the robot" message, and `dispose`.
    - Example tests with a fake renderer: theme change updates tokens and requests one render, resize requests one render, hidden stage stops frames, context loss shows "The 3D view was lost".
    - _Requirements: 3.6, 3.7, 5.5, 5.6, 5.7, 5.8, 5.9, 8.1, 8.10, 26.6, 27.7, 27.8, 29.3_

  - [ ]* 9.9 Write property test for pixel ratio cap
    - **Property 12: Pixel ratio cap**
    - **Validates: Requirements 5.5**

- [ ] 10. Hero simulation and shove
  - [ ] 10.1 Implement `hero/load-hero.ts`
    - The only file touching `golem-sim` loader names: load the `RobotApp` files, create `MjModel`, `MjData` and `SimContext`, copy model arrays once into a `ModelLike`, report `app.files()` rejection and MuJoCo load failure as messages that name the app and the failure.
    - Example tests with `FakeMj`: copied arrays do not alias the source, rejection of `files()` yields the message text from the design.
    - _Requirements: 2.10, 29.1, 29.2_

  - [ ] 10.2 Implement `hero/hero-sim.ts`
    - `HeroSim` with `advance` using `FixedStepAccumulator`, controller decimation by `round(controlDt / simDt)`, `xfrc_applied` zeroed before forces each step, view refresh on `buffer` identity change, `app.makeController` and `app.initState` with the studio-derived PRNG, body groups synced from `xpos` and `xquat`, divergence reset with its announcement, `reset` (answers within 100 ms), `pause`, `resume`, `wake`, idle sleep after `idleSleepMs`, `snapshot` and `restore`, the `simulating` reason while running and visible, "Running slower than real time" flag when the Step_Cap is hit, `dispose` calling `.delete()` on `MjData` then `MjModel` once. No allocation in the step loop.
    - Example tests with `FakeMj`: zeroing before every step, view refresh, divergence resets and announces, `.delete()` counts, sleep releases `simulating`.
    - _Requirements: 6.1, 6.4, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 27.10_

  - [ ]* 10.3 Write property test for control decimation
    - **Property 7: Control decimation**
    - **Validates: Requirements 6.4**

  - [ ] 10.4 Implement `hero/shove.ts` pointer and touch shove
    - `ShoveController`: raycast against stage meshes, Grab_Point stored in body-local frame, target from ray and Shove_Plane (keep the previous target on a miss), `springForce` through `hero.setForce('shove', …)` with torque about the centre of mass, Shove_Arrow and the live label in whole newtons with Tabular_Figures, release within one frame, `dragging` reason, second pointer ignored, touch with non-passive listeners and `touch-action: none` only while on a body, peak force announced on release, Escape cancels.
    - Example tests with a fake raycaster: arrow and label cleared on release and on cancel, second pointer ignored, label rounds to the nearest 1 N.
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.13, 7.14, 8.9_

  - [ ] 10.5 Add the keyboard Key_Push to `hero/shove.ts`
    - Arrow without Shift applies 100 N for `round(0.2 / simDt)` steps on the primary push body (from `options.primaryPushBody`, defaulting to the first perturbation template's `visual` body), a second arrow restarts it, same arrow and label as the pointer shove, `dragging` reason held for the duration, announcement "Pushed 100 N toward the <direction>" at the end, Escape cancels.
    - Example tests: restart with a new direction, end announces the direction, Escape cancels and clears the arrow.
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

- [ ] 11. Ghost swarm
  - [ ] 11.1 Implement `ghosts/ghost-shader.ts`
    - `GHOST_VERT`, `GHOST_FRAG`, `createGhostMaterial(theme)`: fresnel rim, per-instance `aState` (colour mix, opacity, rise), `transparent`, `depthWrite: false`, additive blending in the dark theme and normal blending in the light theme, `renderOrder` 10, no time uniform.
    - Example tests: material flags per theme, source has no time uniform, a zero opacity discards.
    - _Requirements: 9.3, 9.4, 9.11_

  - [ ] 11.2 Implement the core of `ghosts/ghost-swarm.ts`
    - `GhostSwarm` with one `InstancedMesh` of capacity 64 per drawn geom sharing the hero geometry, one shared `aState` `InstancedBufferAttribute`, one arrow `InstancedMesh`, struct-of-arrays slot data, `beginGeneration`, `accept` (first 64 of a Generation, `nbody` and length validation with the warning text from the design, `validFrames` for non-finite frames, result without poses creates no ghost), `clear`, `shown`, `count` as highest slot plus one, `setTheme`, `dispose` of every `InstancedMesh`, geometry and material it created.
    - Example tests: more than 64 results keep the first 64, `nbody` mismatch warns with both numbers, clear hides every slot, dispose counts.
    - _Requirements: 9.1, 9.2, 9.5, 9.6, 9.7, 9.8, 9.9, 9.11, 9.12, 10.2, 10.12, 10.13, 29.5, 29.6_

  - [ ] 11.3 Add playback, break fade, summoning and arrows to `ghosts/ghost-swarm.ts`
    - `commitGeneration(clockStart)` with the shared clock, leftover slots retire over 300 ms, `timeOf`, `update(now)` writing instance matrices as body matrix times geom-local matrix with `nlerp` into preallocated arrays, `evalGhost` state per slot, Push_Arrows between trigger and the end of the perturbation window with the ghost's colour state and fade, `ghosts-running` reason held while anything animates.
    - Example tests: the staged ghost is visible within 100 ms of the first result, arrows hide after the perturbation window, `update` returns false when everything has ended.
    - _Requirements: 9.10, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.10, 12.4, 12.5, 12.6, 27.3, 27.4_

  - [ ]* 11.4 Write property test for ghost matrices
    - **Property 5: Ghost matrices compose and are deterministic**
    - **Validates: Requirements 9.10, 28.10**

  - [ ]* 11.5 Write property test for ghost frame selection and interpolation
    - **Property 13: Ghost frame selection and interpolation**
    - **Validates: Requirements 10.4, 10.5, 10.6, 10.7**

  - [ ]* 11.6 Write property test for generation sync
    - **Property 14: Ghosts of one Generation are in sync**
    - **Validates: Requirements 10.14**

  - [ ]* 11.7 Write property test for generation capacity
    - **Property 17: Generation capacity**
    - **Validates: Requirements 9.1, 9.5, 9.6, 9.8**

  - [ ]* 11.8 Write property test for pose frame validation
    - **Property 22: Pose frame validation**
    - **Validates: Requirements 10.12, 10.13, 29.5, 29.6**

- [ ] 12. Aura rendering
  - [ ] 12.1 Implement `aura/aura-view.ts`
    - The 36×1 `Uint8` `DataTexture` (linear filter, repeat wrap on U), the decal quad with `AURA_VERT` and `AURA_FRAG` (`--hold` fill and ring, dashed edge for held-only bins, discard for unknown bins), the instanced tick mesh with `TICK_VERT` (capacity 512, unused instance off the decal), texture rewrite and `scheduler.requestOnce()` per trial batch, theme uniforms, re-centre on Reset, no glow and no shadow, `dispose`.
    - Example tests: texture wrap, filter and size, one `requestOnce` per batch, a bin with a break writes `G = 255`.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.11_

- [ ] 13. Run orchestration
  - [ ] 13.1 Implement `run/recording-pool.ts`
    - `RecordingPool` implementing `TrialPool`: chunks of at most 64, `record: 'poses'` on every forwarded spec, `beginGeneration`, `ingest` and `commit` hooks, results returned in input order with `poses` removed, `size` from the inner pool, `close` never closes the inner pool, a throwing chunk propagates and skips `commit`.
    - Example tests: chunk sizes for 130 specs, error path skips `commit`.
    - _Requirements: 1.10, 10.1_

  - [ ]* 13.2 Write property test for the RecordingPool
    - **Property 20: RecordingPool preserves results and records poses**
    - **Validates: Requirements 1.10, 10.1**

  - [ ] 13.3 Implement `run/falsify-adapter.ts`
    - The `FalsifyFn` type and its default binding to `golem-falsify`; the only file that names falsify option names (`signal`, `seeds`, `onProgress`, `generationSize`).
    - Example test: the adapter passes seeds, signal and generation size through to a fake falsifier.
    - _Requirements: 19.3, 19.16_

  - [ ] 13.4 Implement `run/run-controller.ts`
    - `RunController` with `start`, `startAll` (file order, skip lines with errors), `stop`, `select`, `dispose`; `Run_Id` pinned to every callback with a `guard`; one run at a time on the pool; abort and await settle before a new run; per-run `trialCount`, closest call and best counterexample retention; aura, counters and swarm fed from `ingest`; previous Generation poses dropped except the two retained; verdict storage, Aura summary, announcements, `stale` marking on cancel, `AbortError` shows no error, other errors set `error` status with the `TrialSpec` named; pinned seeds from `PinnedSeedStore` passed as Phase 0 seeds; no run on load unless `autorun`; no run for a line with an error Diagnostic.
    - Example tests with `fakeFalsify`: Summon button label becomes "Stop the run" while active, stale verdict marked, pinned seeds passed, error versus `AbortError`, first ghost or running status within 100 ms.
    - _Requirements: 10.1, 10.2, 10.3, 10.10, 10.11, 10.15, 10.16, 10.17, 17.7, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9, 19.10, 19.11, 19.12, 19.13, 19.14, 19.15, 19.16, 29.4_

  - [ ]* 13.5 Write property test for counts covering all trials
    - **Property 18: Counts cover all trials**
    - **Validates: Requirements 10.12, 10.15, 10.16, 10.18**

  - [ ]* 13.6 Write property test for bounded pose retention
    - **Property 19: Pose retention is bounded**
    - **Validates: Requirements 10.17**

  - [ ]* 13.7 Write property test for stale runs
    - **Property 21: Stale runs change nothing**
    - **Validates: Requirements 10.11, 19.3, 19.11, 19.15**

- [ ] 14. Tablet (React 18)
  - [ ] 14.1 Implement `tablet/quantity-control.tsx`
    - A `<span role="spinbutton" tabindex="0">` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-valuetext`, `aria-label`; pointer drag (one step per 4 px, `touch-action: none` while dragging, live number update on every move), arrow keys with Shift and Alt modifiers, typed commit on Enter or blur with the inline message from `commitTyped`, visible focus ring, pointer target at least 24 px high, 80 ms debounce before recompile and run.
    - Testing Library example tests: ARIA attributes, ArrowUp and ArrowDown steps, `it('rejects a force typed with a time unit')` shows the inline message and keeps the value.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.12, 16.13, 16.14_

  - [ ] 14.2 Implement `tablet/line-editor.tsx`
    - Transparent `<textarea>` over a mirrored underline layer (wavy `--break` underline), recompile 100 ms after the last keystroke, Diagnostic message list with suggestion and "Use suggestion" button, `aria-describedby` and `aria-invalid`, Enter or blur commits when the line compiles (updates the Share_Hash, starts a run), Escape restores the previous text, writes no file.
    - Testing Library example tests: Escape restores, suggestion button replaces the line, `aria-invalid` while an error Diagnostic exists, nothing is written to disk.
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.8, 17.9, 17.10_

  - [ ] 14.3 Implement `tablet/requirement-line.tsx`
    - One line with ID, segments (keywords at 0.85em and letter-spacing 0.04em, quantity controls, plain text), `aria-current="true"` and the 2 px `--clay` left rule when selected, status text and shape (not colour alone) for `untested`, `running`, `held`, `broken`, `error`, Margin_Text in Tabular_Figures, the Fracture hairline for `broken` only, no check mark or green fill for `held`, "Edit line", "Summon 64 ghosts" (verb phrase, becomes "Stop the run" while active), accessible name as ID plus text with status via `aria-describedby`, Enter or click selects.
    - Testing Library example tests: status text for each state, Fracture only when broken, held text reads "no counterexample found in N trials".
    - _Requirements: 15.2, 15.3, 15.4, 15.7, 15.8, 15.10, 18.1, 18.2, 18.3, 18.4, 18.5, 18.9, 18.10, 18.12, 18.13, 18.16, 19.1, 19.12, 26.11_

  - [ ] 14.4 Implement `tablet/tablet.tsx`
    - The Tablet container: lines in file order, group headings from Kiro requirement headings, the empty message "No requirements found: add lines such as 'WHEN …, THE robot SHALL …' to your requirements.md", the "Summon 64 ghosts for every line" button, the disabled Summon message when no pool is configured, selection that sets the Aura_Source and the Reel subject, `aside` landmark with an accessible name, Live_Region announcements of status changes with line ID and summary.
    - Testing Library example tests: file order, empty message text, disabled-pool message, status change announced.
    - _Requirements: 1.7, 15.1, 15.5, 15.6, 15.9, 15.10, 18.11, 19.2, 19.4, 26.10_

- [ ] 15. Verdict panel
  - [ ] 15.1 Implement `verdict/number-tween.tsx`
    - A React number display using `TweenLoop` (250 ms ease-out, once per frame reads from the store), B612 Mono Tabular_Figures, a visual copy marked `aria-hidden` plus a visually hidden copy with the final value, `aria-label` that names the number.
    - Testing Library example tests: final value present in the DOM text immediately, Reduced_Motion shows the value at once.
    - _Requirements: 23.6, 23.7, 23.8, 23.9, 23.12, 23.15_

  - [ ] 15.2 Implement `verdict/verdict-panel.tsx`
    - A `region` with an accessible name showing the rows from `verdict-rows`, live counters while a run is active, the Aura_Summary text line, the held sentence with the Budget, and the stale marker.
    - Testing Library example tests: rows equal the `Verdict` after formatting, the Aura_Summary is a visible text line, no "proved" text.
    - _Requirements: 14.10, 19.6, 23.1, 23.10, 23.11, 23.13, 26.10_

- [ ] 16. Layout, themes and accessibility
  - [ ] 16.1 Implement `layout/styles.ts`
    - One injected `<style>` string: theme token blocks for `[data-golem-theme]`, `@font-face` for B612 and B612 Mono from `fontBaseUrl`, grid at 1024 px (380 px Tablet column left, full-bleed Stage, Reel under it) and the single column below (Stage 56vh, primary actions, Tablet, Reel), 16 px body with line-height 1.55 and a 72ch measure, the type scale 13, 16, 20, 25, 31, 39, 61 px, 2 px control radius, 0 for the Stage, 1 px borders in `--clay` at 35%, no gradient, no drop shadow, 44 px touch targets below 1024 px, 2 px focus ring, no Gloock, no horizontal overflow.
    - Example tests on the CSS string: no `gradient`, no `box-shadow`, no `Gloock`, `56vh` present in the narrow block, focus ring width at least 2 px.
    - _Requirements: 15.2, 15.3, 15.5, 24.1, 24.2, 24.3, 24.5, 24.6, 24.7, 24.8, 24.9, 24.11, 24.12, 26.2_

  - [ ] 16.2 Implement `layout/theme.ts`
    - `ThemeController`: initial theme from saved `localStorage['golem:theme']`, then `prefers-color-scheme`, then `options.theme`, then dark; toggle with `aria-pressed` answering within 100 ms; follows system changes only while nothing is saved; in-memory fallback without storage; writes `data-golem-theme`, calls `stage.setTheme(tokens)` and `requestOnce()`.
    - Example tests: saved choice beats the system, system change followed only when nothing is saved, storage-less fallback.
    - _Requirements: 25.2, 25.3, 25.4, 25.5, 25.7, 25.8_

  - [ ] 16.3 Implement `layout/boundary.tsx` and the live regions
    - `PanelErrorBoundary` showing "This panel failed to draw: {message}" with "Reload this panel" that remounts only that panel; the polite and alert Live_Region elements; landmark markup (`main`, `aside`, `region`) for the shell; the primary actions bar ("Summon 64 ghosts for every line", "Reset", theme toggle) under the Stage on narrow viewports; the replay controls container.
    - Testing Library example tests: a throwing child shows the message and the button, reloading remounts only that panel, the other panels stay mounted.
    - _Requirements: 24.4, 26.1, 26.3, 26.4, 26.7, 26.10, 29.8_

- [ ] 17. Checkpoint - Stage, runs and panels complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Reel and replay
  - [ ] 18.1 Implement the filmstrip render job in `reel/filmstrip.ts`
    - `FilmstripJob` using one offscreen `WebGLRenderTarget(160, 120)` from the Stage renderer, one frame per animation frame in its own `requestAnimationFrame` loop, hero body groups set to the frame pose, ghosts, aura and live arrows hidden, a private camera, `readRenderTargetPixels` into one reused buffer flipped into eight canvases, live pose and render target restored in the same synchronous task, no change to the main camera, abort by token, canvases with `role="img"` and `aria-label` such as "Frame at 0.35 s after the push: pelvis 0.31 m above the floor".
    - Example tests with a fake renderer: one frame per animation frame, live pose restored, main camera unchanged, aborted job draws nothing further.
    - _Requirements: 20.3, 20.4, 20.10, 20.11, 20.14, 27.9_

  - [ ] 18.2 Integrate Replay with the stage and scrubber
    - Apply replay poses to the hero body groups through the shared `frameToTRS` path, pause the hero, hold the `replaying` reason, "Pause", "Play", "Back to live" and "Next frame" (Reduced_Motion) controls with the label matching the state, the Scrubber (`role="slider"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, `aria-valuetext` in seconds after the push, ArrowLeft and ArrowRight step one frame, `--break` tick at the worst-margin time), the replay time label in Tabular_Figures rounded to 0.01 s, the push arrow shown while the replay time is inside the perturbation window.
    - Testing Library example tests: slider ARIA attributes, arrow keys step one frame, "Back to live" restores the hero.
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7, 21.8, 21.9, 21.10, 21.11, 21.12, 21.13_

  - [ ] 18.3 Implement `reel/reel.tsx`
    - A `region` with an accessible name: the Filmstrip with frame time labels and the worst frame marked, Counterexample_Summary and classification, buttons "Replay the fall" or "Replay the failure", "Copy seed" and "Pin this seed", pinned list with "Remove pin", the "No counterexample selected. A broken line shows its failure here." message, replay trial through the pool (or the retained poses, no trial), error display that keeps "Copy seed" and "Pin this seed" active, clipboard failure fallback with the selectable field and announcement, Share_Hash update with `history.replaceState`, a horizontally scrollable strip on narrow viewports, content update within 100 ms of a selection change with the pending replay aborted.
    - Testing Library example tests: empty message, clipboard failure shows the JSON field and announces, pin twice stores once, selecting another line aborts the pending replay, replay trial error keeps the two buttons active.
    - _Requirements: 20.1, 20.5, 20.6, 20.7, 20.8, 20.9, 20.11, 20.12, 20.13, 22.1, 22.2, 22.3, 22.5, 22.6, 22.9, 26.7_

- [ ] 19. Studio assembly
  - [ ] 19.1 Implement `mount.ts`
    - `mountStudio(el, app, requirementsMarkdown, options)`: `TypeError('mountStudio needs an HTMLElement as its first argument')` for a non-element, extract with the `golem-ears` extractor and compile each criterion, render Tablet, Reel and Verdict_Panel first, then start the async hero load, WebGL probe with the no-WebGL message, apply a valid Share_Hash and show the messages for ignored parts, defaults for pool, seed, budget and other options, pool built from `workerUrl` only when `pool` is absent (closed on dispose, a supplied pool is not), wire stage, hero, shove, swarm, aura, run controller, store, announcer, theme controller and layout, `ready` promise, `performance.mark('golem:first-frame')` and `data-first-frame`, `testHooks`, and an idempotent `dispose` in the order from the design (cancel runs, remove listeners, dispose geometry, material, renderer and the offscreen target, `.delete()` MuJoCo handles, unmount React roots, remove DOM).
    - Example tests with fakes: non-element throws, empty markdown mounts the empty Tablet, no-WebGL mounts the panels with the message, `dispose()` twice is silent, `.delete()` counts, an injected pool is not closed, a pool built from `workerUrl` is closed.
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 6.12, 22.10, 22.11, 27.2, 27.7, 28.6, 29.1, 29.7_

  - [ ] 19.2 Finish `index.ts` and write the source-scan tests
    - Replace the stub with the real `mountStudio` export and keep the exports to the documented API.
    - Source scans in Vitest: no `Math.random`, no `react` import in `core/`, `stage/`, `hero/`, `ghosts/`, `aura/` or `run/`, the module dependency order from the design, no `fetch` or `XMLHttpRequest` except for static assets, no `react-three-fiber`, no analytics or tracker import, exports equal the documented API only.
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.7, 28.8, 28.9_

- [ ] 20. Playwright browser tests
  - [ ] 20.1 Build the Playwright harness and the test app
    - Add `playwright.config.ts` for `skeleton/src/ui/e2e/`, a Vite page that mounts the studio with the `golem-sim` Test_App MJCF and a fake pool through `testHooks` with a `summonSynthetic(n)` hook feeding `n` pose results at a 2 s horizon, a stage frame counter exposed through `studio.getState()`, and the `@perf` tag convention (not run in default CI).
    - _Requirements: 30.11, 30.12_

  - [ ] 20.2 Write the Frame_Probe test with 64 ghosts
    - `@perf`: summon 64 synthetic ghosts with the hero running, record `requestAnimationFrame` intervals for 5 s, assert median at most 17 ms and 95th percentile at most 25 ms.
    - _Requirements: 27.1, 30.11_

  - [ ] 20.3 Write first-frame, idle, draw-call and WebGL-context tests
    - First meaningful frame: `golem:first-frame` mark below 4000 ms from navigation with the Tablet text visible. Idle: zero stage frames for 1 s after the verdict, the hero sleep and the ghost fade. Draw calls: `renderer.info.render.calls` at most one per geom for ghosts plus one for arrows plus the hero, floor, aura and tick calls. One WebGL context through a wrapped `getContext`.
    - _Requirements: 5.11, 20.4, 27.2, 27.3, 27.6, 30.11_

  - [ ] 20.4 Write the 375 px layout test
    - Viewport 375 px wide in both themes: `document.documentElement.scrollWidth` at most 375 and no element's `getBoundingClientRect().right` beyond 375, with the Reel strip scrolling inside its own container.
    - _Requirements: 20.13, 24.5, 30.11_

  - [ ] 20.5 Write the accessibility and keyboard tests
    - `@axe-core/playwright` scan with no serious or critical violation in both themes. Keyboard path: Tab order (primary actions, Tablet lines, Reel), arrow Key_Push shows and clears the label, spinbutton stepping, Escape cancels, pointer shove label rises while dragging and clears within one frame of release.
    - _Requirements: 7.5, 7.6, 8.2, 8.9, 16.3, 26.1, 26.12, 30.11_

- [ ] 21. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property sub-tasks and can be skipped for a faster MVP. Core properties stay required: 1, 2, 4, 6, 8, 11, 15, 24, 25, 26, 30, 31, 32, 39, 40, 44 and 48.
- Each task references granular requirement clauses for traceability.
- Properties 1 to 48 each map to exactly one sub-task.
- Playwright tests tagged `@perf` run on the reference integrated-GPU laptop, not in default CI.
- This plan creates the spec's code only. It does not change `interfaces.md`; the only addition is the optional `PerturbationTemplate.visual` field.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.3", "2.7", "2.9", "2.11", "2.15", "2.17", "2.19", "2.21", "3.1", "4.4", "5.5", "5.7", "5.9", "6.1", "6.8", "7.1", "7.3"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.5", "2.8", "2.10", "2.12", "2.13", "2.14", "2.16", "2.18", "2.20", "3.2", "3.3", "3.4", "3.5", "3.6", "4.1", "4.5", "5.6", "5.8", "5.10", "6.2", "6.9", "7.2", "7.4"] },
    { "id": 3, "tasks": ["2.6", "3.7", "4.2", "4.3", "5.1", "6.3"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "5.11", "6.4", "6.5", "6.6", "6.7"] },
    { "id": 5, "tasks": ["5.12"] },
    { "id": 6, "tasks": ["8"] },
    { "id": 7, "tasks": ["9.1", "9.5", "9.6", "9.7", "10.1", "11.1", "12.1", "13.1", "13.3", "14.1", "14.2", "15.1", "16.1", "16.2", "16.3"] },
    { "id": 8, "tasks": ["9.2", "9.3", "9.4", "9.8", "10.2", "11.2", "13.2", "14.3", "15.2"] },
    { "id": 9, "tasks": ["9.9", "10.3", "10.4", "11.3", "14.4"] },
    { "id": 10, "tasks": ["10.5", "11.4", "11.5", "11.6", "11.7", "11.8", "13.4"] },
    { "id": 11, "tasks": ["13.5", "13.6", "13.7"] },
    { "id": 12, "tasks": ["17"] },
    { "id": 13, "tasks": ["18.1", "18.2"] },
    { "id": 14, "tasks": ["18.3"] },
    { "id": 15, "tasks": ["19.1"] },
    { "id": 16, "tasks": ["19.2", "20.1"] },
    { "id": 17, "tasks": ["20.2", "20.3", "20.4", "20.5"] },
    { "id": 18, "tasks": ["21"] }
  ]
}
```
