# Requirements Document

## Introduction

stagger-app is app 1 of GOLEM, located in `apps/stagger`. It is a Unitree G1 humanoid (the 12-DOF legs model, `g1_12dof`) walking under Unitree's published locomotion policy, and it is the target that GOLEM tests with EARS requirements. The app has its own `package.json`, its own `.kiro/` (installed by `golem init`), and consumes the skeleton package `golem-spec` only through the public entry points `golem-spec`, `golem-spec/ui` and `golem-spec/node`. It never deep-imports `skeleton/src/...`.

The app consists of five parts:

1. **Asset pipeline** (`scripts/fetch-assets.mjs`): downloads the G1 MJCF, STL meshes and `motion.pt` from `github.com/unitreerobotics/unitree_rl_gym` at a pinned commit (BSD-3-Clause), builds convex-hull collision meshes and simplified visual meshes, rewrites the MJCF, writes `scene.xml`, extracts the policy weights into `robot/policy.bin`, and commits the processed assets so the site needs no build-time download.
2. **Controller** (`controller/policy.ts`, `controller/walker.ts`): a TypeScript port of the policy network (LSTM 47→64, Linear 64→32, ELU, Linear 32→12) in Float64, the 47-dimensional observation exactly as Unitree's deploy script builds it, the action mapping, and the PD torque law. A parity regression test pins the pelvis position after 2 s against a Python reference.
3. **Lexicon** (`lexicon.ts`): the robot names, signals, predicates and perturbations that the GOLEM EARS compiler matches against.
4. **App definition and requirements** (`app.ts` and `.kiro/specs/g1-walking/requirements.md`): the `RobotApp` export, and the robot's EARS requirements, some expected to hold and at least two expected to break.
5. **Studio page** (`web/`): the browser page built on `golem-spec/ui` (stage, ghosts, aura, tablet, reel) with app-specific copy.

All TypeScript shapes named here (`RobotApp`, `Controller`, `SimContext`, `Lexicon`, `PredicateTemplate`, `PerturbationTemplate`, `Dimension`, `Quantity`, `Trace`, `CompiledRequirement`, `TrialSpec`, `TrialResult`, `Verdict`) are the fixed contracts in `.kiro/steering/interfaces.md`. This spec may add fields but never renames or removes them. Sibling specs: `golem-ears` (compiler), `golem-sim` (episode runner), `golem-falsify` (search and shrinking).

Out of scope: the EARS compiler, the episode runner, the falsifier, the shared UI components, and the Franka Panda app (`apps/candy`). A pass of any requirement means "no counterexample found within this search budget", never a proof.

## Glossary

- **Stagger_App**: The code in `apps/stagger` that this spec describes.
- **Asset_Fetcher**: The Node script `apps/stagger/scripts/fetch-assets.mjs`.
- **Upstream_Repo**: `github.com/unitreerobotics/unitree_rl_gym`, the source of the G1 MJCF, meshes and policy.
- **Pinned_Commit**: The full 40-character git commit hash of the Upstream_Repo, stored as one constant in the Asset_Fetcher, from which every upstream file is downloaded.
- **Source_Mesh**: An STL file of the Upstream_Repo's G1 model.
- **Hull_Mesh**: A convex-hull collision mesh built from a Source_Mesh with `quickhull3d` and saved as binary STL.
- **Visual_Mesh**: A Source_Mesh reduced with the `meshoptimizer` simplifier to at most 3,000 triangles and saved as binary STL.
- **Robot_Folder**: `apps/stagger/robot/`, which holds `scene.xml`, the rewritten MJCF, the meshes, `policy.bin` and `LICENSE`.
- **Upstream_MJCF**: The `g1_12dof` MJCF file of the Upstream_Repo.
- **Robot_MJCF**: The MJCF in the Robot_Folder after the Asset_Fetcher rewrites it.
- **Scene_File**: `robot/scene.xml`, which includes the Robot_MJCF and adds a floor.
- **Policy_File**: `robot/policy.bin`, the binary container of the policy weights.
- **Policy_Archive**: `deploy/pre_train/g1/motion.pt` of the Upstream_Repo, a TorchScript zip.
- **Weights**: The eight float32 tensors W1, b1, W2, b2, Wih, Whh, bih, bhh listed in Requirement 4.
- **Policy**: The network in `controller/policy.ts`: LSTM(47→64), Linear 64→32, ELU, Linear 32→12.
- **Policy_State**: The LSTM hidden vector `h` (64) and cell vector `c` (64) of the Policy.
- **Walker**: The Controller in `controller/walker.ts` that builds the observation, runs the Policy and writes `data.ctrl`.
- **Observation**: The 47-dimensional Float64 vector described in Requirement 7.
- **Command**: The 3-vector (forward speed in m/s, lateral speed in m/s, yaw rate in rad/s) given to the Walker.
- **Default_Pose**: The 12-vector `[-0.1, 0, 0, 0.3, -0.2, 0]` repeated for the left and right leg, in rad.
- **Gait_Phase**: `(t mod 0.8 s) / 0.8 s`, a value in [0, 1).
- **Control_Step**: One policy evaluation, every 20 ms (50 Hz), equal to 10 Sim_Steps.
- **Sim_Step**: One MuJoCo step of 2 ms.
- **PD_Law**: The torque law `ctrl = (target - q) * kp - qd * kd`, applied at every Sim_Step.
- **Heading**: The yaw direction of the pelvis, the projection of the pelvis x axis onto the horizontal plane.
- **Heading_Frame**: The horizontal frame whose x axis is the Heading.
- **Signal_Set**: The five signals `pelvis_z`, `tilt_deg`, `forward_speed`, `commanded_speed`, `lateral_drift`.
- **Lexicon_File**: `apps/stagger/lexicon.ts`, exporting the `Lexicon` of Stagger_App.
- **Tilt**: The angle in degrees between the pelvis z axis and the world up axis.
- **Latency_Buffer**: The ring buffer in the Walker that delays the Observation by a whole number of Control_Steps.
- **App_Definition**: The `RobotApp` object exported by `apps/stagger/app.ts`.
- **Requirements_File**: `apps/stagger/.kiro/specs/g1-walking/requirements.md`, the robot's EARS requirements in the standard Kiro requirements format.
- **Expected_Hold**: A requirement in the Requirements_File that the controller is expected to satisfy within the search budget.
- **Expected_Break**: A requirement in the Requirements_File for which the falsifier is expected to find a counterexample.
- **Studio_Page**: The browser page in `apps/stagger/web/`.
- **Studio_Copy**: The app-specific text of the Studio_Page.
- **Parity_Reference**: The Python reference run whose results are given in Requirement 9.
- **Smoke_Trial**: A 2 s simulated trial of the Stagger_App run in Node.
- **SI**: International System of Units, as used for every numeric value in Scenario, Trace and Signal_Set.

