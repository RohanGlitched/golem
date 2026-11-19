# Requirements Document

## Introduction

`golem-studio-ui` covers `skeleton/src/ui`, published as `golem-spec/ui`. It is the shared studio that both apps (`apps/stagger`, `apps/candy`) mount on their `web/` page. The studio shows a robot made of unfired clay on a quiet floor, lets a visitor shove it, shows the requirements as an editable "tablet" of EARS sentences, and draws every falsifier trial as a translucent ghost. It also draws the measured failure boundary as an aura on the floor and shows the shrunk counterexample as a reel with replay.

The studio is the visible surface of the other modules. It consumes, and never changes, the contracts in `interfaces.md` (`RobotApp`, `Lexicon`, `CompiledRequirement`, `Scenario`, `Dimension`, `TrialSpec`, `TrialResult`, `Counterexample`, `Verdict`, `TrialPool`). It consumes the compiler diagnostics and extractor of `golem-ears`, the episode runner and pose frames of `golem-sim`, and the progress callback, `onResult` callback, `Verdict`, seed format and cancellation of `golem-falsify`. This spec may add fields to those shapes but renames or removes none.

The visual and interaction rules come from `.kiro/steering/design-language.md` ("Vltava clay at midnight") and are binding: tokens, type, layout, motion and wording. The studio uses plain three.js for the 3D stage, React 18 only for the tablet and controls, and no network access except static assets. All randomness inside the studio derives from a seeded PRNG.

Assumptions made in this document:

- Ghost playback needs the push arrow of each trial. A `PerturbationTemplate` may carry an optional field `visual` that maps its resolved values to a body name and a force vector in newtons. A template without `visual` produces ghosts without arrows. This is an added optional field, not a change to the shapes in `interfaces.md`.
- The falsifier's progress callback delivers scenarios and robustness values per Generation, and the pool's `onResult` callback delivers each `TrialResult` with `poses` when the studio asks for `record: 'poses'`. The studio pairs them by `TrialSpec`.
- The studio shows trials that the falsifier ran. A ghost run requested by "Summon 64 ghosts" is a falsifier run in which every trial is recorded with poses (`record: 'poses'`). The falsifier's Generation size is at most 64, so one Generation fills at most the 64 Ghost_Slots. Each Generation replaces the swarm, so the swarm shows the search converging generation by generation. The Aura, the Reel and the Verdict_Panel counters use every trial of the run, including trials beyond those the swarm shows.
- Poses memory stays bounded: the Run_Controller keeps the poses of the current Generation, the closest-call trial and the best counterexample, and drops the poses of every other result.
- The two apps' fonts (B612, B612 Mono, Gloock) are static assets bundled with the app and loaded from the same origin.
- Rendering performance targets apply to a mid-range laptop with integrated graphics, 1920×1080 viewport, one stage.

Out of scope: EARS parsing and monitors, MuJoCo loading and trial execution, search and shrinking, worker scheduling, the CLI and MCP server, the landing page and site documentation, and any robot-specific controller, MJCF or lexicon.

## Glossary

- **Studio**: The mounted UI that `mountStudio` creates inside a host element: Stage, Tablet, Reel, Verdict_Panel and Layout.
- **Studio_Handle**: The object `mountStudio` returns, with `dispose()` and read access to the current Studio state.
- **Host_Element**: The DOM element passed to `mountStudio`.
- **Stage**: The plain three.js view of the hero robot, ghosts, aura and floor.
- **Stage_Builder**: The component that builds three.js meshes from an `MjModel`.
- **Hero_Robot**: The single robot that simulates in real time on the main thread and that the visitor can shove.
- **Hero_Sim**: The main-thread MuJoCo simulation of the Hero_Robot, with its own `MjModel` and `MjData`.
- **Visual_Group**: The MuJoCo geom group number. The Stage draws geom group 2 only.
- **Clay_Material**: The shader material of the Hero_Robot: unfired clay colour from `--clay`, a single raking key light, a soft fill and subtle grain from shader noise.
- **Grain_Noise**: Procedural noise computed in the fragment shader. It uses no downloaded texture.
- **Floor**: The quiet ground plane of the Stage in the `--ground` colour.
- **Render_Scheduler**: The component that decides when a frame is drawn: on demand only.
- **Render_Reason**: One of `simulating`, `dragging`, `replaying`, `ghosts-running`, `transition`. The Render_Scheduler draws frames only while at least one Render_Reason is active.
- **Pixel_Ratio_Cap**: The maximum `devicePixelRatio` the renderer uses, 1.5.
- **Orbit_Controls**: The camera control with damping: drag to orbit, wheel or pinch to zoom.
- **Visibility_Gate**: The combination of an `IntersectionObserver` on the Stage and the `document.visibilityState`. The Stage is paused when it is off-screen or the tab is hidden.
- **Fixed_Step_Accumulator**: The loop that adds elapsed wall time to an accumulator and runs `mj_step` in steps of the model timestep until the accumulator is below one step, so simulation and rendering are decoupled.
- **Step_Cap**: The maximum number of physics steps run in one frame, so a long frame cannot cause a spiral of catch-up work.
- **Shove**: The interaction in which a pointer press on a Hero_Robot body, then a drag, applies a spring force to that body.
- **Grab_Point**: The world point on a Hero_Robot body where the pointer ray first hit it, stored in the body's local frame.
- **Shove_Plane**: The vertical plane through the Grab_Point whose normal is the horizontal component of the camera's view direction.
- **Spring_Force**: The force `k × (target − grabPoint)` applied at the Grab_Point through `data.xfrc_applied`, where `target` is the pointer ray's intersection with the Shove_Plane.
- **Shove_Arrow**: The 3D arrow from the Grab_Point to the target with a live label in newtons.
- **Force_Cap**: The maximum Spring_Force magnitude, 400 N.
- **Key_Push**: The keyboard Shove: with the Stage focused, an arrow key applies 100 N for 0.2 s.
- **Ghost**: One translucent copy of the robot that replays the poses of one `TrialResult`.
- **Generation**: One batch of trials that the falsifier runs and reports together through one progress event. A Generation holds at most 64 trials.
- **Ghost_Swarm**: The set of up to 64 Ghosts of the current Generation, drawn with one `InstancedMesh` per robot geom. Each new Generation replaces the contents of the Ghost_Swarm.
- **Closest_Call_Trial**: The trial of the run with the lowest robustness seen so far, as in `Verdict.closest`.
- **Best_Counterexample**: The counterexample of the run that the falsifier currently reports, shrunk when shrinking has finished.
- **Ghost_Shader**: The translucent fresnel-rim material in the `--ghost` colour with additive blending and `depthWrite` off.
- **Ghost_Slot**: One of the 64 instance indices of the Ghost_Swarm.
- **Ghost_Clock**: The shared clock that plays all Ghosts in sync, starting at each trial's trigger time.
- **Pose_Frame**: One `nbody × 7` frame of a `TrialResult.poses` array, as defined in `golem-sim`.
- **Summoning**: The 400 ms animation in which Ghosts rise from the Floor.
- **Break_Fade**: The animation in which a Ghost with negative robustness turns `--break` at its worst-margin time and fades out over 600 ms.
- **Survivor**: A Ghost whose trial robustness is at least zero. It stays pale for the rest of its run.
- **Push_Arrow**: The thin arrow drawn on a Ghost at its trigger time, from the `visual` field of the matched perturbation template.
- **Aura**: The floor decal under the Hero_Robot that shows the measured force boundary per direction.
- **Direction_Bin**: One of 36 equal 10° sectors of the full circle of push directions, bin `i` covering `[i·10°, (i+1)·10°)`.
- **Held_Force**: The largest force among trials in a Direction_Bin whose robustness was at least zero.
- **Broke_Force**: The smallest force among trials in a Direction_Bin whose robustness was below zero.
- **Boundary_Force**: For a Direction_Bin, the Broke_Force if any trial broke, otherwise the Held_Force, otherwise unknown.
- **Aura_Summary**: The accessible text that names the weakest direction and its Boundary_Force.
- **Weakest_Direction**: The Direction_Bin with the smallest Broke_Force. When several have the same value, the one with the lowest index.
- **Aura_Source**: The requirement line whose trials feed the Aura: the selected line, when it has a force dimension and a direction dimension.
- **Tablet**: The React 18 panel that lists the app's requirements as sentences.
- **Requirement_Line**: One EARS criterion in the Tablet, with its ID, its text, its status and its controls.
- **EARS_Keyword**: One of WHEN, WHILE, IF, THEN, WHERE, THE, SHALL, set in the keyword style of `design-language.md`.
- **Quantity_Control**: The control that stands for one quantity in a sentence (`200 N`, `3 s`). The user drags it, steps it with the keyboard, or types a value.
- **Scrub**: A horizontal pointer drag on a Quantity_Control that changes its value.
- **Quantity_Span**: The source range of a quantity token in the line text, from the `golem-ears` tokenizer.
- **Line_Editor**: The text field in which a user edits one Requirement_Line.
- **Diagnostic**: The `golem-ears` Diagnostic with `kind`, `severity`, `message`, `line`, `column`, offsets and optional `suggestion`.
- **Line_Status**: One of `untested`, `running`, `held`, `broken`, `error`.
- **Margin_Text**: The robustness value with its unit, for example `0.12 m`.
- **Counterexample_Summary**: The one-line text for a broken line, for example "falls from 168 N at 135 deg, 62% into the stride", built from the shrunk scenario and the dimension kinds.
- **Fracture**: The hairline crack drawn through a broken Requirement_Line.
- **Run_Controller**: The component that owns one falsifier run per Requirement_Line: starts it, cancels it, and routes progress and results to the Stage, the Aura, the Tablet and the Verdict_Panel.
- **Run_Id**: The integer that identifies one run. Results with a stale Run_Id are ignored.
- **Reel**: The strip under the Stage for the selected broken line: filmstrip, summary and buttons.
- **Filmstrip**: Eight frames rendered from the replay of the shrunk counterexample, centred on its worst moment.
- **Replay**: The slow-motion playback of the counterexample on the main Stage with a scrubber.
- **Scrubber**: The range control that sets the Replay time.
- **Pinned_Seed_Store**: The browser `localStorage` store of pinned counterexamples for an app and requirement.
- **Share_Hash**: The URL hash that encodes the edited requirement text and the seed.
- **Verdict_Panel**: The panel that shows the numbers of a `Verdict`.
- **Tabular_Figures**: The B612 Mono numerals with equal advance width.
- **Number_Tween**: The short animation that moves a displayed number from its old value to its new value.
- **Theme_Tokens**: The CSS custom properties `--ground`, `--ground-2`, `--ink`, `--ink-2`, `--clay`, `--ghost`, `--break`, `--hold` with the dark and light values from `design-language.md`.
- **Live_Region**: An `aria-live` element that announces status changes to assistive technology.
- **Reduced_Motion**: The `prefers-reduced-motion: reduce` media setting.
- **Frame_Probe**: A `requestAnimationFrame` probe that records frame intervals, used in the Playwright performance test.
- **Seeded_PRNG**: A `mulberry32` or `splitmix32` generator.
- **Studio_Options**: The fourth argument of `mountStudio`: pool, seed, search budget, initial theme, and test hooks.

