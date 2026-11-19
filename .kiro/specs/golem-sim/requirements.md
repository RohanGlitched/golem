# Requirements Document

## Introduction

golem-sim is the simulation layer of the GOLEM skeleton, located in `skeleton/src/sim`. It loads MuJoCo WASM (`@mujoco/mujoco` 4.x) identically in Node and in browsers, writes a RobotApp's files into the MuJoCo virtual file system, compiles the model once per worker, and runs single trials. A trial is a pure function of (app, requirement, scenario, seed). It creates an MjData, seeds a PRNG, warms up under the controller, fires the trigger, applies perturbations at every simulation step, records a Trace at control rate (and optionally body poses at 30 fps), stops at the horizon or early, evaluates the monitor, releases every handle, and returns a TrialResult.

The module also provides a SimContext with name-to-id lookups, helpers for MuJoCo out-parameters, geom distance and contact iteration that guarantee `.delete()`, and a tiny inline MJCF test app so continuous integration needs no robot assets.

All TypeScript shapes named here (`RobotApp`, `Controller`, `SimContext`, `Trace`, `CompiledRequirement`, `PerturbationCall`, `PerturbationTemplate`, `TrialSpec`, `TrialResult`, `Scenario`) are the fixed contracts in `.kiro/steering/interfaces.md`. This spec may add fields but never renames or removes them.

Out of scope: the EARS parser and monitor compilation (`ears`), search and shrinking (`falsify`), worker scheduling (`pool`), rendering (`ui`), and any robot-specific controller or MJCF assets.

## Glossary

- **Sim_Module**: The code in `skeleton/src/sim` that this spec describes.
- **MuJoCo_Loader**: The Sim_Module component that loads the `@mujoco/mujoco` WASM module and returns the `mj` namespace.
- **Mj**: The loaded MuJoCo WASM namespace object returned by `load()`.
- **Model_Cache**: The per-worker store that holds one compiled MjModel for each RobotApp id.
- **Worker**: One Web Worker in the browser or one `worker_threads` thread in Node, holding exactly one Mj instance.
- **File_Writer**: The Sim_Module component that writes RobotApp files into the MuJoCo virtual file system.
- **Context_Builder**: The Sim_Module component that creates a SimContext and its name-to-id tables.
- **Episode_Runner**: The Sim_Module component that executes one trial and returns a TrialResult.
- **Trial**: One execution of the Episode_Runner for one TrialSpec.
- **Warm-up Phase**: The first `app.warmup` seconds of simulated time of a Trial, during which the controller runs and no perturbation is applied.
- **Trigger Time**: The simulated time, equal to `app.warmup`, at which the Episode_Runner records the `trigger` event.
- **Active Phase**: The simulated interval from the Trigger Time to `app.warmup + horizon`.
- **Horizon**: The `horizon` field of the CompiledRequirement, in seconds of simulated time after warm-up.
- **Sim_Step**: One call to `mj.mj_step` of duration `app.simDt`.
- **Control_Step**: One call to `controller.step`, occurring once every `app.controlDt` seconds of simulated time.
- **Control_Rate_Sample**: One entry of the Trace taken at a Control_Step.
- **Step_Loop**: The loop of Sim_Steps and Control_Steps inside a Trial.
- **Early_Stop_Hook**: A function supplied to the Episode_Runner that receives the partial Trace after each Control_Rate_Sample and returns either `undefined` (continue) or a decided robustness value.
- **Decided_Verdict**: A robustness sign that no continuation of the Trial can change, as reported by the Early_Stop_Hook.
- **Pose_Recorder**: The Sim_Module component that records body poses when `TrialSpec.record` is `'poses'`.
- **Pose_Frame**: One recorded frame holding `nbody × 7` float32 values, ordered per body as x, y, z, qw, qx, qy, qz.
- **Handle**: Any MuJoCo WASM object that requires `.delete()`, including MjModel, MjData, DoubleBuffer, MjvScene-like objects, and the vector returned by `data.contact`.
- **Handle_Counter**: A test-visible counter that increments when a Handle is created through the Sim_Module and decrements when that Handle is deleted.
- **Buffer_Helper**: The Sim_Module function that allocates a `DoubleBuffer` out-parameter, passes it to a callback, and deletes it afterwards.
- **Geom_Distance_Helper**: The Sim_Module function that returns the signed distance between two geoms through `mj_geomDistance`.
- **Contact_Iterator**: The Sim_Module function that reads `data.contact` once, visits each contact, and deletes the vector.
- **Test_App**: The inline MJCF RobotApp in the Sim_Module, containing a falling box and a pendulum, used by tests without external assets.
- **Trace**: The recording defined in `interfaces.md`, with `t`, `signals`, and `events`.
- **PRNG**: A seeded `mulberry32` or `splitmix32` pseudo-random number generator.
- **Bit-identical**: Equal at every IEEE-754 double or float value, compared by byte content, with `NaN` bit patterns equal.
- **Same Runtime**: The same Node or browser engine version, the same `@mujoco/mujoco` version, and the same machine architecture. A Node-versus-browser pair is not the Same Runtime; cross-runtime agreement is 1e-9 relative, per Requirement 1.11.
- **SI**: International System of Units, as used for every numeric value in Scenario and Trace.

## Requirements

### Requirement 1: Load MuJoCo WASM identically in Node and browsers

**User Story:** As a skeleton developer, I want one loading path for MuJoCo WASM that works in Node and in browsers, so that a trial gives the same behavior in both environments.

#### Acceptance Criteria