## Requirements

### Requirement 1: Fetch upstream assets at a pinned commit

**User Story:** As a maintainer, I want the G1 model and policy downloaded from one pinned upstream commit with their licence, so that the assets are reproducible and correctly attributed.

#### Acceptance Criteria

1. THE Asset_Fetcher SHALL define the Pinned_Commit as a single 40-character lowercase hexadecimal constant and SHALL build every download URL from that constant.
2. WHEN the Asset_Fetcher runs, THE Asset_Fetcher SHALL download the Upstream_MJCF, every Source_Mesh that the Upstream_MJCF references, and the Policy_Archive from the Upstream_Repo at the Pinned_Commit.
3. WHEN the Asset_Fetcher runs, THE Asset_Fetcher SHALL copy the Upstream_Repo's `LICENSE` file at the Pinned_Commit to `robot/LICENSE` without modification.
4. THE Asset_Fetcher SHALL write the Pinned_Commit and the upstream file paths into `robot/SOURCE.json`.
5. IF a download returns an HTTP status other than 200, THEN THE Asset_Fetcher SHALL exit with a non-zero code and print the URL and the status.
6. IF the Upstream_MJCF references a mesh file that the Asset_Fetcher cannot download, THEN THE Asset_Fetcher SHALL exit with a non-zero code and print the mesh name.
7. THE Asset_Fetcher SHALL write no file outside the Robot_Folder and a temporary directory that it deletes before it exits.
8. THE Asset_Fetcher SHALL make network requests only to `raw.githubusercontent.com` or `github.com` for the Upstream_Repo.

### Requirement 2: Build collision hulls and simplified visual meshes

**User Story:** As a performance engineer, I want convex-hull collision meshes and light visual meshes, so that the model loads in about 3 s instead of 52 s with the same dynamics.

#### Acceptance Criteria

1. WHEN the Asset_Fetcher processes a Source_Mesh, THE Asset_Fetcher SHALL build a Hull_Mesh with `quickhull3d` and save it as binary STL.
2. THE Hull_Mesh SHALL enclose every vertex of its Source_Mesh within 1e-6 m.
3. WHEN the Asset_Fetcher processes a Source_Mesh, THE Asset_Fetcher SHALL build a Visual_Mesh with the `meshoptimizer` simplifier and save it as binary STL.
4. THE Visual_Mesh SHALL have at most 3,000 triangles.
5. WHEN a Source_Mesh has 3,000 triangles or fewer, THE Asset_Fetcher SHALL keep its triangle count unchanged in the Visual_Mesh.
6. THE Asset_Fetcher SHALL write binary STL files whose byte length equals `84 + 50 * triangleCount`.
7. THE Asset_Fetcher SHALL name Hull_Mesh files and Visual_Mesh files so that a Hull_Mesh and a Visual_Mesh of the same Source_Mesh never share a file name.
8. IF a Source_Mesh has fewer than 4 non-coplanar vertices, THEN THE Asset_Fetcher SHALL exit with a non-zero code and print the mesh name.
9. FOR ALL generated valid binary STL buffers, parsing then writing then parsing SHALL produce an equal triangle list (STL round-trip property).

### Requirement 3: Rewrite the MJCF and write the scene

**User Story:** As a simulation engineer, I want the MJCF rewritten so that collision uses the hulls and visuals use the light meshes, so that physics is fast and the ghost swarm stays light.

#### Acceptance Criteria