## Requirements

### Requirement 1: Mount the studio from one call

**User Story:** As an app author, I want one call that builds the whole studio, so that each app page is only a few lines.

#### Acceptance Criteria

1. WHEN `mountStudio(el, app, requirementsMarkdown, options)` is called, THE Studio SHALL render the Stage, Tablet, Reel and Verdict_Panel inside the Host_Element and return a Studio_Handle.
2. WHEN `mountStudio` is called, THE Studio SHALL extract the EARS criteria from `requirementsMarkdown` with the `golem-ears` extractor and compile each with the `RobotApp` lexicon.
3. THE Studio SHALL expose `mountStudio` and its option types through the `golem-spec/ui` entry point and SHALL take the `RobotApp` only through the `interfaces.md` contract.
4. WHEN `dispose()` is called on the Studio_Handle, THE Studio SHALL stop every loop, cancel active runs, remove its DOM and listeners, dispose every three.js geometry, material and renderer, and call `.delete()` on every MuJoCo handle it created.
5. WHEN `dispose()` is called twice, THE Studio SHALL complete the second call without error.
6. IF the Host_Element is not an HTMLElement, THEN THE Studio SHALL throw an error that states an element is required.
7. IF `requirementsMarkdown` holds no EARS criterion, THEN THE Studio SHALL mount with an empty Tablet that states "No requirements found: add lines such as 'WHEN …, THE robot SHALL …' to your requirements.md".
8. IF WebGL is not available, THEN THE Studio SHALL mount the Tablet, Reel and Verdict_Panel and SHALL show in the Stage area a message that states WebGL is required for the 3D view.
9. THE Studio SHALL read the pool, the Search_Seed and the search Budget from Studio_Options and SHALL use documented defaults when they are absent.
10. WHERE Studio_Options supplies a `TrialPool`, THE Studio SHALL use it and SHALL NOT close it on `dispose()`.

### Requirement 2: Build stage meshes from any MjModel

**User Story:** As an app author, I want the Stage to draw any MuJoCo model, so that a new robot needs no rendering code.

#### Acceptance Criteria

1. WHEN the Stage_Builder receives an `MjModel`, THE Stage_Builder SHALL create one three.js mesh for each geom whose group is 2.
2. THE Stage_Builder SHALL skip every geom whose group is not 2.
3. THE Stage_Builder SHALL support the geom types mesh, box, sphere, capsule, cylinder, ellipsoid and plane.
4. WHEN a geom is a box, sphere, capsule, cylinder or ellipsoid, THE Stage_Builder SHALL size the mesh from `geom_size` so that its extent in metres equals the MuJoCo definition of that primitive.
5. WHEN a geom is a mesh, THE Stage_Builder SHALL build a `BufferGeometry` from the model's mesh vertex, face and normal arrays for that geom's `geom_dataid`.
6. WHEN a geom is a plane, THE Stage_Builder SHALL build the Floor from it, with an extent of at least the larger of its declared size and 20 m, and with a fade to `--ground` at its edge.
7. THE Stage_Builder SHALL attach each mesh to a group keyed by the geom's body id, so that a body pose moves all of its geoms.
8. WHEN a pose is applied to a body group, THE Stage_Builder SHALL set the group position from `xpos` and the group quaternion from `xquat` in the order qw, qx, qy, qz, converted to three.js `x, y, z, w`.
9. THE Stage_Builder SHALL apply each geom's local position and orientation relative to its body from `geom_pos` and `geom_quat`.
10. THE Stage_Builder SHALL read model arrays once at build time and SHALL NOT keep a view into WASM memory after the build returns.
11. IF a geom has an unsupported type, THEN THE Stage_Builder SHALL skip it and SHALL report one warning that names the geom id and the type.
12. IF a mesh geom refers to a mesh with zero faces, THEN THE Stage_Builder SHALL skip it and SHALL report one warning that names the geom id.
13. THE Stage_Builder SHALL expose the number of meshes it created and the ids of skipped geoms, so that tests can read them.
14. THE Stage_Builder SHALL return the same mesh count and the same geometry data for the same `MjModel` content (determinism).

### Requirement 3: Clay material, lighting and quiet floor

**User Story:** As a visitor, I want the robot to look like unfired clay under one lamp, so that the stage is the one bold thing on the page.

#### Acceptance Criteria

1. THE Clay_Material SHALL colour the Hero_Robot from the current `--clay` token.
2. THE Stage SHALL light the Hero_Robot with one directional key light at a raking angle of at most 20° above the Floor, and one soft fill light whose intensity is at most 35% of the key light.
3. THE Clay_Material SHALL add subtle grain by Grain_Noise computed in the fragment shader, with an amplitude of at most 6% of the lit colour.
4. THE Clay_Material SHALL use no texture image and the Studio SHALL download no texture.
5. THE Floor SHALL show no grid, reflection or texture, and SHALL use the `--ground` colour.
6. WHEN the theme changes, THE Stage SHALL update the Clay_Material, the Floor colour and the background to the new Theme_Tokens within one frame and SHALL request one render.
7. THE Stage SHALL use a Stage background equal to `--ground` and no gradient.
8. THE Clay_Material SHALL compute the same colour for the same inputs on each frame, so that grain does not flicker while the robot is at rest.

### Requirement 4: Camera orbit with damping

**User Story:** As a visitor, I want to orbit the camera smoothly, so that I can look at the robot from any side.

#### Acceptance Criteria

1. THE Orbit_Controls SHALL orbit the camera around a target near the Hero_Robot's base on pointer drag that does not start on a Hero_Robot body.
2. THE Orbit_Controls SHALL apply damping, so that the camera continues to move briefly after the pointer is released and then stops.
3. THE Orbit_Controls SHALL limit the polar angle so that the camera stays above the Floor.
4. THE Orbit_Controls SHALL limit zoom distance to a range set from the model's bounding radius.
5. WHILE the camera is moving by damping after a release, THE Render_Scheduler SHALL keep the Render_Reason `transition` active until the movement is below 0.1 mm of camera travel per frame, and then SHALL release it.
6. WHEN a pointer press starts on a Hero_Robot body, THE Studio SHALL start a Shove and SHALL NOT start an orbit.
7. THE Orbit_Controls SHALL support touch drag to orbit and two-finger pinch to zoom.
8. WHEN the Stage is focused and the user presses Shift with an arrow key, THE Orbit_Controls SHALL rotate the camera by 5° per key press for keyboard orbiting.

### Requirement 5: Render on demand, pixel ratio cap and visibility pause