1. WHEN the MuJoCo_Loader is called, THE MuJoCo_Loader SHALL load `@mujoco/mujoco` through `import load from '@mujoco/mujoco'` and resolve with an Mj object that exposes `MjModel`, `MjData`, `mj_step`, `mj_name2id`, `mj_geomDistance`, `DoubleBuffer`, and `FS`.
2. THE MuJoCo_Loader SHALL expose the same function signature and the same returned type in Node (version 20 or later) and in browsers.
3. WHEN the MuJoCo_Loader is called more than once in the same Worker, THE MuJoCo_Loader SHALL return the same Mj object, compared by reference identity, without loading the WASM module again.
4. WHEN two or more calls to the MuJoCo_Loader overlap before the first call resolves, THE MuJoCo_Loader SHALL load the WASM module exactly once and resolve every overlapping call with the same Mj object.
5. IF loading the WASM module fails, THEN THE MuJoCo_Loader SHALL reject with an error whose message names the `@mujoco/mujoco` package and includes the message of the underlying cause.
6. IF loading the WASM module fails, THEN THE MuJoCo_Loader SHALL discard the failed attempt, so that the next call starts a new load. IF that load succeeds, THEN THE MuJoCo_Loader SHALL resolve with an Mj object.
7. IF loading the WASM module fails while other calls are waiting on the same attempt, THEN THE MuJoCo_Loader SHALL reject every waiting call with the same error.
8. THE MuJoCo_Loader SHALL make no network request except the fetch of static WASM assets.
9. WHEN the Mj object is loaded in Node for the first time in a process, THE MuJoCo_Loader SHALL resolve within 2 s of wall-clock time on the reference development machine. This 2 s limit applies to the Test_App, and the combined load-and-compile budget for a real robot app with meshes is 5 s, as stated in Requirement 3, criterion 12. CI tests (Requirement 15) check only the 2 s Test_App budget, because CI has no robot assets. The 5 s budget is checked by a benchmark in `evidence/`.
10. WHEN the MuJoCo_Loader is called after a successful load in the same Worker, THE MuJoCo_Loader SHALL resolve within 10 ms of wall-clock time.
11. WHEN the same Test_App TrialSpec runs in Node and in a browser on the same machine architecture with the same `@mujoco/mujoco` version, THE Episode_Runner SHALL return a Trace whose `t` values are bit-identical and whose `signals` values differ by no more than 1e-9 relative error.

### Requirement 2: Write RobotApp files into the MuJoCo file system

**User Story:** As a skeleton developer, I want a RobotApp's files written into the MuJoCo virtual file system quickly and correctly, so that the model compiler can read the scene and its meshes.

#### Acceptance Criteria

1. WHEN the File_Writer receives the result of `app.files()`, THE File_Writer SHALL create each parent directory under `/robot` with `mj.FS.mkdirTree` and write each file with `mj.FS.writeFile`.
2. THE File_Writer SHALL write files with `mj.FS.writeFile` and SHALL NOT use `MjVFS.addBuffer`.
3. WHEN a file path contains nested directories, THE File_Writer SHALL create every missing directory before writing the file.
4. THE File_Writer SHALL write each file so that reading it back with `mj.FS.readFile` returns bytes equal to the input bytes, including for a file of 0 bytes and for a file of 50 MiB.
5. WHEN a directory already exists, THE File_Writer SHALL continue without error.
6. IF a file path is empty, is absolute (starts with `/`, or with a drive letter followed by `:`), contains a `..` segment, contains an empty segment (`//`), or contains a backslash, THEN THE File_Writer SHALL reject with an error that names the offending path, SHALL write no file, and SHALL create no directory. This check SHALL cover every path in the files record before the first write, so that a bad path in any position leaves `/robot` unchanged.
7. IF `app.sceneFile` is not a key of the files record, THEN THE File_Writer SHALL reject with an error that names the missing scene file, and SHALL write no file and create no directory.
8. WHEN the File_Writer writes the same files a second time in the same Worker, THE File_Writer SHALL overwrite the existing files without error, and reading each file back SHALL return the bytes of the second write.
9. IF `mj.FS.mkdirTree` or `mj.FS.writeFile` throws, THEN THE File_Writer SHALL reject with an error that names the app id, the path being written, and the underlying cause.
10. WHEN the File_Writer receives an empty files record, THE File_Writer SHALL reject with an error that names the missing scene file, as in criterion 7.
11. WHEN the File_Writer receives a files record with N files, THE File_Writer SHALL write each file exactly once per call, and SHALL write files of one call in the order of the record's keys.
12. WHEN the File_Writer has written the files of an app with a total size of 20 MiB or less across 200 files or fewer, THE File_Writer SHALL complete within 500 ms on the reference development machine, excluding the time taken by `app.files()`.

### Requirement 3: Compile the model once per worker and reuse it

**User Story:** As a skeleton developer, I want the MjModel compiled once per Worker and reused across trials, so that trial cost excludes model compilation.

#### Acceptance Criteria