1. WHEN the Asset_Fetcher rewrites the Upstream_MJCF, THE Asset_Fetcher SHALL point every collision geom at a Hull_Mesh and set its `group` to 3.
2. WHEN the Asset_Fetcher rewrites the Upstream_MJCF, THE Asset_Fetcher SHALL point every visual geom at a Visual_Mesh and set its `group` to 2, `contype` to 0, and `conaffinity` to 0.
3. THE Robot_MJCF SHALL preserve every body name, joint name, joint range, actuator name, inertial element and body hierarchy of the Upstream_MJCF.
4. THE Robot_MJCF SHALL declare the 12 leg joints in this order: left hip pitch, left hip roll, left hip yaw, left knee, left ankle pitch, left ankle roll, then the same six for the right leg.
5. THE Robot_MJCF SHALL declare a body named `pelvis` as the free-joint root and a body named `torso_link` or the Upstream_MJCF's equivalent torso body.
6. THE Asset_Fetcher SHALL write `robot/scene.xml` so that it includes the Robot_MJCF and adds a floor geom named `floor`.
7. THE Scene_File SHALL set the simulation timestep to 0.002 s.
8. THE Robot_MJCF SHALL declare one PD actuator per leg joint with `gainprm = kp` and `biasprm = (0, -kp, -kd)` from Requirement 8, so that MuJoCo applies the PD_Law at every Sim_Step with `data.ctrl` as the joint target. (Revised: golem-sim calls the controller once per Control_Step, see the design's Walker revision note.)
9. WHEN the Robot_MJCF is rewritten a second time from its own output, THE Asset_Fetcher SHALL produce a Robot_MJCF equal to the first (rewrite idempotence property).
10. WHEN the Scene_File is compiled with `mj.MjModel.from_xml_path('/robot/scene.xml')` after the files are written with `mj.FS.writeFile`, THE Stagger_App SHALL give a model with 12 actuators and `nq` equal to 19.
11. WHEN the Scene_File is compiled in Node, THE Stagger_App SHALL complete the compile within 5 s on the reference development machine.

### Requirement 4: Extract the policy weights into policy.bin

**User Story:** As a controller engineer, I want the policy weights pulled out of the TorchScript zip into a small binary file, so that the browser and Node load them without PyTorch.

#### Acceptance Criteria

1. WHEN the Asset_Fetcher extracts the Policy_Archive, THE Asset_Fetcher SHALL read the zip entries `policy_lstm_1/data/2` to `policy_lstm_1/data/9` as raw little-endian float32 storages.
2. THE Asset_Fetcher SHALL map the entries to Weights as follows: entry 2 is W1 with shape 32×64, entry 3 is b1 with shape 32, entry 4 is W2 with shape 12×32, entry 5 is b2 with shape 12, entry 6 is Wih with shape 256×47, entry 7 is Whh with shape 256×64, entry 8 is bih with shape 256, entry 9 is bhh with shape 256.
3. IF an entry byte length differs from 4 times the product of its expected shape, THEN THE Asset_Fetcher SHALL exit with a non-zero code and print the entry name, the expected byte length and the actual byte length.
4. IF a required entry is absent from the Policy_Archive, THEN THE Asset_Fetcher SHALL exit with a non-zero code and print the entry name.
5. THE Asset_Fetcher SHALL write the Policy_File as a 4-byte little-endian unsigned header length, a UTF-8 JSON header, and the float32 tensors in header order.
6. THE JSON header SHALL list, for each tensor, its name, its shape, its byte offset and its byte length, and SHALL carry the Pinned_Commit and the gate order `i, f, g, o`.
7. THE Asset_Fetcher SHALL align every tensor offset to 4 bytes.
8. THE Policy_File SHALL be readable in Node and in a browser without a native dependency.
9. FOR ALL generated sets of tensors with the Weights shapes, packing then unpacking SHALL return float32 values equal bit for bit to the input (policy.bin round-trip property).

### Requirement 5: Commit processed assets and keep the pipeline reproducible

**User Story:** As a site maintainer, I want the processed assets committed, so that the site builds without a network download and anyone can regenerate them.

#### Acceptance Criteria

1. THE Stagger_App SHALL commit the Robot_Folder contents produced by the Asset_Fetcher, including `scene.xml`, the Robot_MJCF, Hull_Mesh files, Visual_Mesh files, `policy.bin`, `LICENSE` and `SOURCE.json`.
2. THE Stagger_App SHALL keep the BSD-3-Clause notice of the Upstream_Repo in `robot/LICENSE`.
3. THE Stagger_App SHALL declare in its `package.json` an npm script `assets` that runs the Asset_Fetcher.
4. WHEN the Asset_Fetcher runs twice against the same Pinned_Commit, THE Asset_Fetcher SHALL produce byte-equal files in the Robot_Folder.
5. THE Stagger_App SHALL run no download at build time, at test time or at runtime, apart from fetching static assets from its own origin.
6. THE Stagger_App SHALL include in its README the command that regenerates the Robot_Folder.
7. THE Stagger_App SHALL keep the total size of the Robot_Folder small enough for a static site, and SHALL report the size in bytes in the Asset_Fetcher output.

### Requirement 6: Run the policy network in Float64 without allocation

**User Story:** As a controller engineer, I want a TypeScript port of the policy network, so that the controller runs the same network as Unitree's deploy script inside MuJoCo WASM.

#### Acceptance Criteria

1. THE Policy SHALL compute, for each call, an LSTM step with input size 47 and hidden size 64, then a Linear layer 64→32, then ELU with alpha 1, then a Linear layer 32→12.
2. THE Policy SHALL compute the LSTM gates in PyTorch order i, f, g, o, with `gates = Wih · x + bih + Whh · h + bhh`, then `c' = sigmoid(f) * c + sigmoid(i) * tanh(g)` and `h' = sigmoid(o) * tanh(c')`.
3. THE Policy SHALL convert the Weights from float32 to Float64 once at load time and SHALL compute in Float64.
4. THE Policy SHALL write its output into a caller-supplied Float64Array of length 12.
5. WHILE the Policy runs a call, THE Policy SHALL allocate no object, array, typed array or closure.
6. WHEN the Policy is constructed, THE Policy SHALL set `h` and `c` to zero.
7. WHEN the Policy `reset` function is called, THE Policy SHALL set `h` and `c` to zero.
8. THE Policy SHALL read the Weights through a loader that accepts the bytes of the Policy_File and SHALL use no network access.
9. IF the Policy_File header lists a tensor with a shape that differs from the shape in Requirement 4.2, THEN THE Policy loader SHALL throw an error that names the tensor, the expected shape and the actual shape.
10. IF the input vector length is not 47 or the output vector length is not 12, THEN THE Policy SHALL throw an error that names both lengths.
11. FOR ALL input vectors with finite entries in [-10, 10] and zero Policy_State, THE Policy SHALL return 12 finite values (finite-output property).
12. WHEN the Policy runs the same input sequence twice from a reset state, THE Policy SHALL return bit-identical outputs (determinism property).
13. WHEN the Policy runs the same input sequence in one instance with a `reset` between the two runs, THE Policy SHALL return bit-identical outputs for both runs.

### Requirement 7: Build the 47-dimensional observation like Unitree's deploy script

**User Story:** As a controller engineer, I want the observation laid out exactly as Unitree's deploy script lays it out, so that the published policy sees the inputs it was trained on.

#### Acceptance Criteria

1. THE Walker SHALL write `obs[0:3]` as the pelvis angular velocity `qvel[3:6]` multiplied by 0.25.
2. THE Walker SHALL write `obs[3:6]` as the gravity direction projected into the pelvis frame from the pelvis quaternion `qpos[3:7]`, equal to `(0, 0, -1)` when the pelvis is upright.
3. THE Walker SHALL write `obs[6:9]` as the Command multiplied element-wise by `(2, 2, 0.25)`.
4. THE Walker SHALL write `obs[9:21]` as `qpos[7:19] - Default_Pose`.
5. THE Walker SHALL write `obs[21:33]` as `qvel[6:18]` multiplied by 0.05.
6. THE Walker SHALL write `obs[33:45]` as the action of the previous Control_Step, and zeros at the first Control_Step.
7. THE Walker SHALL write `obs[45]` as `sin(2π · Gait_Phase)` and `obs[46]` as `cos(2π · Gait_Phase)`, with a gait period of 0.8 s.
8. WHEN the pelvis quaternion has unit norm, THE Walker SHALL give a projected gravity vector of unit norm within 1e-12.
9. FOR ALL unit quaternions, THE Walker SHALL give a projected gravity vector that is unchanged within 1e-12 when a rotation about the world vertical axis is applied to the quaternion (yaw invariance property).
10. THE Walker SHALL expose the observation builder as a pure function of `(qpos, qvel, command, previousAction, time, out)` so that a test can call it without MuJoCo.
11. THE Walker SHALL write the Observation into a preallocated Float64Array of length 47 and SHALL allocate nothing per call.
12. THE Walker SHALL read the base angular velocity from `qvel[3:6]` in the body frame, as the Upstream_MJCF free joint defines it.
13. WHEN the Walker computes `Gait_Phase`, THE Walker SHALL use the simulated time since the start of the episode, so that the phase is 0 at `t = 0`.

### Requirement 8: Map actions to targets and apply the PD law

**User Story:** As a controller engineer, I want the action mapping and torque law of the deploy script, so that the robot is driven the way the policy was trained.

#### Acceptance Criteria

1. THE Walker SHALL compute the joint target as `action * 0.25 + Default_Pose`, for the 12 leg joints.
2. THE Walker SHALL use `kp = [100, 100, 100, 150, 40, 40]` repeated for both legs, in N·m/rad.
3. THE Walker SHALL use `kd = [2, 2, 2, 4, 2, 2]` repeated for both legs, in N·m·s/rad.
4. THE Stagger_App SHALL apply the torque `(target - q) * kp - qd * kd` to each leg joint, with the Walker writing `target` to `data.ctrl` and the Robot_MJCF PD actuators of Requirement 3.8 computing the torque.
5. THE Stagger_App SHALL evaluate the PD_Law every Sim_Step, using the current `q` and `qd` and the target of the latest Control_Step.
6. THE Walker SHALL evaluate the Policy once every Control_Step (50 Hz) and SHALL hold the target constant over the 10 Sim_Steps of that Control_Step.
7. THE Walker SHALL store the action of each Control_Step as the previous action for the next Observation.
8. WHEN `q` equals the target and `qd` is 0, THE Walker SHALL write a `ctrl` of 0 for every joint.
9. FOR ALL finite `q`, `qd` and action vectors, THE Walker SHALL write a `ctrl` that equals `(target - q) * kp - qd * kd` within 1e-12 relative error (PD linearity property).
10. WHEN the Walker is constructed, THE Walker SHALL reset the Policy_State, the previous action, the Latency_Buffer and the target to the Default_Pose and zero action.
11. THE Walker SHALL allocate no object, array, typed array or closure in its `step` function.
12. THE Walker SHALL implement the `Controller` interface of `interfaces.md`, writing `data.ctrl` in its `step(ctx, t)`.

### Requirement 9: Match the Python reference

**User Story:** As a maintainer, I want a regression test against a Python reference, so that a port error in the network, observation or PD law is caught.

#### Acceptance Criteria

1. THE parity test SHALL start the robot at the Default_Pose plus the initial joint noise `[0.001257302210933933, -0.0013210486329130189, 0.006404226504432821, 0.001049001171530397, -0.005356693731611109, 0.0036159505490948474, 0.013040000451301373, 0.009470809631292421, -0.007037352358069926, -0.012654214710460526, -0.006232744625373522, 0.000413259793472436]`, which equals `numpy.random.default_rng(0).normal(0, 0.01, 12)`.
2. THE parity test SHALL command a forward speed of 0.5 m/s, a lateral speed of 0 m/s and a yaw rate of 0 rad/s.
3. WHEN the parity test has simulated 2 s, THE Stagger_App SHALL place the pelvis at `x = 0.79987 m`, `y = -0.02247 m` and `z = 0.76789 m`, each within 1e-3 m.
4. THE parity test SHALL run in Node with the committed Robot_Folder and without network access.
5. THE parity test SHALL pass without weakening the tolerance of 1e-3 m or changing any reference value.
6. IF the parity test fails, THEN THE parity test SHALL print the three observed coordinates, the three reference coordinates and the three differences in metres.
7. THE parity test SHALL run in under 10 s of wall-clock time on the reference development machine.
8. WHEN the parity test runs twice in the Same Runtime, THE Stagger_App SHALL give bit-identical pelvis positions (determinism property).

### Requirement 10: Package layout and public entry points

**User Story:** As a skeleton maintainer, I want the app to use only public entry points, so that the skeleton stays reusable by other apps.

#### Acceptance Criteria

1. THE Stagger_App SHALL provide its own `apps/stagger/package.json` with TypeScript in strict mode, ES modules and Node 20 or later.
2. THE Stagger_App SHALL import skeleton code only from `golem-spec`, `golem-spec/ui` and `golem-spec/node`.
3. THE Stagger_App SHALL contain no import path that includes `skeleton/src`.
4. THE Stagger_App SHALL contain the folders and files `robot/`, `controller/`, `lexicon.ts`, `app.ts`, `.kiro/specs/g1-walking/requirements.md` and `web/`, and the script `scripts/fetch-assets.mjs`.
5. THE Stagger_App SHALL use no `Math.random()` in `controller/`, `lexicon.ts` or `app.ts`.
6. THE Stagger_App SHALL depend at runtime only on `golem-spec`, `@mujoco/mujoco` and the UI libraries named in `tech.md`, and SHALL list `quickhull3d` and `meshoptimizer` as development dependencies used by the Asset_Fetcher.
7. THE Stagger_App SHALL include no Python code and no Python dependency.
8. WHEN a test scans the source files of the Stagger_App, THE test SHALL find no import of a path that contains `skeleton/src` (public-entry-point check).

### Requirement 11: Provide the five signals

**User Story:** As a requirement author, I want named, physical signals for the G1, so that predicates read like the robot's behaviour.

#### Acceptance Criteria

1. THE App_Definition SHALL provide the signals `pelvis_z`, `tilt_deg`, `forward_speed`, `commanded_speed` and `lateral_drift` through `signals(ctx, out)`.
2. THE signal `pelvis_z` SHALL equal the height of the `pelvis` body above the floor in metres.
3. THE signal `tilt_deg` SHALL equal the Tilt in degrees, in the range [0, 180].
4. THE signal `forward_speed` SHALL equal the 1 s moving average, in m/s, of the pelvis velocity projected onto the Heading in the Heading_Frame.
5. THE signal `commanded_speed` SHALL equal the forward speed of the active Command in m/s.
6. THE signal `lateral_drift` SHALL equal the horizontal distance in metres from the pelvis to the line through the pelvis position at the trigger time along the Heading at the trigger time, taken absolute.
7. WHEN fewer than 1 s of samples exist, THE App_Definition SHALL compute `forward_speed` as the average over the samples available.
8. THE App_Definition SHALL compute the 1 s moving average over 50 control samples with a ring buffer allocated before the Step_Loop.
9. THE `signals` function SHALL allocate no object, array, typed array or closure per call.
10. FOR ALL constant forward velocities along the Heading, THE moving average SHALL equal that velocity within 1e-12 once 50 samples exist (moving-average property).
11. FOR ALL generated sample sequences, THE moving average SHALL lie between the minimum and the maximum of the last 50 samples (bounded-average property).
12. WHEN the pelvis velocity is rotated together with the Heading by the same yaw angle, THE signal `forward_speed` SHALL be unchanged within 1e-12 (heading-frame invariance property).

### Requirement 12: Provide the four predicates

**User Story:** As a requirement author, I want predicates for staying upright, pelvis height, speed tracking and sideways drift, so that I can state the G1's behaviour in EARS.

#### Acceptance Criteria

1. THE Lexicon_File SHALL provide a predicate with the phrase `stay upright`, whose margin in metres equals `pelvis_z - 0.5 m`.
2. WHEN `tilt_deg` exceeds 60 deg, THE `stay upright` predicate SHALL return a margin of -0.01 m, whatever the value of `pelvis_z`.
3. THE Lexicon_File SHALL document, in a comment above the `stay upright` template, that the margin is `pelvis_z - 0.5 m`, that a Tilt above 60 deg forces the margin to -0.01 m, and the reason for the forced value.
4. THE Lexicon_File SHALL provide a predicate with the phrase `keep its pelvis above {length}`, whose margin in metres equals `pelvis_z` minus the length.
5. THE Lexicon_File SHALL provide a predicate with the phrase `track the commanded speed within {speed}`, whose margin in m/s equals the speed slot minus `|forward_speed - commanded_speed|`.
6. WHILE the simulated time since the start of the episode is less than 2 s, THE `track the commanded speed within {speed}` predicate SHALL return a positive margin equal to the speed slot, so that settling does not count as a violation.
7. THE Lexicon_File SHALL provide a predicate with the phrase `not drift sideways more than {length}`, whose margin in metres equals the length slot minus `lateral_drift`.
8. THE Lexicon_File SHALL declare, for each predicate, the signals it reads and its unit (`m` or `m/s`).
9. THE Lexicon_File SHALL set `robotNames` to `["golem", "G1", "robot"]`.
10. FOR ALL generated signal values with `tilt_deg` at most 60 deg, THE `stay upright` margin SHALL equal `pelvis_z - 0.5` within 1e-12 (margin formula property).
11. FOR ALL generated signal values with `tilt_deg` above 60 deg, THE `stay upright` margin SHALL equal -0.01 (forced margin property).
12. FOR ALL generated signal values, raising the length slot of `keep its pelvis above {length}` SHALL never raise the margin (monotonicity property).
13. FOR ALL generated signal values, THE margin of `track the commanded speed within {speed}` SHALL be non-decreasing in the speed slot (monotonicity property).

### Requirement 13: Provide the push perturbation

**User Story:** As a visitor and as a falsification engineer, I want to shove the G1 with a force from a chosen direction at a chosen point in its stride, so that push recovery is tested the way a person would test it.

#### Acceptance Criteria

1. THE Lexicon_File SHALL provide a perturbation with the phrase `the pelvis is pushed with {range:force} for {duration} from {direction} at {phase}`.
2. THE perturbation SHALL declare the dimensions `push.force` (kind force, severity up), `push.angle` (kind angle, wrap true, severity none) and `push.phase` (kind phase, wrap true, severity none), and SHALL treat the duration as a fixed value.
3. WHEN the perturbation applies, THE perturbation SHALL write the force in newtons to `data.xfrc_applied` for the `pelvis` body, in the horizontal plane.
4. THE perturbation SHALL measure `push.angle` relative to the Heading at the trigger time, so that 0 deg pushes the robot forward and 180 deg pushes it from behind.
5. THE perturbation SHALL start the push at `tTrigger + offset`, where `offset = ((push.phase - Gait_Phase(tTrigger)) mod 1) * 0.8 s`, so that the push starts when the Gait_Phase equals `push.phase`.
6. WHILE the simulated time is at least the push start and less than the push start plus the duration, THE perturbation SHALL apply the force.
7. WHILE the simulated time is outside that window, THE perturbation SHALL apply no force from this perturbation.
8. THE perturbation SHALL compute the Heading once at the trigger time and SHALL hold it for the whole push.
9. THE perturbation SHALL apply no torque component to `xfrc_applied`.
10. FOR ALL generated force, angle, phase and time values, THE norm of the applied horizontal force SHALL equal `push.force` within 1e-9 relative error inside the window, and SHALL equal 0 outside it (force-magnitude property).
11. FOR ALL generated headings and angles, THE direction of the applied force SHALL equal the Heading rotated by `push.angle` within 1e-9 rad (direction property).
12. FOR ALL generated phases, THE push start offset SHALL lie in [0, 0.8 s) and SHALL give the Gait_Phase `push.phase` at the push start within 1e-9 (phase-offset property).
13. THE perturbation SHALL allocate no object, array, typed array or closure per call.

### Requirement 14: Provide the slope, payload and friction perturbations

**User Story:** As a falsification engineer, I want slope, payload and floor-friction perturbations, so that the G1's robustness to its environment can be tested without changing the model on disk.

#### Acceptance Criteria

1. THE Lexicon_File SHALL provide a perturbation with the phrase `walking on a slope of {range:angle}`, declaring the dimension `slope.angle` (kind angle, severity up).
2. WHEN the slope perturbation applies, THE perturbation SHALL rotate the gravity vector of the model by `slope.angle` about the world y axis and SHALL change no geometry.
3. WHEN the Trial ends, THE perturbation SHALL restore the gravity vector of the model to its original value.
4. THE Lexicon_File SHALL provide a perturbation with the phrase `carrying a payload of {range:mass}`, declaring the dimension `payload.mass` (kind mass, severity up).
5. WHEN the payload perturbation applies, THE perturbation SHALL add `payload.mass` kilograms to the mass of the torso body and SHALL call `mj_setConst` if MuJoCo requires it for the changed inertia.
6. WHEN the Trial ends, THE perturbation SHALL restore the torso mass and every derived constant to the original values.
7. THE Lexicon_File SHALL provide a perturbation with the phrase `the floor friction drops to {ratio}`, setting the sliding friction of the `floor` geom to the ratio times its original value, where the ratio is a fixed value.
8. WHEN the Trial ends, THE perturbation SHALL restore the friction of the `floor` geom to its original value.
9. WHEN the perturbations of one Trial have run, THE Stagger_App SHALL leave the cached model's `opt.gravity`, `body_mass`, `body_inertia` and `geom_friction` arrays byte-equal to their values before the Trial (model-restoration property).
10. FOR ALL generated slope angles in [0, 20 deg], THE gravity vector after the perturbation SHALL keep a norm equal to the original norm within 1e-12 relative error (gravity-norm property).
11. FOR ALL generated payload masses, THE torso mass after the perturbation SHALL equal the original plus `payload.mass` within 1e-12 relative error (payload-additivity property).
12. WHEN a requirement states a slope, payload or friction perturbation, THE perturbation SHALL apply from the start of the Active Phase.
13. IF a ratio is below 0 or above 1 after unit conversion, THEN THE Lexicon_File SHALL reject it with a compile diagnostic that names the ratio and the allowed range.

### Requirement 15: Provide the sensor latency and command perturbations

**User Story:** As a falsification engineer, I want to delay the observations and to command a walking speed, so that latency and speed tracking can be tested.

#### Acceptance Criteria

1. THE Lexicon_File SHALL provide a perturbation with the phrase `the sensor latency rises to {range:duration}`, declaring the dimension `latency.duration` (kind duration, severity up).
2. WHEN the latency perturbation applies, THE Walker SHALL delay the Observation by `round(latency.duration / 0.02 s)` whole Control_Steps through the Latency_Buffer.
3. WHILE no latency perturbation applies, THE Walker SHALL use a delay of 0 Control_Steps and SHALL pass the current Observation to the Policy.
4. THE Latency_Buffer SHALL be a ring buffer of preallocated Float64Array rows with a capacity of at least 0.5 s divided by the Control_Step, and SHALL allocate nothing per call.
5. IF `latency.duration` exceeds the capacity of the Latency_Buffer, THEN THE Walker SHALL clamp the delay to the capacity.
6. WHEN the delay is `d` Control_Steps and at least `d` Observations have been stored, THE Walker SHALL pass to the Policy the Observation built `d` Control_Steps earlier.
7. WHILE fewer than `d` Observations have been stored, THE Walker SHALL pass the oldest stored Observation.
8. THE Lexicon_File SHALL provide a perturbation with the phrase `commanded to walk at {range:speed}`, declaring the dimension `command.speed` (kind speed, severity none).
9. WHEN the command perturbation applies, THE Walker SHALL set the forward speed of the Command to `command.speed`, with a lateral speed of 0 m/s and a yaw rate of 0 rad/s.
10. WHILE no command perturbation applies, THE Walker SHALL use the default Command of 0.5 m/s forward, 0 m/s lateral and 0 rad/s yaw.
11. FOR ALL generated observation sequences, a delay of 0 SHALL pass each Observation unchanged (zero-delay identity property).
12. FOR ALL generated observation sequences and delays `d` from 0 to the capacity, THE Latency_Buffer SHALL return the Observation stored `d` steps earlier once `d` Observations exist (delay property).
13. FOR ALL generated durations, THE delay in Control_Steps SHALL be a whole number and SHALL equal `round(duration / 0.02 s)` (whole-step property).

### Requirement 16: Export the RobotApp

**User Story:** As a skeleton user, I want one `RobotApp` object for the G1, so that the CLI, the pool and the studio page can load it by id.

#### Acceptance Criteria

1. THE App_Definition SHALL export a `RobotApp` with `id` equal to `stagger` and `name` equal to `Stagger: Unitree G1`.
2. THE App_Definition SHALL set `sceneFile` to `scene.xml`, `simDt` to 0.002 s, `controlDt` to 0.02 s and `warmup` to 2 s.
3. WHEN `files()` is called in Node, THE App_Definition SHALL read every file of the Robot_Folder from disk and return a record of path to bytes.
4. WHEN `files()` is called in a browser, THE App_Definition SHALL fetch every file of the Robot_Folder from the page's own origin and return a record of path to bytes.
5. THE `files()` record SHALL contain `scene.xml`, the Robot_MJCF, every mesh file that the Scene_File references and `policy.bin`.
6. THE App_Definition SHALL set `lexicon` to the Lexicon_File export.
7. WHEN `makeController(ctx, rng)` is called, THE App_Definition SHALL return a Walker that has loaded the Weights from `policy.bin` and that uses `rng` for no draw other than the initial noise of `initState`.
8. WHEN `initState(ctx, rng)` is called, THE App_Definition SHALL set the free joint to the standing pose of the Default_Pose and add normal noise with a standard deviation of 0.01 rad to the 12 leg joints, drawn from `rng`.
9. THE App_Definition SHALL draw the 12 noise values from `rng` in a fixed order that depends only on the app.
10. THE App_Definition SHALL implement the `signals` function of Requirement 11.
11. WHEN `files()` is called more than once in the same process, THE App_Definition SHALL return equal bytes each time.
12. IF a file of the Robot_Folder is missing, THEN THE App_Definition SHALL reject with an error that names the file.
13. WHEN a Smoke_Trial runs with the same scenario and seed twice, THE Stagger_App SHALL return bit-identical Traces (determinism property).

### Requirement 17: Write the robot's EARS requirements

**User Story:** As a robotics engineer, I want the G1's written requirements in the standard Kiro format, so that GOLEM reads them and the falsification report ties to the spec line by line.

#### Acceptance Criteria

1. THE Stagger_App SHALL provide the Requirements_File in the standard Kiro requirements format, with an Introduction, a Glossary, and numbered requirements with user stories and EARS acceptance criteria.
2. THE Requirements_File SHALL contain lines for push recovery, speed tracking, slopes, payload, slipping and sensor latency.
3. THE Requirements_File SHALL give every number a unit, with a ratio written as a percentage or declared as a `{ratio}`.
4. THE Requirements_File SHALL use only phrases of the Lexicon_File, so that every EARS line compiles.
5. THE Requirements_File SHALL include at least one Expected_Hold line for push recovery, for example a push with up to 100 N for 0.2 s from any direction at any point in the stride, after which the G1 stays upright for 3 s.
6. THE Requirements_File SHALL include at least one Expected_Hold line for speed tracking on level ground.
7. THE Requirements_File SHALL include at least two Expected_Break lines, one of which is a push of up to 250 N from behind, with a duration of 0.2 s, after which the G1 stays upright for 3 s.
8. THE Requirements_File SHALL mark each requirement as an Expected_Hold or an Expected_Break in a Glossary table or an Introduction paragraph, and SHALL NOT carry the mark inside an EARS line.
9. THE Requirements_File SHALL state the harshest believable value in each trigger, as `ears-for-robots.md` requires.
10. THE Requirements_File SHALL carry the requirement ID first on every EARS line, matching Kiro's numbering.
11. WHEN the falsifier runs on an Expected_Break line with the default search budget, THE falsifier SHALL find a counterexample (expected-break check, run as part of the evidence in `evidence/`, not in CI).
12. WHEN the falsifier runs on an Expected_Hold line with the default search budget, THE falsifier SHALL report `held` with the budget stated (expected-hold check, run as part of the evidence in `evidence/`, not in CI).
13. THE Stagger_App SHALL change no line of the Requirements_File to make a failing run pass, and SHALL record any discussion about a line in `proposals.md`.
14. THE Requirements_File SHALL be the file that `golem check`, `golem test` and `golem falsify` read for the app `stagger`.

### Requirement 18: Compile every requirement line and run a smoke trial

**User Story:** As a maintainer, I want every requirement line to compile against the lexicon and one short trial to run in Node, so that CI catches a broken lexicon or model.

#### Acceptance Criteria

1. THE Stagger_App test suite SHALL read the Requirements_File, extract every EARS line, and compile each against the Lexicon_File with the public compile function of `golem-spec`.
2. IF any line fails to compile, THEN THE test SHALL fail and print the line, the diagnostic and the suggestion.
3. THE test suite SHALL assert that each compiled requirement has a non-empty `perturbations` list or a `ubiquitous` pattern, a positive finite `horizon`, and a `space` whose dimensions satisfy `min <= max`.
4. WHEN a Smoke_Trial runs the app `stagger` for 2 s of simulated time after warm-up under a compiled requirement with a push of 0 N, THE Stagger_App SHALL return a TrialResult with finite `robustness` and a Trace of the expected length.
5. THE Smoke_Trial SHALL use a horizon of 2 s or less and a fixed seed.
6. THE Smoke_Trial SHALL complete in under 15 s of wall-clock time on the reference development machine.
7. WHEN the Smoke_Trial ends, THE Stagger_App SHALL leave the Handle_Counter at its value before the Trial plus the cached model handle.
8. THE Stagger_App test suite SHALL use Vitest for examples and fast-check for properties, with each property test running at most 2 s of simulated time per Trial.
9. THE Stagger_App test suite SHALL name each test for the behaviour, for example `it('rejects a force without a unit')`.
10. THE Stagger_App test suite SHALL NOT weaken an assertion or a requirement to make a test pass, and SHALL explain in the commit message why a test was changed when it was wrong.
11. THE Stagger_App test suite SHALL include the parity test of Requirement 9 and the observation layout test of Requirement 7.
12. FOR ALL lines of the Requirements_File, formatting the compiled line and compiling the result again SHALL produce an equal `space` and equal `perturbations` (compile round-trip property).
13. FOR ALL Expected_Hold and Expected_Break lines, the sign of the robustness on a 0 N / nominal scenario SHALL be positive (nominal-scenario property).

### Requirement 19: Studio page

**User Story:** As a visitor, I want a page where I can see the G1 walk, shove it, and watch the falsifier summon ghosts, so that I understand what GOLEM does in 30 seconds.

#### Acceptance Criteria

1. THE Studio_Page SHALL be a Vite multi-page entry in `apps/stagger/web/` and SHALL use the stage, ghost swarm, floor aura, tablet and reel components from `golem-spec/ui`.
2. THE Studio_Page SHALL show the stage full-bleed, the tablet as a 380 px column at the left on viewports of 1024 px or wider, and the reel as a strip under the stage.
3. WHEN the viewport is narrower than 1024 px, THE Studio_Page SHALL show the stage at 56vh, then the primary actions, then the tablet, then the reel.
4. THE Studio_Page SHALL load the Requirements_File text from its own origin and SHALL show each line on the tablet with every quantity as an editable control.
5. WHEN a visitor changes a quantity on the tablet, THE Studio_Page SHALL recompile the line and re-run the test, and SHALL show the first visible change within 100 ms.
6. THE Studio_Page SHALL provide a button with the label `Shove` that applies a push to the pelvis of the visible G1, in the direction and with the force that the visitor chooses by dragging on the stage.
7. THE Studio_Page SHALL provide a button with the label `Summon 64 ghosts` that runs 64 trials in Web Workers through the `TrialPool` and shows each trial as a ghost.
8. THE Studio_Page SHALL show a ghost that broke in `--break` and fading, and a surviving ghost pale, as `design-language.md` defines.
9. THE Studio_Page SHALL show the aura on the floor as the measured maximum force survived per direction.
10. THE Studio_Page SHALL show the counterexample reel with the buttons `Replay the fall` and `Pin this seed`.
11. THE Studio_Page SHALL render the 3D scene only while simulating, dragging or replaying, and SHALL cap the pixel ratio at 1.5.
12. WHERE the user agent reports `prefers-reduced-motion`, THE Studio_Page SHALL show ghosts without the rise and SHALL step replays frame by frame.
13. THE Studio_Page SHALL run each simulation in a Web Worker with one MuJoCo instance and SHALL perform no network request except fetching static assets.
14. THE Studio_Page SHALL set `optimizeDeps.exclude` to `['@mujoco/mujoco']` in its Vite config.
15. THE Studio_Page SHALL use the colour tokens, typefaces and layout of `design-language.md` and SHALL carry no analytics and no tracker.
16. IF the model or the policy fails to load, THEN THE Studio_Page SHALL show a plain message that names the file that failed and tells the visitor to reload the page.

### Requirement 20: Studio copy

**User Story:** As a visitor, I want short, exact text that says what the G1 is, where its policy comes from and how to shove it, so that I trust what I am looking at.

#### Acceptance Criteria

1. THE Studio_Copy SHALL state that the robot is the Unitree G1 humanoid in its 12-DOF legs configuration, simulated in MuJoCo.
2. THE Studio_Copy SHALL state that the walking policy is Unitree's published pre-trained policy from `unitree_rl_gym`, run unchanged, and SHALL link to the Upstream_Repo and the Pinned_Commit.
3. THE Studio_Copy SHALL state that the model and the policy are BSD-3-Clause and SHALL link to `robot/LICENSE`.
4. THE Studio_Copy SHALL explain how to shove the robot: drag on the stage to pick a direction and a force, then press `Shove`.
5. THE Studio_Copy SHALL state that a pass means no counterexample was found within the stated number of trials, and not a proof.
6. THE Studio_Copy SHALL give units for every number and SHALL use sentence case.
7. THE Studio_Copy SHALL put any spooky wording in names and visuals only, and SHALL keep error messages and numbers plain.
8. WHEN a requirement is broken, THE Studio_Copy SHALL give a counterexample in the form `falls from <force> N at <angle> deg, <phase>% into the stride`, built from the shrunk scenario.
9. THE Studio_Copy SHALL show text of at most 72 characters per line of measure.
10. THE Studio_Copy SHALL contain no claim that the G1 or its policy is safe or certified.

### Requirement 21: Determinism, resource use and licences

**User Story:** As a maintainer, I want the app to keep the project-wide rules on determinism, handles and licences, so that every counterexample reproduces and the assets stay correctly attributed.

#### Acceptance Criteria

1. THE Stagger_App SHALL give a trial that is a pure function of the scenario, the requirement and the seed, with the seed used only for the initial joint noise.
2. WHEN the same (scenario, seed) runs twice in the Same Runtime, THE Stagger_App SHALL return a bit-identical Trace.
3. THE Stagger_App SHALL allocate nothing inside the physics step loop, and SHALL reuse typed arrays for observation, action, target, Policy_State, Latency_Buffer and signal ring buffers.
4. THE Stagger_App SHALL call `.delete()` on every MuJoCo handle it creates.
5. THE Stagger_App SHALL license its own code under Apache-2.0 and SHALL keep the Upstream_Repo's BSD-3-Clause notice in `robot/LICENSE`.
6. THE Stagger_App SHALL make no network request at runtime other than static assets of its own origin.
7. THE Stagger_App SHALL run on a single thread at a speed that allows a 5 s trial in about 0.6 s of CPU time on the reference development machine, and SHALL report the measured value in `evidence/`.
8. FOR ALL generated scenarios of the push, slope, payload, friction, latency and command perturbations, running a Trial and then reading the model arrays SHALL show no change in the cached model (no-side-effect property).