**User Story:** As a visitor on a laptop, I want the studio to draw only when something moves, so that the page stays cool and fast.

#### Acceptance Criteria

1. WHILE no Render_Reason is active, THE Render_Scheduler SHALL draw no frame and SHALL hold no pending `requestAnimationFrame` callback.
2. WHEN a Render_Reason becomes active, THE Render_Scheduler SHALL schedule a frame with `requestAnimationFrame` within the same task.
3. THE Render_Scheduler SHALL draw at most one frame per `requestAnimationFrame` callback.
4. WHEN the last active Render_Reason is released, THE Render_Scheduler SHALL draw one final frame and then stop scheduling.
5. THE Stage SHALL set the renderer pixel ratio to the smaller of `window.devicePixelRatio` and the Pixel_Ratio_Cap.
6. WHEN the Stage element is not intersecting the viewport according to the Visibility_Gate, THE Render_Scheduler SHALL stop drawing frames and THE Hero_Sim SHALL pause.
7. WHEN `document.visibilityState` is `hidden`, THE Render_Scheduler SHALL stop drawing frames and THE Hero_Sim SHALL pause.
8. WHEN the Stage becomes visible again, THE Render_Scheduler SHALL resume the Render_Reasons that were active and THE Hero_Sim SHALL resume without running the physics steps for the hidden time.
9. WHEN the Stage element is resized, THE Stage SHALL update the renderer size and the camera aspect and SHALL request one render.
10. WHEN a ghost run is in progress while the Stage is hidden, THE Run_Controller SHALL keep receiving results and SHALL buffer them for playback without drawing.
11. THE Studio SHALL draw no frame when the page is idle after a verdict is shown and the Ghost_Swarm has finished fading.

### Requirement 6: Live simulation with a fixed-step accumulator

**User Story:** As a visitor, I want the robot to move in real time whatever my frame rate, so that a shove behaves the same on any machine.

#### Acceptance Criteria

1. WHILE the Hero_Sim is running, THE Fixed_Step_Accumulator SHALL add the elapsed wall time of each frame to an accumulator and SHALL run one physics step of the model timestep for each full timestep held in the accumulator.
2. THE Fixed_Step_Accumulator SHALL leave a remainder below one timestep in the accumulator after each frame.
3. THE Fixed_Step_Accumulator SHALL run no more than the Step_Cap in one frame and SHALL discard the excess accumulated time above the cap.
4. THE Fixed_Step_Accumulator SHALL call the controller once per `app.controlDt` of simulated time, using the same decimation rule as `golem-sim`.
5. FOR ALL sequences of frame durations with the same total, THE Fixed_Step_Accumulator SHALL run the same number of physics steps to within one step, when the Step_Cap is not reached (decoupling property).
6. THE Hero_Sim SHALL allocate no object, array or closure inside the physics step loop and SHALL reuse its typed arrays and views.
7. THE Hero_Sim SHALL create its `MjData` once, read `qpos`, `qvel`, `xpos`, `xquat` and `xfrc_applied` through views obtained once, and re-read the views when the `view.buffer` identity changes.
8. THE Hero_Sim SHALL zero `data.xfrc_applied` before applying forces in each physics step.
9. THE Hero_Sim SHALL use the same `app.makeController` and `app.initState` as the trials, with a Seeded_PRNG created from the Studio seed.
10. THE Hero_Sim SHALL keep the Render_Reason `simulating` active while the Hero_Sim is running and the Stage is visible.
11. WHEN the Hero_Sim state is non-finite after a step, THE Hero_Sim SHALL reset to the initial state and SHALL announce "The simulation diverged and was reset" in the Live_Region.
12. WHEN `dispose()` is called, THE Hero_Sim SHALL call `.delete()` on its `MjData` and its `MjModel` exactly once.
13. THE Hero_Sim SHALL provide a "Reset" action that restores the initial state and the controller, and SHALL answer it within 100 ms.

### Requirement 7: Shove with pointer and touch

**User Story:** As a visitor, I want to grab the robot and pull it, so that I can feel how hard a push it can take.

#### Acceptance Criteria

1. WHEN a pointer press hits a Hero_Robot body, THE Studio SHALL record the body and the Grab_Point in the body's local frame and SHALL start a Shove.
2. WHILE a Shove is active, THE Studio SHALL compute the target as the intersection of the pointer ray with the Shove_Plane on every pointer move.
3. WHILE a Shove is active, THE Hero_Sim SHALL apply the Spring_Force at the Grab_Point through `data.xfrc_applied` at every physics step.
4. THE Studio SHALL limit the Spring_Force magnitude to the Force_Cap.
5. WHILE a Shove is active, THE Studio SHALL draw the Shove_Arrow from the Grab_Point to the target and SHALL show a label with the current Spring_Force magnitude in newtons, rounded to the nearest 1 N.
6. WHEN the pointer is released or cancelled, THE Studio SHALL remove the Spring_Force, the Shove_Arrow and the label within one frame.
7. IF the pointer ray does not intersect the Shove_Plane, THEN THE Studio SHALL keep the previous target.
8. WHILE a Shove is active, THE Render_Scheduler SHALL keep the Render_Reason `dragging` active.
9. WHEN a touch starts on a Hero_Robot body, THE Studio SHALL start a Shove with the touch point, SHALL prevent the page from scrolling for that touch, and SHALL end the Shove on touch end or cancel.
10. WHEN a touch starts outside a Hero_Robot body, THE Studio SHALL allow orbit or page scroll according to the Orbit_Controls rules and the layout.
11. THE Studio SHALL apply the Spring_Force with a constant stiffness `k` set in Studio_Options, with a documented default, so that force is proportional to the distance between the Grab_Point and the target below the Force_Cap.
12. FOR ALL Grab_Point and target pairs, THE Spring_Force vector SHALL point from the Grab_Point to the target and SHALL have a magnitude equal to the smaller of `k × distance` and the Force_Cap (spring property).
13. THE Shove_Arrow label SHALL use Tabular_Figures and SHALL be exposed to assistive technology through the Live_Region only on release, with the peak force of the Shove.
14. WHERE a second pointer is pressed during a Shove, THE Studio SHALL ignore the second pointer for the Shove.

### Requirement 8: Keyboard shove

**User Story:** As a keyboard user, I want a way to push the robot without a mouse, so that the main interaction is available to me.

#### Acceptance Criteria

1. THE Stage SHALL be focusable and SHALL show a visible focus ring when it has keyboard focus.
2. WHEN the Stage has focus and an arrow key is pressed without Shift, THE Studio SHALL apply a Key_Push of 100 N for 0.2 s on the Hero_Robot's primary push body, in the horizontal direction of the key relative to the camera view.
3. THE Studio SHALL draw the Key_Push with the same Shove_Arrow and the same live label in newtons as the pointer Shove for the duration of the Key_Push.
4. WHEN a Key_Push is active and another arrow key is pressed, THE Studio SHALL restart the Key_Push with the new direction.
5. THE Studio SHALL apply the Key_Push through `data.xfrc_applied` at every physics step during its 0.2 s of simulated time.
6. WHEN a Key_Push ends, THE Studio SHALL remove the arrow and the label and SHALL announce "Pushed 100 N toward the <direction>" in the Live_Region.
7. THE Studio SHALL derive the primary push body from `app` configuration in Studio_Options, with the body of the first perturbation template's `visual` field as default.
8. WHILE a Key_Push is active, THE Render_Scheduler SHALL keep the Render_Reason `dragging` active.
9. WHEN the user presses the Escape key while the Stage has focus, THE Studio SHALL cancel any active Shove or Key_Push.
10. THE Stage SHALL show, in text readable by assistive technology, "Arrow keys push the robot with 100 N for 0.2 s. Shift with arrow keys turns the camera".

### Requirement 9: Ghost swarm drawn with instancing

**User Story:** As a visitor, I want to see many trials at once, so that I can see how the robot behaves across the whole scenario space.

#### Acceptance Criteria

1. THE Ghost_Swarm SHALL hold at most 64 Ghosts.
2. THE Ghost_Swarm SHALL draw all Ghosts with one `InstancedMesh` per robot geom drawn by the Stage_Builder, each of capacity 64.
3. THE Ghost_Shader SHALL render a translucent fresnel rim in the current `--ghost` colour, with additive blending and `depthWrite` set to false.
4. THE Ghost_Shader SHALL read the per-instance state (colour mix, opacity, visibility) from instance attributes.
5. WHEN a Ghost_Slot has no active Ghost, THE Ghost_Swarm SHALL hide it by setting its instance opacity to zero and SHALL NOT draw it.
6. THE Ghost_Swarm SHALL set `InstancedMesh.count` to the highest active Ghost_Slot index plus one.
7. THE Ghost_Swarm SHALL write instance matrices into preallocated typed arrays and SHALL allocate no object per frame.
8. WHEN more than 64 results are supplied for one Generation, THE Ghost_Swarm SHALL accept the first 64 of that Generation in arrival order and SHALL ignore the rest of that Generation, and a Generation SHALL hold at most 64 trials.
9. WHEN the swarm is cleared, THE Ghost_Swarm SHALL hide every Ghost_Slot and SHALL release the Ghost state without disposing the shared geometry.
10. THE Ghost_Swarm SHALL give each Ghost the world transform of each body in the geom's body group, so that a Ghost is a full robot pose.
11. WHEN the theme changes, THE Ghost_Swarm SHALL update the `--ghost` colour uniform and SHALL request one render.
12. WHEN `dispose()` is called, THE Ghost_Swarm SHALL dispose every `InstancedMesh`, geometry and material it created.