1. WHEN a Trial requests the model for an app id that is absent from the Model_Cache, THE Model_Cache SHALL call `app.files()` once, write the app files through the File_Writer, compile `/robot/<app.sceneFile>` with `mj.MjModel.from_xml_path`, store the resulting MjModel under that app id, and return it.
2. WHEN a Trial requests the model for an app id that is present in the Model_Cache, THE Model_Cache SHALL return the stored MjModel without calling `app.files()`, without writing to the MuJoCo virtual file system, and without calling `mj.MjModel.from_xml_path`.
3. WHEN two or more Trials for the same app id request the model in one Worker before the first compile finishes, THE Model_Cache SHALL call `mj.MjModel.from_xml_path` exactly once and resolve every request with the same MjModel object.
4. IF the File_Writer rejects or `mj.MjModel.from_xml_path` throws, THEN THE Model_Cache SHALL reject every pending request for that app id with an error that includes the app id and the underlying MuJoCo compiler or File_Writer message, SHALL store no entry for that app id, and SHALL leave the MjModel entries of other app ids unchanged.
5. WHEN a request for an app id follows a rejected compile of that app id, THE Model_Cache SHALL attempt the write and compile again.
6. IF a compile fails after `from_xml_path` has returned a partially created MjModel handle, THEN THE Model_Cache SHALL call `.delete()` on that handle exactly once, so that the Handle_Counter is unchanged by the failed compile.
7. WHEN the Model_Cache is disposed, THE Model_Cache SHALL call `.delete()` on every stored MjModel exactly once and SHALL empty itself.
8. WHEN a model is requested after the Model_Cache was disposed, THE Model_Cache SHALL treat every app id as absent and apply criterion 1.
9. THE Model_Cache SHALL hold at most one MjModel per app id per Worker and SHALL NOT share an MjModel across Workers.
10. THE Episode_Runner SHALL leave the cached MjModel unmodified by a Trial, so that the byte content of the model's `opt`, `body_mass`, `geom_friction`, and `actuator_gainprm` arrays is equal before and after any number of Trials, including Trials that end early, diverge, or throw.
11. WHERE a perturbation template alters a model parameter, THE Episode_Runner SHALL restore the parameter to its original value, byte-equal to the value before the Trial, before the Trial ends, including when the Trial ends early, diverges, or throws.
12. WHEN the first Trial request for an app id in a Node process reaches the Model_Cache, THE Model_Cache SHALL resolve the MjModel, measured from that first request to the resolved MjModel and including the first MuJoCo_Loader load in the process and the first compile through the Model_Cache, within 2 s of wall-clock time for the Test_App and within 5 s of wall-clock time for a real robot app with meshes (for example the Unitree G1, which takes about 3 s), on the reference development machine. CI tests check only the 2 s Test_App budget, and a benchmark in `evidence/` checks the 5 s robot-app budget.

### Requirement 4: Provide a SimContext with name-to-id lookups

**User Story:** As an app author, I want a SimContext with name-to-id tables, so that controllers and lexicons address bodies, geoms, sites, joints, and actuators by name.

#### Acceptance Criteria

1. WHEN the Context_Builder creates a SimContext from an Mj object, an MjModel, and an MjData, THE Context_Builder SHALL return an object with fields `mj`, `model`, `data`, and `ids` as defined in `interfaces.md`, where `mj`, `model`, and `data` are the same object references that were passed in.
2. THE Context_Builder SHALL resolve names with `mj.mj_name2id(model, mj.mjtObj.<type>.value, name)` using the `.value` of the enum.
3. THE Context_Builder SHALL provide lookup functions for exactly the object types body, geom, site, joint, and actuator.
4. WHEN a lookup is called with a name that exists in the model, THE Context_Builder SHALL return the integer id of that object, in the range 0 to (number of objects of that type − 1).
5. IF a lookup is called with a name that does not exist in the model, THEN THE Context_Builder SHALL throw an error that names the object type and the missing name, and SHALL leave `ctx.ids` unchanged.
6. THE Context_Builder SHALL fill `ctx.ids` with the id of each name that the app declares, keyed as `<type>:<name>` (for example `body:bob`).
7. WHEN the same name of the same type is looked up twice, THE Context_Builder SHALL return the same id both times.
8. THE Context_Builder SHALL resolve every name that the app declares before the Step_Loop starts, so that the Step_Loop performs zero calls to `mj.mj_name2id`.
9. IF the app declares a name that does not exist in the model, THEN THE Context_Builder SHALL throw the error described in criterion 5 during SimContext creation, before the Step_Loop starts and before any Sim_Step runs.
10. WHEN a lookup is called with an empty string, THE Context_Builder SHALL throw an error that names the object type and states that the name is empty, and SHALL NOT call `mj.mj_name2id`.
11. WHEN a lookup is called with a name that exists in the model only under a different object type, THE Context_Builder SHALL throw the error described in criterion 5 for the requested type.

### Requirement 5: Initialise a Trial and run the warm-up

**User Story:** As a falsification engineer, I want each Trial to start from a seeded state and warm up under the controller, so that the perturbation hits a robot in a realistic, reproducible condition.

#### Acceptance Criteria

1. WHEN the Episode_Runner starts a Trial, THE Episode_Runner SHALL create exactly one MjData from the cached MjModel, and SHALL create it only after every validation check of Requirements 5, 6, 7, and 14 has passed.
2. WHEN the Episode_Runner starts a Trial, THE Episode_Runner SHALL create a PRNG from `TrialSpec.seed` using `mulberry32` or `splitmix32`, so that the first 1000 values drawn are equal for equal seeds.
3. THE Episode_Runner SHALL use no `Math.random()` call anywhere in the Sim_Module.
4. WHERE `app.initState` is defined, THE Episode_Runner SHALL call `app.initState(ctx, rng)` exactly once, after creating the MjData and before the first Sim_Step.
5. WHEN the Episode_Runner starts a Trial, THE Episode_Runner SHALL call `app.makeController(ctx, rng)` exactly once, after `app.initState` when it is defined and before the first Sim_Step, passing the same PRNG instance that `app.initState` received.
6. THE Episode_Runner SHALL draw values from the PRNG in a fixed order that depends only on the app, so that two Trials with equal TrialSpec values draw bit-identical sequences, and SHALL draw no value from the PRNG outside `app.initState`, `app.makeController`, and the controller.
7. WHILE the simulated time is less than `app.warmup`, THE Episode_Runner SHALL call `controller.step` at every Control_Step, SHALL run the physics at every Sim_Step, and SHALL call no `template.apply` and write no nonzero value into `data.xfrc_applied`.
8. WHILE the Episode_Runner is in the Warm-up Phase, THE Episode_Runner SHALL record no Control_Rate_Sample, so that the Trace contains no `t` value less than `app.warmup`.
9. WHEN the simulated time reaches `app.warmup`, THE Episode_Runner SHALL have run exactly `round(app.warmup / app.simDt)` Sim_Steps and exactly `round(app.warmup / app.controlDt)` Control_Steps.
10. IF `app.initState` throws, THEN THE Episode_Runner SHALL delete the MjData and reject with the thrown error, and SHALL leave the Handle_Counter at its value before the Trial.
11. IF `app.makeController` throws, THEN THE Episode_Runner SHALL delete the MjData and reject with the thrown error, and SHALL leave the Handle_Counter at its value before the Trial.
12. IF `TrialSpec.app` does not equal `app.id`, THEN THE Episode_Runner SHALL reject with an error that names both ids before creating any MjData.
13. IF `app.warmup` is not a finite number greater than or equal to 0, or is not an integer multiple of `app.controlDt` within a relative tolerance of 1e-9, THEN THE Episode_Runner SHALL reject with an error that names the warm-up value in seconds before creating any MjData.
14. IF `TrialSpec.seed` is not an integer in the range 0 to 4294967295, THEN THE Episode_Runner SHALL reject with an error that names the seed before creating any MjData.

### Requirement 6: Fire the trigger and apply perturbations

**User Story:** As a falsification engineer, I want the trigger to fire at a known time and every perturbation applied from the scenario values, so that a counterexample reproduces exactly.

#### Acceptance Criteria

1. WHEN the simulated time reaches `app.warmup`, THE Episode_Runner SHALL append the event `{ name: 'trigger', t: app.warmup }` to the Trace events before the first Control_Rate_Sample is stored and before the first perturbation call.
2. THE Episode_Runner SHALL record exactly one `trigger` event per Trial, including a Trial that stops early or ends with a `diverged` event after the Trigger Time.
3. WHILE the Trial is in the Active Phase, THE Episode_Runner SHALL call `template.apply(ctx, t, tTrigger, values)` for each PerturbationCall at every Sim_Step, passing `t` as the simulated time at the start of that Sim_Step and `tTrigger` equal to `app.warmup`.
4. WHILE the Trial is in the Warm-up Phase, THE Episode_Runner SHALL make zero calls to `template.apply`.
5. WHEN the Episode_Runner builds `values` for a PerturbationCall, THE Episode_Runner SHALL map each param whose value is a string to `scenario[<string>]` in SI units (after wrapping per Requirement 14.7) and SHALL pass each numeric param unchanged.
6. THE Episode_Runner SHALL build `values` for each PerturbationCall once before the Step_Loop and SHALL reuse the same object for every Sim_Step, so that the `values` object passed at the last Sim_Step is the same object, with equal contents, as at the first Sim_Step.
7. WHEN the Episode_Runner applies several PerturbationCalls in one Sim_Step, THE Episode_Runner SHALL apply them in the order of the `perturbations` array, and SHALL make no call to `mj.mj_step` between them.
8. WHEN the Episode_Runner starts the Active Phase, THE Episode_Runner SHALL set every element of `data.xfrc_applied` to 0 before the first perturbation call.
9. WHEN a Sim_Step begins, THE Episode_Runner SHALL set every element of `data.xfrc_applied` to 0 before the perturbations of that Sim_Step are applied, so that no force or torque carries over from a previous Sim_Step. Forces written by several PerturbationCalls in the same Sim_Step to the same body SHALL be the values that each template wrote, in array order, and the Episode_Runner SHALL NOT clear between them.
10. WHEN the Active Phase ends or the Trial stops early, THE Episode_Runner SHALL make no further `template.apply` call, and SHALL leave `data.xfrc_applied` without effect on any later Trial, because each Trial creates a new MjData.
11. IF a param string names a dimension that is absent from the Scenario, THEN THE Episode_Runner SHALL reject with an error that names the PerturbationCall template and the missing dimension before creating any MjData, and SHALL record no `trigger` event.
12. IF a PerturbationCall names a template that is absent from `app.lexicon.perturbations`, THEN THE Episode_Runner SHALL reject with an error that names the template before creating any MjData, and SHALL record no `trigger` event.
13. IF `template.apply` throws, THEN THE Episode_Runner SHALL delete the MjData, restore any model parameter that the template altered (Requirement 3.11), and reject with the thrown error.
14. WHERE `requirement.perturbations` is an empty array, THE Episode_Runner SHALL still record the `trigger` event once at `app.warmup`, make no `template.apply` call, and keep `data.xfrc_applied` at 0 for the whole Active Phase.

### Requirement 7: Run the controller and record the Trace at control rate

**User Story:** As a monitor author, I want a Trace sampled at control rate with every app signal, so that monitors can compute robustness from it.

#### Acceptance Criteria

1. THE Episode_Runner SHALL call `controller.step(ctx, t)` exactly once at the start of each Control_Step, where each Control_Step spans `n = round(app.controlDt / app.simDt)` Sim_Steps and `t` equals the simulated time at the start of that Control_Step.
2. IF `app.controlDt` is not an integer multiple of `app.simDt` within a relative tolerance of 1e-9, or either value is not a finite number greater than 0 s, THEN THE Episode_Runner SHALL reject with an error that names both values in seconds before creating any MjData.
3. THE Episode_Runner SHALL keep `data.ctrl` unchanged across the `n` Sim_Steps of one Control_Step, so that the values of `data.ctrl` after the first and after the last Sim_Step of that Control_Step are Bit-identical.
4. WHILE the Trial is in the Active Phase, THE Episode_Runner SHALL call `app.signals(ctx, out)` exactly once per Control_Step, before the Sim_Steps of that Control_Step, and store each value of `out` into the Trace signal of the same name at the index of that Control_Rate_Sample.
5. THE Episode_Runner SHALL store the first Control_Rate_Sample at `t = app.warmup` and each following sample `app.controlDt` later.
6. THE Episode_Runner SHALL return a Trace in which `t` and every array in `signals` have the same length, and every signal named in `out` on the first Control_Rate_Sample has one entry per Control_Rate_Sample.
7. WHEN a Trial runs to its full Horizon, THE Episode_Runner SHALL return a Trace whose length equals `round(horizon / app.controlDt) + 1`, where the extra sample is the one at `t = app.warmup`.
8. THE Episode_Runner SHALL allocate the Trace arrays once before the Step_Loop, with length `round(horizon / app.controlDt) + 1`, and SHALL return arrays trimmed to the number of recorded samples.
9. THE Episode_Runner SHALL store `t` values as `app.warmup + k * app.controlDt` for sample index `k`, computed by multiplication and not by accumulation, so that each stored value is Bit-identical to that expression evaluated in IEEE-754 double precision.
10. IF `app.signals` writes a non-finite value (`NaN`, `+Infinity`, or `-Infinity`) for a signal, THEN THE Episode_Runner SHALL store the value unchanged, SHALL NOT stop the Trial for that reason alone, and SHALL still return a Trace.
11. IF `data.qpos` contains a non-finite value after a Sim_Step, THEN THE Episode_Runner SHALL stop the Trial after that Sim_Step, record the event `{ name: 'diverged', t }` with `t` equal to the simulated time after that Sim_Step, and set `robustness` to `-Infinity`.
12. WHEN the Trial stops because of a `diverged` event, THE Episode_Runner SHALL return a Trace whose `t` and `signals` arrays hold only the Control_Rate_Samples recorded before the divergence, with equal lengths, and whose `events` contain exactly one `diverged` event.
13. IF `app.signals` or `controller.step` throws, THEN THE Episode_Runner SHALL delete the MjData and reject with the thrown error, as required by Requirement 14.