### Requirement 10: Ghost playback from falsifier results

**User Story:** As a visitor, I want ghosts to appear generation by generation as the search runs, so that I watch the falsifier work.

#### Acceptance Criteria

1. WHEN the Run_Controller starts a ghost run, THE Run_Controller SHALL ask the pool for `record: 'poses'` for every trial of each Generation, with at most 64 trials in a Generation.
2. WHEN a `TrialResult` with `poses` arrives for the current Run_Id, THE Ghost_Swarm SHALL assign it to the next free Ghost_Slot of the current Generation, up to 64 Ghost_Slots per Generation.
3. WHEN a Generation's progress event arrives, THE Run_Controller SHALL replace the contents of the Ghost_Swarm, with the Ghosts of the previous Generation fading out and clearing as the new Generation is summoned, and SHALL start the Ghosts of the new Generation together with a shared Ghost_Clock start time.
4. THE Ghost_Clock SHALL play every Ghost at real time, so that Ghost time zero is the trial's trigger time.
5. THE Ghost_Swarm SHALL select the Pose_Frame of a Ghost at Ghost time `τ` as the frame with index `floor(τ × fps)`, clamped to the last frame.
6. THE Ghost_Swarm SHALL blend nothing between frames when Reduced_Motion is set, and SHALL otherwise interpolate position linearly and orientation by normalised linear interpolation between adjacent Pose_Frames.
7. WHEN a Ghost reaches the end of its frames, THE Ghost_Swarm SHALL hold its last frame until the Break_Fade or the end of the run.
8. WHILE any Ghost is playing, THE Render_Scheduler SHALL keep the Render_Reason `ghosts-running` active.
9. WHEN every Ghost has ended or faded and no run is active, THE Render_Scheduler SHALL release the Render_Reason `ghosts-running`.
10. WHEN the Run_Controller cancels a run, THE Ghost_Swarm SHALL clear every Ghost of that run within one frame.
11. WHEN a result carries a `Run_Id` that is not the current Run_Id, THE Run_Controller SHALL ignore it.
12. WHEN a `TrialResult` has no `poses`, THE Run_Controller SHALL count it as a trial and SHALL create no Ghost for it.
13. THE Ghost_Swarm SHALL use the model's `nbody` and the `poses.nbody` for validation, and IF they differ THEN THE Ghost_Swarm SHALL reject that result with a warning that names both values and SHALL create no Ghost.
14. FOR ALL pairs of Ghosts that start in the same Generation, THE Ghost_Swarm SHALL show them at equal Ghost times at every frame (sync property).
15. WHEN a `TrialResult` arrives for the current Run_Id, THE Aura and THE Verdict_Panel counters SHALL count it whether or not the Ghost_Swarm shows it, so that the Aura and the counters cover all trials of the run while the Ghost_Swarm shows only the current Generation.
16. THE Reel SHALL use all trials of the run to select its Closest_Call_Trial and Best_Counterexample, and not only the trials of the current Generation.
17. WHEN a Generation starts, THE Run_Controller SHALL drop the `poses` of the results of the previous Generation, except the `poses` of the Closest_Call_Trial and of the Best_Counterexample, so that poses memory stays bounded by one Generation plus those two trials.
18. FOR ALL runs, THE Aura trial total and the Verdict_Panel trial count SHALL equal the number of results received for the current Run_Id, and SHALL be at least the number of Ghosts shown (count property).

### Requirement 11: Ghost verdict colouring, fade and summoning

**User Story:** As a visitor, I want ghosts that break to turn red and fade, so that I can see failures at a glance.

#### Acceptance Criteria

1. WHEN a Ghost's Ghost time reaches the `worstAt` time of its result and its robustness is below zero, THE Ghost_Swarm SHALL set that Ghost's colour to the `--break` token.
2. WHEN a Ghost turns `--break`, THE Ghost_Swarm SHALL fade its opacity from its current value to zero over 600 ms and SHALL then hide it.
3. WHILE a Ghost's robustness is at least zero, THE Ghost_Swarm SHALL keep its colour as `--ghost` and SHALL keep it visible, paler than a running Ghost, until it ends.
4. WHEN a Ghost is created, THE Ghost_Swarm SHALL start the Summoning animation, in which the Ghost rises from the Floor to its pose height over 400 ms.
5. WHERE Reduced_Motion is set, THE Ghost_Swarm SHALL skip the Summoning rise and SHALL show the Ghost at its pose from its first frame.
6. WHERE Reduced_Motion is set, THE Ghost_Swarm SHALL play Ghosts by stepping through Pose_Frames and SHALL apply the colour change and the fade as a step to full state without animation.
7. THE Ghost_Swarm SHALL complete the Break_Fade for a Ghost within 600 ms plus one frame of the Ghost turning `--break`.
8. THE Ghost_Swarm SHALL give a Ghost for which robustness is `-Infinity` the `--break` colour at the divergence time recorded as `worstAt`.
9. FOR ALL Ghost robustness values, THE Ghost_Swarm SHALL choose the break state if and only if the robustness is below zero (colour property).
10. THE Ghost_Swarm SHALL answer a Summon action with a visible first Ghost within 100 ms of the first arriving result.

### Requirement 12: Push arrows on ghosts

**User Story:** As a visitor, I want to see where each ghost was pushed, so that the failures can be read as pushes and not as magic.

#### Acceptance Criteria

1. WHEN a Ghost reaches its trigger time, THE Ghost_Swarm SHALL show a thin Push_Arrow on that Ghost computed from the `visual` field of the matched perturbation template and the trial scenario.
2. THE Push_Arrow SHALL start at the force's body position in the Pose_Frame at the trigger time and SHALL point along the force direction.
3. THE Push_Arrow length SHALL be proportional to the force magnitude, with 0.3 m for 100 N, clamped to 0.05 m at the minimum and 0.9 m at the maximum.
4. THE Push_Arrow SHALL be drawn with one `InstancedMesh` of at most 64 instances and SHALL follow its Ghost's colour state.
5. WHEN the duration of the perturbation ends, THE Ghost_Swarm SHALL hide the Push_Arrow of that Ghost.
6. WHEN a Ghost fades out, THE Push_Arrow SHALL fade with it.
7. IF the matched perturbation template has no `visual` field, THEN THE Ghost_Swarm SHALL show no Push_Arrow for that Ghost.
8. FOR ALL scenarios, THE Push_Arrow direction SHALL equal the normalised force vector returned by `visual`, and its length SHALL be within the clamp range (arrow property).

### Requirement 13: Aura data from trial results

**User Story:** As a robotics engineer, I want the measured failure boundary kept per direction, so that I see where the robot is weakest.

#### Acceptance Criteria

1. THE Aura SHALL keep 36 Direction_Bins covering the circle in equal 10° sectors.
2. WHEN a trial result arrives for the Aura_Source, THE Aura SHALL compute its Direction_Bin from the direction dimension of its scenario, wrapped into `[0, 2π)`, as `floor(angle / (2π / 36))`, clamped to 35.
3. WHEN a trial result with robustness at least zero arrives, THE Aura SHALL set the Held_Force of its bin to the larger of the stored value and the trial's force.
4. WHEN a trial result with robustness below zero arrives, THE Aura SHALL set the Broke_Force of its bin to the smaller of the stored value and the trial's force, and SHALL record one break tick at the trial's direction and force.
5. THE Aura SHALL treat a trial with robustness exactly zero as held, in line with `golem-falsify`.
6. THE Aura SHALL ignore results with `NaN` robustness and SHALL count them as ignored in its state.
7. THE Aura SHALL reset its bins and ticks when the Aura_Source changes or when the user edits the Aura_Source line.
8. THE Aura SHALL be a pure function of the multiset of trial results, so that the same results in any arrival order give the same bins (order-independence property).
9. FOR ALL result sequences, THE Aura SHALL keep every Direction_Bin's Held_Force at most the maximum held force of that bin's results and its Broke_Force at least the minimum broken force of that bin's results (bin invariant).
10. FOR ALL result sequences, THE Aura SHALL give an angle `a` and the angle `a + 2π` the same bin (wrap property).
11. WHEN the Aura_Source has no force dimension or no direction dimension, THE Studio SHALL show no Aura and SHALL show in the Aura_Summary text "This requirement has no direction and force to map".
12. THE Aura SHALL read the force in newtons from the dimension of kind `force` and the direction from the dimension of kind `angle` of the Aura_Source's `space`.