### Requirement 8: Record body poses for ghosts

**User Story:** As a UI developer, I want optional body poses at 30 fps, so that the ghost swarm can replay a Trial.

#### Acceptance Criteria

1. WHERE `TrialSpec.record` is `'poses'`, THE Pose_Recorder SHALL record one Pose_Frame at the Trigger Time and, after that, one further Pose_Frame at the first Control_Step whose simulated time is at least 1/30 s (0.0333 s) after the previous Pose_Frame, up to the Trial end.
2. WHERE `TrialSpec.record` is `'poses'`, THE Pose_Recorder SHALL return `poses` in the TrialResult with `fps` equal to 30, `nbody` equal to `model.nbody`, and `frames` as a `Float32Array`.
3. THE Pose_Recorder SHALL store each Pose_Frame as `nbody × 7` values, per body in the order x (m), y (m), z (m), qw, qx, qy, qz, read from `data.xpos` and `data.xquat` and converted to float32 without any other transformation.
4. THE Pose_Recorder SHALL return a `frames` array whose length equals `nbody × 7 × frameCount`, where `frameCount` is the number of Pose_Frames recorded and is at least 1 for a Trial that reaches the Trigger Time.
5. THE Pose_Recorder SHALL allocate the frame storage once before the Step_Loop, sized for `floor(horizon × 30) + 2` frames, and SHALL grow no array during the Step_Loop.
6. WHERE `TrialSpec.record` is `'none'` or absent, THE Episode_Runner SHALL return a TrialResult without the `poses` field and SHALL allocate no frame storage.
7. THE Pose_Recorder SHALL leave `robustness`, `worstAt`, and the Trace (`t`, every array in `signals`, and `events`) Bit-identical to a Trial of the same TrialSpec with `record` set to `'none'`.
8. WHEN a Trial stops early, including a stop caused by the Early_Stop_Hook or a `diverged` event, THE Pose_Recorder SHALL return only the frames recorded up to the stop, with `frames.length` equal to `nbody × 7 × frameCount`, and SHALL include no frame for a time after the stop.
9. THE Pose_Recorder SHALL record no Pose_Frame during the Warm-up Phase.
10. WHEN the same TrialSpec with `record` set to `'poses'` runs twice in the Same Runtime, THE Pose_Recorder SHALL return Bit-identical `frames`.
11. IF a `data.xpos` or `data.xquat` value is non-finite at a Pose_Frame, THEN THE Pose_Recorder SHALL store the value unchanged and SHALL still return the TrialResult.

### Requirement 9: Stop at the horizon or early, evaluate the monitor, and return the result

**User Story:** As a falsification engineer, I want a Trial to stop as soon as its outcome is decided, so that search budgets buy more trials without changing any verdict.

#### Acceptance Criteria

1. THE Episode_Runner SHALL end a Trial no later than the simulated time `app.warmup + horizon`.
2. WHERE an Early_Stop_Hook is supplied, THE Episode_Runner SHALL call it exactly once after each Control_Rate_Sample, with the partial Trace containing all samples recorded so far.
3. WHEN the Early_Stop_Hook returns a number, THE Episode_Runner SHALL treat it as a decided robustness value and SHALL stop the Step_Loop after the current Control_Step, before running any further Sim_Step.
4. WHEN the Early_Stop_Hook returns `undefined`, THE Episode_Runner SHALL continue the Step_Loop.
5. WHEN a Trial ends, THE Episode_Runner SHALL call `requirement.monitor(trace)` exactly once on the recorded Trace, trimmed to the recorded samples, and SHALL place `robustness`, `worstAt`, and `unit` from the monitor result in the TrialResult.
6. WHEN a Trial stops early, THE Episode_Runner SHALL report the same sign of robustness as the same Trial run to its full Horizon without the hook.
7. WHEN a Trial stops early and the Early_Stop_Hook decided a violation with value `v`, THE Episode_Runner SHALL report a robustness less than or equal to `v`. WHEN it decided satisfaction with value `v`, THE Episode_Runner SHALL report a robustness greater than or equal to `v`. The comparison SHALL use the monitor's unit and no tolerance.
8. WHERE no Early_Stop_Hook is supplied, THE Episode_Runner SHALL run every Trial to its full Horizon, unless a `diverged` event ends it sooner.
9. THE Episode_Runner SHALL return `TrialResult.spec` equal to the TrialSpec received, by deep equality of every field, and `wallMs` as the wall-clock duration of the Trial in milliseconds, measured from the start of the Trial to the return of the result. `wallMs` SHALL be a finite number greater than or equal to 0.
10. WHEN a Trial ends normally, early, with divergence, or with an error, THE Episode_Runner SHALL call `.delete()` on the MjData exactly once.
11. IF `requirement.monitor` throws, THEN THE Episode_Runner SHALL delete the MjData and reject with the thrown error, and SHALL return no TrialResult.
12. IF the Early_Stop_Hook throws, THEN THE Episode_Runner SHALL delete the MjData and reject with the thrown error, and SHALL not call `requirement.monitor`.
13. IF a Trial ends because of a `diverged` event, THEN THE Episode_Runner SHALL still call `requirement.monitor(trace)` once on the Trace recorded up to the divergence, SHALL return the TrialResult with `robustness` equal to `-Infinity`, `worstAt` equal to the simulated time of the divergence in seconds, and `unit` taken from the monitor result.
14. IF the Early_Stop_Hook returns a value that is not a number or `undefined`, or returns `NaN`, THEN THE Episode_Runner SHALL delete the MjData and reject with an error that names the returned value and states that a finite number or `undefined` is required.
15. WHEN the Early_Stop_Hook returns a decided value at the final Control_Rate_Sample at `t = app.warmup + horizon`, THE Episode_Runner SHALL end the Trial at that sample and SHALL apply the same reporting rules as criteria 6 and 7.

### Requirement 10: Handle helpers with guaranteed deletion and no leaks

**User Story:** As a skeleton developer, I want helpers for out-parameters, geom distance, and contacts that always delete their handles, so that long campaigns do not leak WASM memory.

#### Acceptance Criteria

1. WHEN the Buffer_Helper is called with an integer length `n` of 1 or more and a callback, THE Buffer_Helper SHALL create `new mj.DoubleBuffer(new Array(n).fill(0))`, call the callback once with the buffer, and return the callback result.
2. THE Buffer_Helper SHALL call `.delete()` on the DoubleBuffer exactly once after the callback returns.
3. IF the callback throws, THEN THE Buffer_Helper SHALL call `.delete()` on the DoubleBuffer exactly once and rethrow the same error.
4. IF `n` is not an integer of 1 or more, THEN THE Buffer_Helper SHALL throw an error that names the invalid length before creating any DoubleBuffer and before calling the callback.
5. WHEN a callback returns data read from `buffer.getView()`, THE Buffer_Helper SHALL require the callback to copy that data before returning, and SHALL document that the view is invalid after `.delete()`.
6. WHEN the Geom_Distance_Helper is called with two geom ids and a maximum distance in meters, THE Geom_Distance_Helper SHALL call `mj_geomDistance` with a `fromto` buffer of length 6 and return the signed distance in meters.
7. WHEN the Geom_Distance_Helper is called with the option to return the nearest points, THE Geom_Distance_Helper SHALL return the six `fromto` values copied into a new array that stays valid after the buffer is deleted.
8. THE Geom_Distance_Helper SHALL delete the `fromto` buffer exactly once, on both normal return and on throw.
9. WHEN the Contact_Iterator is called, THE Contact_Iterator SHALL read `data.contact` once, call the visitor once for each contact index from 0 to `data.ncon - 1` in ascending order, and call `.delete()` on the contact vector exactly once.
10. WHEN `data.ncon` is 0, THE Contact_Iterator SHALL call the visitor zero times and SHALL still call `.delete()` on the contact vector exactly once.
11. IF the visitor throws, THEN THE Contact_Iterator SHALL call `.delete()` on the contact vector exactly once and rethrow the same error.
12. THE Sim_Module SHALL create every Handle through functions that increment the Handle_Counter by 1 and SHALL delete every Handle through functions that decrement it by 1.
13. THE Sim_Module SHALL expose the Handle_Counter for tests as a function that returns the number of live Handles as a non-negative integer.
14. WHEN a Trial ends normally, early, with divergence, or with an error, THE Sim_Module SHALL leave the Handle_Counter equal to its value before the Trial plus the number of cached MjModel handles added by the Model_Cache.
15. WHEN the Model_Cache is disposed after any number of Trials, THE Sim_Module SHALL leave the Handle_Counter equal to its value before the first Trial.
16. IF `.delete()` is requested a second time on a Handle that the Sim_Module already deleted, THEN THE Sim_Module SHALL make no second WASM `.delete()` call and SHALL leave the Handle_Counter unchanged.

### Requirement 11: Bit-identical determinism

**User Story:** As a falsification engineer, I want the same TrialSpec to give the same Trace every time, so that every counterexample reproduces on demand.

#### Acceptance Criteria

1. WHEN the Episode_Runner runs the same TrialSpec twice in the Same Runtime with the same app, requirement, and Early_Stop_Hook, THE Episode_Runner SHALL return Bit-identical `t`, Bit-identical `signals` (same signal names, same lengths, and the same bytes in every array), and `events` equal in length, order, `name`, and Bit-identical `t`.
2. WHEN the Episode_Runner runs the same TrialSpec twice in the Same Runtime, THE Episode_Runner SHALL return the same `robustness`, `worstAt`, and `unit`, with `robustness` and `worstAt` compared as Bit-identical doubles.
3. WHEN the Episode_Runner runs the same TrialSpec twice in the Same Runtime with `record` set to `'poses'`, THE Episode_Runner SHALL return Bit-identical `poses.frames` with equal `poses.fps` and `poses.nbody`.
4. WHEN one or more other Trials, including Trials of a different app, a different requirement, or a different seed, run between two runs of the same TrialSpec in one Worker, THE Episode_Runner SHALL return Bit-identical results for the two runs.
5. WHEN a Trial ends with an error and the same TrialSpec is run again in the same Worker, THE Episode_Runner SHALL return a result Bit-identical to the result of a run in a fresh Worker.
6. WHEN the same TrialSpec runs in two different Workers in the Same Runtime, THE Episode_Runner SHALL return Bit-identical results.
7. THE Episode_Runner SHALL reset `data` by creating a new MjData for each Trial and SHALL carry no mutable state from one Trial to the next, apart from the cached MjModel, which Requirement 3, criterion 10 requires to stay unmodified.
8. THE Episode_Runner SHALL exclude `wallMs` from the determinism guarantee, and SHALL include in the guarantee every other field of TrialResult.
9. WHEN two TrialSpec values differ only in `seed` and the app's `initState` or controller draws from the PRNG, THE Episode_Runner SHALL be free to return different results, and WHEN neither draws from the PRNG, THE Episode_Runner SHALL return Bit-identical results for both seeds.
10. THE Episode_Runner SHALL derive every random number in a Trial from the PRNG created from `TrialSpec.seed`, and SHALL read no wall-clock time, `Math.random()`, or other source of nondeterminism in any code path that affects `signals`, `events`, `robustness`, `worstAt`, or `poses`.
11. IF a TrialSpec is run in a different runtime (a different Node or browser engine version, `@mujoco/mujoco` version, or machine architecture) from an earlier run, THEN THE Episode_Runner SHALL make no Bit-identical guarantee.