### Requirement 14: Aura rendering and text summary

**User Story:** As a visitor, I want the floor to show where the robot holds and where it breaks, and as a screen-reader user I want the same facts in words.

#### Acceptance Criteria

1. THE Aura SHALL draw a soft region in the `--hold` colour under the Hero_Robot whose radius in each Direction_Bin is proportional to that bin's Boundary_Force, scaled so that the largest force in the search space maps to 1.2 m radius.
2. THE Aura SHALL draw a short tick in the `--break` colour at the direction and the force radius of each recorded break.
3. THE Aura SHALL draw bins with unknown Boundary_Force at zero radius.
4. THE Aura SHALL smooth the region outline between adjacent bins without exceeding the larger of their radii.
5. WHEN a trial result arrives, THE Aura SHALL update the drawing within one frame and SHALL request one render.
6. THE Aura SHALL draw with no glow and no drop shadow, and SHALL use `--hold` and `--break` only.
7. THE Aura_Summary SHALL state the Weakest_Direction in degrees and its Boundary_Force in newtons, for example "Weakest direction 135 deg: breaks at 168 N".
8. WHEN no bin has a Broke_Force, THE Aura_Summary SHALL state the largest Held_Force and its direction, for example "No break found. Strongest push held: 200 N at 40 deg" and SHALL state the number of trials.
9. WHEN no result has arrived, THE Aura_Summary SHALL state "No trials yet".
10. THE Aura_Summary SHALL be a visible text line in the Verdict_Panel and SHALL be updated in the Live_Region only when a run ends.
11. THE Aura SHALL not use red and green as the only difference between held and broken, and SHALL differ by shape (region against ticks) as well as colour.
12. FOR ALL Aura states with at least one broken bin, THE Aura_Summary SHALL name the bin with the smallest Broke_Force, taking the lowest bin index on ties (summary property).

### Requirement 15: Tablet shows requirements as sentences

**User Story:** As a robotics engineer, I want the spec shown as readable sentences, so that the spec is the interface.

#### Acceptance Criteria

1. THE Tablet SHALL list one Requirement_Line for each extracted EARS criterion, in file order, with its ID.
2. THE Tablet SHALL set each EARS_Keyword in capitals at 0.85em with letter-spacing 0.04em and SHALL set no other word in capitals.
3. THE Tablet SHALL set all Tablet text in B612 and all changing numbers in B612 Mono with Tabular_Figures.
4. THE Tablet SHALL use sentence case for its buttons and labels and SHALL use no eyebrow labels.
5. THE Tablet SHALL use `--ground-2` as the surface colour, a 1 px border of `--clay` at 35% opacity, a 2 px radius for controls and no drop shadow.
6. THE Tablet SHALL be a 380 px wide column at viewport widths of 1024 px or more.
7. WHEN a requirement line cannot be compiled, THE Tablet SHALL still list it with its text and its Diagnostics.
8. WHEN a requirement line is selected, THE Tablet SHALL mark it with `aria-current="true"` and SHALL show the selection with a 2 px `--clay` rule at the left edge.
9. THE Tablet SHALL list a heading for each requirement group taken from the Kiro requirement heading text when present.
10. WHEN the user clicks a Requirement_Line or presses Enter on it, THE Tablet SHALL select it and SHALL make it the Aura_Source and the Reel subject when applicable.
11. FOR ALL compiled lines, THE Tablet SHALL display text whose concatenation of keyword, quantity and plain segments equals the source line text (display property).

### Requirement 16: Scrubbable quantity controls

**User Story:** As a robotics engineer, I want every number in a sentence to be a control, so that I can change a value and see the answer.

#### Acceptance Criteria

1. THE Tablet SHALL render every quantity token in a Requirement_Line as a Quantity_Control, using the Quantity_Span positions from the tokenizer.
2. WHEN the user drags horizontally on a Quantity_Control, THE Quantity_Control SHALL change its value in proportion to the horizontal pointer movement, at a step per 4 px set by its unit and kind.
3. WHEN the user presses ArrowUp or ArrowRight with a Quantity_Control focused, THE Quantity_Control SHALL increase its value by one step.
4. WHEN the user presses ArrowDown or ArrowLeft with a Quantity_Control focused, THE Quantity_Control SHALL decrease its value by one step.
5. WHEN the user holds Shift while stepping or dragging, THE Quantity_Control SHALL change the value by ten times the step, and WHEN the user holds Alt it SHALL change it by one tenth of the step.
6. WHEN the user types a value into a Quantity_Control and commits it with Enter or blur, THE Quantity_Control SHALL parse the value with the `golem-ears` quantity parser and the original unit when none is typed.
7. IF a typed value has an unknown unit or a unit of another kind, THEN THE Quantity_Control SHALL keep the previous value and show an inline message that names the expected unit kind, for example "Write a force: 200 N, not 200 s".
8. THE Quantity_Control SHALL set `role="spinbutton"`, `aria-valuenow` to the current value in the displayed unit, `aria-valuemin` and `aria-valuemax` to the allowed range, `aria-valuetext` to the value with its unit, and an `aria-label` that names the quantity.
9. THE Quantity_Control SHALL keep each value within the allowed range of its kind: at least zero for force, duration, length, speed and mass, between 0 and 100 for percent ratios, and within the Dimension limits where the matched template declares them.
10. THE Quantity_Control SHALL preserve the unit as written, and SHALL step in the displayed unit and not in SI.
11. THE Quantity_Control SHALL round each stepped value to the decimal places of its step, so that repeated stepping does not show binary noise such as 0.30000000000000004.
12. WHEN a Quantity_Control value changes, THE Tablet SHALL rewrite only the Quantity_Span of the line text, SHALL recompile the line, and SHALL start a new run within 100 ms of the last change after debouncing.
13. THE Quantity_Control SHALL show a visible focus ring, SHALL have a pointer target at least 24 px high, and SHALL set `touch-action: none` during a drag on touch devices.
14. WHILE a Quantity_Control is being dragged, THE Tablet SHALL keep the displayed number updated at every pointer move without waiting for the run.
15. FOR ALL values `v` inside the range and steps `s`, stepping up then down by one step SHALL return `v` within rounding to the step's decimal places (step round-trip property).
16. FOR ALL generated pointer drags, THE Quantity_Control SHALL return a value within the allowed range (clamp property).
17. FOR ALL generated lines and quantity edits, rewriting a Quantity_Span SHALL leave all other characters of the line unchanged (rewrite property).
18. WHEN the control shows a value from the same quantity, THE Quantity_Control SHALL use the number format `text` of the quantity as the written spelling, and SHALL print the new value in the same unit.

### Requirement 17: Line editing and inline diagnostics

**User Story:** As a robotics engineer, I want to edit a sentence directly and see what is wrong where it is wrong, so that I can fix it without reading the compiler.

#### Acceptance Criteria

1. WHEN the user activates "Edit line" on a Requirement_Line, THE Tablet SHALL show a Line_Editor text field holding the line text.
2. WHEN the text in the Line_Editor changes, THE Tablet SHALL recompile the line with the `golem-ears` compiler within 100 ms after the last keystroke.
3. WHEN the compile returns Diagnostics, THE Tablet SHALL underline each Diagnostic at its column and offsets in the Line_Editor with a wavy underline in the `--break` colour.
4. THE Tablet SHALL list each Diagnostic's message below the line, with its suggestion when present, in the words of `golem-ears` and without themed wording.
5. THE Tablet SHALL associate each Diagnostic message with the Line_Editor through `aria-describedby` and SHALL set `aria-invalid="true"` while an error Diagnostic exists.
6. WHEN the Diagnostic has a suggestion, THE Tablet SHALL offer a button "Use suggestion" that replaces the line with the suggestion text.
7. WHILE a line has an error Diagnostic, THE Run_Controller SHALL run no search for that line and THE Tablet SHALL show Line_Status `error`.
8. WHEN the user commits the edit with Enter or blur and the line compiles, THE Tablet SHALL replace the line text, SHALL update the Share_Hash and SHALL start a run.
9. WHEN the user presses Escape in the Line_Editor, THE Tablet SHALL restore the previous text and close the editor.
10. WHEN the user edits a line, THE Studio SHALL NOT write to the `requirements.md` file or any other file.
11. THE Tablet SHALL keep the underline positions aligned with the Diagnostic `column` values, counted in UTF-16 code units from the start of the line.
12. WHEN several Diagnostics apply, THE Tablet SHALL underline each in source order without overlap and SHALL show every message.
13. FOR ALL generated Diagnostics on a line, THE Tablet underline range SHALL lie inside the line text (range property).

### Requirement 18: Per-line status

**User Story:** As a robotics engineer, I want each line to say whether it has been tested, is running, held or broke, so that I read the state of the spec at a glance.

#### Acceptance Criteria

1. WHILE a line has no run result, THE Tablet SHALL show Line_Status `untested` with the text "Not tested yet".
2. WHILE a run for a line is in progress, THE Tablet SHALL show Line_Status `running` with the live trial count, for example "Running: 37 trials".
3. WHEN a run for a line ends with `Verdict.status` `held`, THE Tablet SHALL show Line_Status `held` in the `--hold` colour with the Margin_Text of `Verdict.closest.robustness` and the trial count, for example "Held: closest call 0.12 m in 480 trials".
4. WHEN a run for a line ends with `Verdict.status` `broken`, THE Tablet SHALL show Line_Status `broken` in the `--break` colour with the Counterexample_Summary.
5. WHEN a run for a line ends with `Verdict.status` `error`, THE Tablet SHALL show Line_Status `error` with the error message and no margin.
6. THE Counterexample_Summary SHALL name each dimension of the shrunk scenario that has severity `up` or `down` or that is a wrap dimension, with its value in the unit of its kind, for example "falls from 168 N at 135 deg, 62% into the stride".
7. THE Counterexample_Summary SHALL give force in N, duration in s, length in m, speed in m/s, mass in kg, angle in deg and phase and ratio in %, each rounded to three significant figures.
8. WHERE the counterexample classification is `seed-sensitive`, THE Tablet SHALL add "depends on the seed" to the Counterexample_Summary.
9. THE Tablet SHALL draw a Fracture through each Requirement_Line whose Line_Status is `broken`, as a hairline in the `--break` colour, and SHALL draw nothing extra for a line that held.
10. THE Tablet SHALL not use a check mark, confetti or a green fill for a held line.
11. WHEN a line's status changes, THE Studio SHALL announce the new status in the Live_Region with the line ID and its summary.
12. THE Tablet SHALL never show the word "proved" or "verified" for a held line, and SHALL state a held line as "no counterexample found in N trials".
13. THE Tablet SHALL show the Margin_Text and the trial count in Tabular_Figures.
14. FOR ALL Verdicts, THE Tablet SHALL show Line_Status `broken` if and only if `Verdict.status` is `'broken'` (status property).
15. FOR ALL Verdicts with `closest.robustness` and a unit, THE Margin_Text SHALL contain the unit, and the displayed value SHALL equal the robustness rounded to three significant figures.
16. THE Tablet SHALL show the Line_Status as text and shape and not by colour alone.

### Requirement 19: Summon buttons and run orchestration

**User Story:** As a visitor, I want to summon the ghosts for a line or for every line with one button, so that I see the test happen.

#### Acceptance Criteria

1. THE Tablet SHALL show a button "Summon 64 ghosts" on each Requirement_Line that compiles without error.
2. THE Tablet SHALL show one button "Summon 64 ghosts for every line" for all compilable lines.
3. WHEN the user activates a line's button, THE Run_Controller SHALL cancel any active run for that line, create a new Run_Id and start a falsifier run with the pool, the Search_Seed and the Budget from Studio_Options.
4. WHEN the user activates the button for every line, THE Run_Controller SHALL run the lines one after another in file order and SHALL show Ghosts of the line that is running.
5. WHEN a line changes while its run is active, THE Run_Controller SHALL cancel that run through the AbortSignal and SHALL start a new run with a new Run_Id.
6. WHEN a run is cancelled, THE Run_Controller SHALL keep the previous verdict visible, marked "stale" until the new run reports.
7. WHEN a progress event arrives, THE Run_Controller SHALL update the line's trial count, the Verdict_Panel counters and the Aura in the same frame.
8. WHEN a run completes, THE Run_Controller SHALL store the `Verdict`, SHALL set the Aura_Summary and SHALL, for a broken verdict, store the shrunk counterexample for the Reel.
9. IF the pool rejects with an error other than `AbortError`, THEN THE Run_Controller SHALL set the line's status to `error` with the error message and SHALL announce it.
10. IF the pool rejects with `AbortError`, THEN THE Run_Controller SHALL show no error.
11. THE Run_Controller SHALL run no more than one falsifier run at a time on the same pool.
12. THE button's label SHALL be a verb phrase that says what happens, and WHILE a run is active THE button SHALL change to "Stop the run" and SHALL cancel the run on activation.
13. WHEN the Studio loads, THE Run_Controller SHALL start no run until the user activates a Summon button, except where Studio_Options sets `autorun` to true.
14. WHEN the user activates a Summon button, THE Studio SHALL show the first Ghost or the running status within 100 ms.
15. THE Run_Controller SHALL pin the Run_Id to every callback it passes to the falsifier and the pool, so that a stale callback cannot change current state.
16. THE Run_Controller SHALL re-run pinned seeds of the app's requirement first, through the falsifier's Phase 0, using the browser Pinned_Seed_Store as the seed source.

### Requirement 20: Counterexample reel

**User Story:** As a robotics engineer, I want a short strip of frames around the failure, so that I see what broke before I replay it.

#### Acceptance Criteria

1. WHEN a broken line is selected and its shrunk counterexample is known, THE Reel SHALL show a Filmstrip of eight frames.
2. THE Reel SHALL choose the eight frames at equal time spacing around the counterexample's worst moment, from `worstAt − 0.35 s` to `worstAt + 0.35 s`, clamped to the available frames.
3. THE Reel SHALL render each Filmstrip frame from the replay poses of the counterexample, recorded by one pool trial of the shrunk scenario with `record: 'poses'`.
4. THE Reel SHALL render all Filmstrip frames from one offscreen render target of the Stage renderer and SHALL create no second WebGL context.
5. THE Reel SHALL label each frame with its time relative to the trigger in seconds, in Tabular_Figures, and SHALL mark the worst frame.
6. THE Reel SHALL show the Counterexample_Summary and the Classification (`robust` or `seed-sensitive`).
7. THE Reel SHALL show buttons "Replay the fall", "Copy seed" and "Pin this seed".
8. WHEN no broken line is selected, THE Reel SHALL show a short message "No counterexample selected. A broken line shows its failure here."
9. WHEN the counterexample's replay trial fails to run, THE Reel SHALL show the error message and SHALL keep the summary and the buttons for "Copy seed" and "Pin this seed" active.
10. THE Reel SHALL render the Filmstrip without moving the main Stage camera.
11. WHEN the selected line changes, THE Reel SHALL update its content within 100 ms and SHALL cancel any pending replay trial for the previous line.
12. THE Reel SHALL not use the word "Replay" as a button label alone, and SHALL use the verb phrase "Replay the fall" for a falling robot and "Replay the failure" for a requirement that is not about falling, according to the lexicon predicate's `unit`, with "Replay the failure" as the default.
13. THE Reel SHALL show the frames in a horizontally scrollable strip on narrow viewports, and SHALL cause no sideways scroll of the page.
14. THE Reel frame images SHALL have text alternatives that give the time and the robot state, for example "Frame at 0.35 s after the push: pelvis 0.31 m above the floor".

### Requirement 21: Replay with slow motion and scrubber

**User Story:** As a robotics engineer, I want to replay the failure slowly on the main stage, so that I can see how it went wrong.

#### Acceptance Criteria

1. WHEN the user activates "Replay the fall", THE Studio SHALL run the replay poses on the Hero_Robot's body groups on the main Stage at 0.25 times real time.
2. WHILE a Replay is active, THE Hero_Sim SHALL pause and THE Render_Scheduler SHALL keep the Render_Reason `replaying` active.
3. THE Studio SHALL show a Scrubber with `role="slider"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow` and `aria-valuetext` in seconds relative to the trigger.
4. WHEN the user moves the Scrubber, THE Studio SHALL show the Pose_Frame at that time and SHALL pause the Replay.
5. WHEN the user presses ArrowLeft or ArrowRight with the Scrubber focused, THE Scrubber SHALL step by one Pose_Frame.
6. THE Studio SHALL show Replay controls "Pause", "Play" and "Back to live", with the visible label that matches the state.
7. WHEN the user activates "Back to live", THE Studio SHALL restore the Hero_Sim state to the state before the Replay and SHALL resume the simulation.
8. WHERE Reduced_Motion is set, THE Replay SHALL step frame by frame on each press of "Next frame" and SHALL NOT advance by itself.
9. WHEN the Replay reaches its last frame, THE Studio SHALL stop at that frame and SHALL show "Play" for restarting.
10. THE Studio SHALL show a label with the current Replay time in Tabular_Figures, rounded to 0.01 s.
11. THE Studio SHALL show the Push_Arrow of the counterexample while the Replay time is inside the perturbation window.
12. THE Scrubber SHALL show a `--break` tick at the worst-margin time.
13. WHEN the Hero_Robot's replay pose is applied, THE Studio SHALL use the same Pose_Frame to transform conversion as the Ghost_Swarm.