### Requirement 12: No allocation inside the Step_Loop

**User Story:** As a performance engineer, I want the Step_Loop to allocate nothing, so that a Trial runs at full speed and without garbage-collection pauses.

#### Acceptance Criteria

1. THE Episode_Runner SHALL allocate the signal output object, the `values` objects, the Trace arrays, the Pose_Frame storage, and the data views listed in criterion 4 before the Step_Loop starts.
2. WHILE the Step_Loop runs, THE Episode_Runner SHALL create no new object, array, typed array, closure, or string in code owned by the Sim_Module.
3. WHILE the Step_Loop runs, THE Episode_Runner SHALL reuse the same `out` object for every call to `app.signals`, so that the object identity is equal across all Control_Steps of a Trial.
4. WHILE the Step_Loop runs, THE Episode_Runner SHALL read `data.qpos`, `data.qvel`, `data.ctrl`, `data.xfrc_applied`, `data.xpos`, and `data.xquat` through views obtained before the Step_Loop, and SHALL NOT read those fields through a property getter that creates a new view.
5. WHILE the Step_Loop runs, THE Episode_Runner SHALL create no MuJoCo Handle, so that the Handle_Counter value is the same before and after every Sim_Step and Control_Step.
6. WHEN a test runs a Trial of the Test_App with a probe wrapped around `mj.mj_step` and `controller.step`, THE Episode_Runner SHALL cause zero Handle creations inside the Step_Loop, as shown by an unchanged Handle_Counter, and SHALL cause zero new `Float64Array` or `Float32Array` instances inside the Step_Loop, as counted by a probe on the typed-array constructors.
7. WHEN the Trace arrays and Pose_Frame storage are allocated, THE Episode_Runner SHALL size the Trace arrays to `round(horizon / app.controlDt) + 1` samples and the Pose_Frame storage to `model.nbody × 7 × (floor(horizon × 30) + 2)` float32 values, and SHALL grow no array during the Step_Loop.
8. WHEN `view.buffer` identity at the start of a Control_Step differs from its identity at the previous Control_Step, THE Episode_Runner SHALL re-read the data views before the next call to `mj.mj_step`, outside the physics call, and SHALL produce the same Trace as a Trial in which WASM memory does not grow.
9. WHEN a test compares the heap size of a Test_App Trial with a horizon of 1.5 s before and after the Step_Loop, with forced garbage collection at both points, THE Episode_Runner SHALL leave the JavaScript heap growth attributable to the Step_Loop at or below 64 KiB.

### Requirement 13: Inline test app for CI

**User Story:** As a contributor, I want a tiny inline MJCF app in the sim module, so that CI runs sim tests without any robot assets.

#### Acceptance Criteria

1. THE Sim_Module SHALL export a Test_App that implements the `RobotApp` interface from `interfaces.md`, with `id` equal to `'test'` and a non-empty `name`.
2. THE Test_App SHALL define its MJCF as an inline string in source and return it from `files()` as `Uint8Array` bytes under the key given by `sceneFile`, and `files()` SHALL return exactly one entry.
3. WHEN the MJCF of the Test_App is compiled with `mj.MjModel.from_xml_path`, THE Test_App SHALL produce a model that contains a free-falling box body named `box` (with a free joint), a hinged pendulum body named `bob`, a hinge joint named `hinge` on `bob`, and a motor actuator named `drive` on `hinge`.
4. THE Test_App SHALL set `simDt` to 0.002 s, `controlDt` to 0.02 s, and `warmup` to 0.2 s, and the MJCF `timestep` SHALL equal `simDt`.
5. THE Test_App SHALL declare in its lexicon the signals `box.z` in meters (the world z position of `box`), `bob.angle` in radians (the `hinge` angle), and `bob.speed` in radians per second (the `hinge` velocity), and `app.signals` SHALL write a finite value for each of the three names at every Control_Step of a Trial with no perturbation.
6. THE Test_App SHALL provide a controller that writes a proportional-derivative torque to `drive` from the `hinge` angle and velocity, with the torque clamped to the actuator `ctrlrange`, and that reads no value other than the `hinge` angle, the `hinge` velocity, and constant gains.
7. THE Test_App SHALL provide a PerturbationTemplate in its lexicon that applies a force with a magnitude in newtons, a duration in seconds, and a direction angle in radians (horizontal plane) to the body `bob` through `data.xfrc_applied`, with the force equal to zero outside `[Trigger Time, Trigger Time + duration)`.
8. WHERE `app.initState` is called, THE Test_App SHALL set the initial `hinge` angle to a value drawn from the PRNG, uniformly within ±0.1 rad, using exactly one PRNG draw.
9. WHEN a Trial of the Test_App runs for 2 s of simulated time or less, THE Episode_Runner SHALL complete the Trial in under 1 s of wall-clock time on the reference development machine, with the model already present in the Model_Cache.
10. THE Test_App SHALL import no module from outside `skeleton/src/sim`, other than `@mujoco/mujoco` types and the contract types in `interfaces.md`, SHALL read no file from disk, and SHALL use no network access.
11. IF the PerturbationTemplate of the Test_App is applied with a force magnitude of 0 N, THEN THE Test_App SHALL leave `data.xfrc_applied` equal to zero for every Sim_Step, so that the Trace equals that of a Trial without the PerturbationCall.