### Requirement 22: Copy seed, pin seed and shareable URL

**User Story:** As a robotics engineer, I want to copy a failure, pin it for later and share it by link, so that others can reproduce it.

#### Acceptance Criteria

1. WHEN the user activates "Copy seed", THE Reel SHALL write to the clipboard the JSON of the `Counterexample` (`reqId`, `scenario`, `seed`, `robustness`, `shrunk`, `foundAfter`) with 2-space indentation and a stable key order.
2. IF the clipboard is not available or writing fails, THEN THE Reel SHALL show the JSON in a selectable text field and SHALL announce "Copy failed: the seed is shown below, select it to copy".
3. WHEN the user activates "Pin this seed", THE Pinned_Seed_Store SHALL save the `Counterexample` in `localStorage` under a key from the app id and the requirement id.
4. WHEN a counterexample equal to a stored one is pinned, THE Pinned_Seed_Store SHALL store it once, using the equality rule of `golem-falsify` (same `reqId`, same `seed`, equal values for every dimension name).
5. WHEN pinned seeds exist for the line, THE Reel SHALL list them with their summaries and a button "Remove pin" for each.
6. IF `localStorage` is not available or full, THEN THE Pinned_Seed_Store SHALL keep the pins in memory for the session and SHALL announce "Pins can't be saved in this browser and will be lost on reload".
7. WHEN the Pinned_Seed_Store is read and its content is not valid JSON or has entries that do not match `Counterexample`, THE Pinned_Seed_Store SHALL ignore the invalid entries, keep the valid ones and show one warning that states the number ignored.
8. THE Share_Hash SHALL encode the text of every edited requirement line, each with its ID, and the seed of the selected counterexample if any, in the URL fragment as a compact URL-safe string.
9. WHEN an edit changes a line or a counterexample is selected, THE Studio SHALL update the Share_Hash with `history.replaceState` and SHALL NOT add a history entry.
10. WHEN the Studio loads with a valid Share_Hash, THE Studio SHALL apply the edited lines to the matching IDs and SHALL select the counterexample of the seed.
11. IF the Share_Hash is malformed or names an unknown requirement ID, THEN THE Studio SHALL ignore the invalid part, apply the valid parts and show a message that states what was ignored.
12. THE Share_Hash SHALL be limited to 4000 characters, and IF the encoding is longer THEN THE Studio SHALL omit the lines that match the original `requirementsMarkdown` first, and then SHALL show a message that states the link is too long.
13. FOR ALL generated sets of requirement lines and seeds, decoding the encoding of the Share_Hash SHALL return an equal set (round-trip property).
14. FOR ALL generated `Counterexample` values, parsing the "Copy seed" JSON SHALL return an equal `Counterexample` (round-trip property).
15. THE Studio SHALL make no network request with the Share_Hash and SHALL parse it locally.
16. THE Pinned_Seed_Store SHALL read pins on load, and pins SHALL be passed to the falsifier as Phase 0 seeds for their requirement.

### Requirement 23: Verdict panel with animated tabular numbers

**User Story:** As a robotics engineer, I want the numbers of a run in one place, so that I can state what was searched and what was found.

#### Acceptance Criteria

1. THE Verdict_Panel SHALL show the trial count, the random trials, the guided trials, the closest call with its unit, the 95% failure-rate upper bound, the wall time and the pool size.
2. THE Verdict_Panel SHALL show the trial count as the sum of its parts as in `Verdict.trials`.
3. THE Verdict_Panel SHALL show the failure-rate bound as a percentage with two significant figures, or "not available" when `failureRateUpper95` is undefined.
4. THE Verdict_Panel SHALL show the wall time in seconds with one decimal place, from `Verdict.ms`.
5. THE Verdict_Panel SHALL show the pool size from `TrialPool.size`.
6. THE Verdict_Panel SHALL show every number in B612 Mono with Tabular_Figures.
7. WHEN a number changes, THE Number_Tween SHALL move the displayed value from the old value to the new value over 250 ms with an ease-out curve.
8. WHERE Reduced_Motion is set, THE Number_Tween SHALL show the new value without animation.
9. WHILE a run is active, THE Verdict_Panel SHALL update its counters at most once per frame.
10. THE Verdict_Panel SHALL show the Aura_Summary as text.
11. THE Verdict_Panel SHALL show for a held verdict the sentence "No counterexample found in N trials (n random, m guided)" with the Budget and SHALL NOT show a claim of proof.
12. WHEN the displayed Number_Tween is running, THE Render_Scheduler SHALL NOT be a Render_Reason and the tween SHALL run on its own `requestAnimationFrame` loop that stops when all tweens end.
13. FOR ALL Verdicts, THE Verdict_Panel final displayed values SHALL equal the Verdict values after formatting (display property).
14. FOR ALL tween progress values, THE Number_Tween displayed value SHALL lie between the old value and the new value (bounds property).
15. THE Verdict_Panel SHALL expose each number as text that assistive technology reads in full, with a label that names it, and SHALL not rely on the animation for the final value.

### Requirement 24: Responsive layout

**User Story:** As a visitor on a phone or a laptop, I want the studio laid out for my screen, so that the stage is the main thing and nothing scrolls sideways.

#### Acceptance Criteria

1. WHILE the viewport is at least 1024 px wide, THE Studio SHALL place the Tablet as a 380 px column at the left of the full-bleed Stage and the Reel under the Stage.
2. WHILE the viewport is less than 1024 px wide, THE Studio SHALL stack the Stage, then the primary actions, then the Tablet, then the Reel, in one column.
3. WHILE the viewport is less than 1024 px wide, THE Studio SHALL set the Stage height to 56vh.
4. THE primary actions SHALL be the button "Summon 64 ghosts for every line", the "Reset" action and the theme toggle, and SHALL sit directly under the Stage on narrow viewports.
5. WHEN the viewport is 375 px wide, THE Studio SHALL cause no horizontal scroll of the page, and no Studio element SHALL be wider than the viewport.
6. THE Studio SHALL set body text at 16 px with line-height 1.55 and a measure of at most 72ch, and SHALL use the type scale 13, 16, 20, 25, 31, 39, 61 px.
7. THE Studio SHALL use a radius of 2 px for controls and 0 for the Stage, and SHALL use 1 px borders in `--clay` at 35% opacity.
8. THE Studio SHALL use no gradient and no drop shadow on cards.
9. THE Studio SHALL set a minimum touch target of 44 px by 44 px for buttons on viewports below 1024 px.
10. WHEN the Host_Element is resized, THE Studio SHALL re-run its layout without reloading and SHALL keep the Stage aspect ratio correct.
11. THE Studio SHALL use the font Gloock for no element inside the Studio.
12. WHEN the page zoom is 200%, THE Studio SHALL keep all controls usable and SHALL cause no horizontal scroll of the Tablet.

### Requirement 25: Light and dark themes

**User Story:** As a visitor, I want a theme that matches my system and a toggle to change it, so that the studio is comfortable to read.

#### Acceptance Criteria

1. THE Studio SHALL define the Theme_Tokens `--ground`, `--ground-2`, `--ink`, `--ink-2`, `--clay`, `--ghost`, `--break` and `--hold` with the dark and light values in `design-language.md`.
2. WHEN the Studio loads and the user has saved no theme, THE Studio SHALL use the theme from `prefers-color-scheme` and SHALL use dark when no preference is reported.
3. THE Studio SHALL provide a theme toggle with `aria-pressed` that switches between dark and light and SHALL answer within 100 ms.
4. WHEN the user chooses a theme, THE Studio SHALL save the choice in `localStorage` and SHALL use it on later loads in preference to `prefers-color-scheme`.
5. WHEN the system `prefers-color-scheme` changes and the user has saved no theme, THE Studio SHALL follow the system theme.
6. THE Studio SHALL give body text a contrast ratio of at least 7:1 on `--ground`, and SHALL give `--break` and `--hold` text a contrast ratio of at least 4.5:1 on `--ground` and on `--ground-2` in both themes.
7. THE Studio SHALL apply the theme to the DOM by Theme_Tokens only and SHALL read the three.js colours from the same tokens.
8. IF `localStorage` is not available, THEN THE Studio SHALL keep the choice in memory for the session.
9. FOR ALL pairs of foreground and background tokens that the Studio uses for text, THE contrast ratio computed from the token values SHALL meet the stated minimum (contrast property).

### Requirement 26: Accessibility

**User Story:** As a user of assistive technology or a keyboard, I want every control reachable and every result announced, so that I can use the studio.

#### Acceptance Criteria