### Requirement 14: Errors are descriptive and handles survive them

**User Story:** As an agent user, I want clear errors that say what broke and where, so that I can fix an app or a requirement without reading sim internals.

#### Acceptance Criteria

1. IF any step of a Trial throws after the Episode_Runner has created an MjData, THEN THE Episode_Runner SHALL call `.delete()` exactly once on every Handle created by that Trial before it rejects, and SHALL leave the Handle_Counter at its value before the Trial plus the number of MjModel handles added to the Model_Cache by that Trial.
2. IF the Episode_Runner raises an error for a Trial, THEN THE Episode_Runner SHALL include the app id, the requirement id, and the decimal seed value in the error message.
3. IF the Episode_Runner raises an error for a Trial, THEN THE Episode_Runner SHALL preserve the underlying thrown error as the error's `cause`.
4. IF a TrialSpec carries a Scenario that omits a dimension present in `requirement.space.dims`, THEN THE Episode_Runner SHALL reject with an error that names every missing dimension before creating any MjData.
5. IF a Scenario value is not a finite number, THEN THE Episode_Runner SHALL reject with an error that names the dimension and the value before creating any MjData.
6. IF a Scenario value lies outside `[min, max]` of its Dimension by more than 1e-9 in relative error (relative to `max(|min|, |max|)`, or to an absolute 1e-9 when both bounds are 0) and the Dimension has `wrap` not set to true, THEN THE Episode_Runner SHALL reject with an error that names the dimension, the value, and the range in SI units before creating any MjData.
7. WHERE a Dimension has `wrap` set to true, THE Episode_Runner SHALL wrap the Scenario value into `[min, max)` before applying any perturbation, and SHALL NOT reject a finite value for lying outside `[min, max]`.
8. IF a Scenario value lies outside `[min, max]` by 1e-9 relative error or less, THEN THE Episode_Runner SHALL clamp the value into `[min, max]` and SHALL NOT reject the Trial.
9. IF `requirement.horizon` is not a finite number greater than 0, THEN THE Episode_Runner SHALL reject with an error that names the horizon and its value before creating any MjData.
10. IF an error is raised before an MjData is created, THEN THE Episode_Runner SHALL leave the Handle_Counter unchanged and SHALL leave the Model_Cache contents unchanged.
11. THE Sim_Module SHALL write error messages in plain language, with every physical quantity given in SI units with its unit symbol, and without decorative text, emoji, or stack traces in the message.

### Requirement 15: Property tests for the Sim_Module

**User Story:** As a maintainer, I want property tests on the Sim_Module's core guarantees, so that regressions in determinism, trace shape, trigger timing, and early stop are caught in CI.

#### Acceptance Criteria

1. THE Sim_Module test suite SHALL use Vitest for example tests and fast-check for property tests, SHALL run each Trial with a simulated duration of at most 2 s (`app.warmup + horizon`), and SHALL run each fast-check property with at least 25 generated cases and a fixed, logged fast-check seed so that a failing case reproduces.
2. FOR ALL generated Test_App TrialSpec values, running the Episode_Runner twice in the Same Runtime SHALL produce Bit-identical `t`, `signals`, `events`, `robustness`, and `worstAt` (determinism property).
3. FOR ALL generated Test_App TrialSpec values and Horizon values from 0.2 s to 1.5 s in steps of `controlDt`, a full-length Trial SHALL return a Trace in which `t.length` equals `round(horizon / controlDt) + 1` and every array in `signals` has length `t.length` (trace-length property).
4. FOR ALL generated Test_App TrialSpec values, the Trace SHALL contain exactly one `trigger` event and its `t` SHALL equal `app.warmup` (trigger-time property).
5. FOR ALL generated Test_App TrialSpec values and a deterministic Early_Stop_Hook, WHEN the hook returned a decided value, THE sign of `robustness` from the early-stopped Trial SHALL equal the sign of `robustness` from the same Trial run without the hook (early-stop soundness property).
6. FOR ALL generated Test_App TrialSpec values, including values that make the Trial throw, diverge, or stop early, running the Trial SHALL leave the Handle_Counter at its value before the Trial plus the number of cached MjModel handles added by the Model_Cache (no-leak property).
7. FOR ALL generated byte maps with valid relative paths (no leading `/`, no `..` segment, no backslash, 1 to 5 segments, 0 to 4096 bytes per file, 1 to 10 files), writing them with the File_Writer and reading each file back SHALL return bytes equal to the input (file round-trip property).
8. FOR ALL generated Test_App TrialSpec values, a Trial with `record` set to `'poses'` SHALL return a `frames` length equal to `nbody × 7 × frameCount` and a `robustness` and `worstAt` Bit-identical to those of the Trial with `record` set to `'none'` (pose-recording invariance property).
9. FOR ALL generated Scenario values and the Test_App perturbation, `robustness` SHALL be a finite number unless the Trace contains a `diverged` event, in which case `robustness` SHALL equal `-Infinity` (finite-robustness property).
10. THE Sim_Module test suite SHALL include at least one example test for each error condition named in Requirements 1, 2, 3, 4, 5, 6, 7, 9, 10, and 14, and each example test SHALL assert that the error message contains the identifiers that the corresponding criterion requires.
11. IF a test fails, THEN THE Sim_Module test suite SHALL report the failing TrialSpec, including app id, requirement id, scenario values, and seed, so that the failure reproduces with the same TrialSpec.