1. THE Studio SHALL make every interactive control reachable with the Tab key in a logical order: primary actions, Tablet lines, Reel.
2. THE Studio SHALL show a visible focus ring of at least 2 px in a colour with a contrast ratio of at least 3:1 against its surroundings on every focusable element.
3. THE Studio SHALL provide a Live_Region with `aria-live="polite"` that announces each verdict on completion, for example "Requirement 2.1 broken: falls from 168 N at 135 degrees, 62 percent into the stride".
4. THE Studio SHALL provide a Live_Region with `role="alert"` for errors.
5. THE Studio SHALL limit announcements during a run to one per 2 s of progress and SHALL announce the final verdict immediately.
6. THE Studio SHALL give the Stage `role="application"` and an accessible name and description that tell what the Stage shows and how to push.
7. THE Studio SHALL give every button a text label, and every icon-only control an `aria-label`.
8. WHERE Reduced_Motion is set, THE Studio SHALL not run the Summoning rise, the Number_Tween or the damped orbit glide, and SHALL still show all information.
9. THE Studio SHALL not rely on colour alone to show the difference between held and broken, and SHALL use text and shape as well.
10. THE Studio SHALL use semantic headings and landmarks: `main`, `aside` for the Tablet, `region` for the Reel and Verdict_Panel, each with an accessible name.
11. THE Studio SHALL write the accessible name of each Requirement_Line as the ID and the sentence text, and its status as `aria-describedby` text.
12. THE Studio SHALL pass an automated accessibility scan with no serious or critical violation in both themes on the mounted test app.
13. WHEN a dialog or message appears, THE Studio SHALL move no focus unless the user has activated its trigger.
14. THE Studio SHALL set the `lang` attribute use of the document unchanged and SHALL not override it.

### Requirement 27: Performance

**User Story:** As a visitor on an integrated GPU, I want the studio to stay smooth and start fast, so that it feels solid.

#### Acceptance Criteria

1. WHILE the Ghost_Swarm shows 64 Ghosts and the Hero_Sim is running, THE Studio SHALL draw at 60 frames per second on integrated graphics, measured as a median frame interval of at most 17 ms and a 95th-percentile interval of at most 25 ms by a Frame_Probe over 5 s in a Playwright test.
2. THE Studio SHALL show the first meaningful frame, being the Hero_Robot drawn on the Floor with the Tablet text visible, within 4 s of navigation on a mid-range laptop on a local static server.
3. THE Studio SHALL draw the Ghost_Swarm with at most one draw call per robot geom for the Ghosts and one for the Push_Arrows.
4. THE Studio SHALL update Ghost instance matrices by writing into preallocated typed arrays and SHALL allocate no object per Ghost per frame.
5. THE Studio SHALL block the main thread for no more than 50 ms in a single task while a run is active, excluding the physics steps of the Hero_Sim, which are bounded by the Step_Cap.
6. WHEN the Studio is idle, THE Studio SHALL use no CPU for drawing, as shown by the Frame_Probe seeing no frame for 1 s.
7. THE Studio SHALL load model meshes and fonts once, SHALL cache them and SHALL show the Tablet before the Hero_Sim is ready.
8. WHILE the Hero_Sim loads MuJoCo, THE Studio SHALL show the Tablet text and a status message "Loading the robot" in the Stage area, and SHALL replace it when the first frame is drawn.
9. THE Studio SHALL limit the Filmstrip rendering to one frame per animation frame, so that it does not block interaction.
10. THE Hero_Sim SHALL run at no less than real time on the reference laptop or SHALL show "Running slower than real time" in the Stage area while it does not.

### Requirement 28: Determinism, resources and constraints

**User Story:** As a maintainer, I want the studio to follow the product rules, so that its results reproduce and it leaks nothing.

#### Acceptance Criteria

1. THE Studio SHALL use no `Math.random()` call in code under `skeleton/src/ui`, and SHALL draw every random choice from a Seeded_PRNG created from the Studio seed.
2. THE Studio SHALL make no network request except for fetching static assets of the app and the Studio, and SHALL include no analytics and no tracker.
3. THE Studio SHALL import three.js plainly and SHALL NOT use react-three-fiber.
4. THE Studio SHALL use React 18 only for the Tablet, Quantity_Controls, Reel and Verdict_Panel, and SHALL build the Stage with plain three.js.
5. THE Studio SHALL be written in TypeScript with `strict` enabled, as ES modules, for Node 20 or later and for the browser.
6. THE Studio SHALL call `.delete()` on every MuJoCo handle it creates before `dispose()` returns.
7. THE `golem-spec/ui` entry point SHALL export only the documented public API, and THE apps SHALL import the Studio only through `golem-spec/ui`.
8. THE Studio SHALL add no runtime dependency beyond those listed in `tech.md` and the font files.
9. THE Studio SHALL keep the Hero_Sim, the Stage and the Ghost_Swarm free of React, so that they run in tests without a DOM framework.
10. WHEN the same Stage state and the same Pose_Frame data are given, THE Ghost_Swarm SHALL write the same instance matrices (determinism).
11. THE Studio SHALL produce error messages in plain language with units, and SHALL put spooky wording only in names and visuals.
12. THE Studio SHALL keep the shapes in `interfaces.md` unchanged, and SHALL add only the optional `visual` field and Studio-specific types.

### Requirement 29: Error handling

**User Story:** As a visitor, I want clear messages when something fails, so that I know what to do.

#### Acceptance Criteria

1. IF MuJoCo fails to load, THEN THE Studio SHALL keep the Tablet usable for reading and editing, SHALL disable the Summon and Shove actions and SHALL show a message that names the failure and says to reload.
2. IF the `RobotApp.files()` call rejects, THEN THE Studio SHALL show a message that names the app and the failure.
3. IF the WebGL context is lost, THEN THE Studio SHALL show "The 3D view was lost" in the Stage area and SHALL rebuild the Stage on context restore.
4. IF a pool run rejects with a worker crash error, THEN THE Run_Controller SHALL show the error with the `TrialSpec` named in it and SHALL leave other lines unchanged.
5. IF a Pose_Frame array has a length that is not a multiple of `nbody × 7`, THEN THE Ghost_Swarm SHALL reject that result with a warning and create no Ghost.
6. IF a `TrialResult` contains a non-finite pose value, THEN THE Ghost_Swarm SHALL show the Ghost at the last finite frame.
7. IF the Share_Hash cannot be parsed, THEN THE Studio SHALL load the original requirements and SHALL show the message from Requirement 22.
8. IF an exception is thrown inside a React component, THEN THE Studio SHALL show a message in the failed panel that says the panel failed, with a "Reload this panel" button, and SHALL keep the Stage and the other panels running.
9. THE Studio SHALL write each error message so that it states what broke and how to fix it.

### Requirement 30: Property and example tests

**User Story:** As a maintainer, I want the studio checked by properties and by a browser performance test, so that regressions in logic and speed are caught.

#### Acceptance Criteria

1. THE Studio test suite SHALL use Vitest for example tests and fast-check for property tests, and SHALL run the logic tests without a browser and without MuJoCo.
2. THE Studio test suite SHALL include a determinism property: the same Pose_Frame data and Ghost state give the same instance matrices (Requirement 28.10).
3. THE Studio test suite SHALL include a round-trip property for the Share_Hash (Requirement 22.13) and one for the "Copy seed" JSON (Requirement 22.14).
4. THE Studio test suite SHALL include the Aura properties: order-independence, bin invariant, wrap and summary (Requirements 13.8, 13.9, 13.10 and 14.12).
5. THE Studio test suite SHALL include the Quantity_Control properties: step round-trip, clamp and rewrite (Requirements 16.15, 16.16 and 16.17).
6. THE Studio test suite SHALL include the Fixed_Step_Accumulator decoupling property (Requirement 6.5) and the Spring_Force property (Requirement 7.12).
7. THE Studio test suite SHALL include the ghost properties: colour, sync and arrow (Requirements 10.14, 11.9 and 12.8), and the display, status and margin properties (Requirements 15.11, 18.14, 18.15, 23.13 and 23.14).
8. THE Studio test suite SHALL include the contrast property (Requirement 25.9) over the token values.
9. THE Studio test suite SHALL include an example test for the render-on-demand rule: with no Render_Reason active, no `requestAnimationFrame` callback is pending (Requirement 5.1), using a fake renderer.
10. THE Studio test suite SHALL include an example test for each Diagnostic display with `kind`, `line` and `column` from `golem-ears`.
11. THE Studio test suite SHALL include a Playwright test that runs the Frame_Probe with 64 Ghosts (Requirement 27.1), a first-meaningful-frame test (Requirement 27.2), a 375 px no-horizontal-scroll test (Requirement 24.5), and an accessibility scan in both themes (Requirement 26.12).
12. THE Studio test suite SHALL use short horizons of at most 2 s of simulated time and small trial budgets, and SHALL keep long campaigns in `evidence/`.
13. THE Studio test suite SHALL name each test for the behaviour it checks, for example `it('rejects a force typed with a time unit')`.
14. THE Studio test suite SHALL NOT weaken an assertion or a requirement to make a test pass.
15. THE Studio test suite SHALL use a fake `TrialPool` with a synthetic trial function for logic tests, in the manner of `golem-falsify`.
