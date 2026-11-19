# Requirements Document

## Introduction

candy-app is app 2 of GOLEM, located in `apps/candy`. It is a Franka Emika Panda arm with a suction cup that sorts Halloween candy into three bowls by colour on a doorstep table, while trick-or-treaters' hands reach into the workspace. It is the second consumer of the skeleton and shows that the same EARS-to-physics pipeline works on a manipulator with a human-safety requirement, not only on a walking robot.

The app is a self-contained package with its own `package.json`, `robot/`, `controller/`, `lexicon.ts`, `app.ts`, `scripts/`, `web/`, and `.kiro/`. It imports the skeleton only through the public entry points `golem-spec`, `golem-spec/ui`, and `golem-spec/node`.

The app consists of:

1. An asset script that fetches the MuJoCo Menagerie `franka_emika_panda` model at a pinned commit, simplifies its meshes, and writes `scene.xml`.
2. A suction cup model with a force-based hold, applied through `xfrc_applied`.
3. A controller made of damped-least-squares inverse kinematics, a pick-and-place state machine, and speed-and-separation monitoring version 1 (v1).
4. A lexicon of signals, predicates, and perturbations.
5. A `RobotApp` definition in `app.ts`.
6. The app's own EARS requirements in `apps/candy/.kiro/specs/candy-sorter/requirements.md`.
7. A studio page in `web/` built on `golem-spec/ui`, where a visitor can also drag the hand into the workspace.

Speed-and-separation monitoring v1 deliberately measures the distance from the hand to the suction cup only, as a typical first implementation would. The app does not add any other distance check in v1. GOLEM is expected to find out whether that is enough. A broken safety requirement against v1 is an intended and valid outcome of this spec, and no requirement, test, or monitor may be weakened to hide it.

All TypeScript shapes named here (`RobotApp`, `Controller`, `SimContext`, `Lexicon`, `PredicateTemplate`, `PerturbationTemplate`, `Dimension`, `Scenario`, `Quantity`, `Trace`, `CompiledRequirement`) are the fixed contracts in `.kiro/steering/interfaces.md`. This spec may add fields but never renames or removes them.

Out of scope: the skeleton modules `ears`, `sim`, `falsify`, `pool`, `ui`, `cli`, and `mcp`; the Unitree G1 app; the landing site; and any hardware control of a real Panda arm.

## Glossary

- **Candy_App**: The package in `apps/candy` that this spec describes.
- **Panda**: The Franka Emika Panda 7-joint arm from MuJoCo Menagerie `franka_emika_panda`, loaded from `panda_nohand.xml`.
- **Menagerie_Commit**: The pinned git commit hash of MuJoCo Menagerie from which the Asset_Script downloads files.
- **Asset_Script**: The script `apps/candy/scripts/fetch-assets.mjs`.
- **Scene**: The MJCF file `robot/scene.xml` that the Asset_Script writes.
- **Table**: The static box geom named `table` on which the work happens.
- **Tray**: The rectangular area of the Table where candies spawn.
- **Bowl**: One of three open containers named `bowl_orange`, `bowl_purple`, and `bowl_green`, each built from box and cylinder geoms.
- **Candy**: A free body, in the Scene, shaped as a box, a sphere, or a capsule, with a mass from 0.005 kg to 0.060 kg and one colour from orange, purple, and green.
- **Candy_Count**: The number of Candies in one Trial, from 1 to 6.
- **Home_Pose**: The fixed joint configuration of the Panda from which each pick-and-place cycle starts and to which it returns.
- **Hand**: The mocap body named `hand`, made of a sphere palm geom and a capsule forearm geom, that represents a trick-or-treater's hand.
- **Hand_Geoms**: The palm and forearm geoms of the Hand.
- **Workspace**: The box-shaped region above the Table that contains the Tray, the three Bowls, and the reachable area of the Panda tip. Its bounds are defined in the design.
- **Hand_In_Workspace**: The state in which the centre of the palm geom lies inside the Workspace.
- **Suction_Cup**: The cylinder tool body attached to the Panda flange, with a site named `tip`.
- **Tip**: The site named `tip` at the free end of the Suction_Cup.
- **Suction_Switch**: The binary controller output that turns suction on or off.
- **Suction_Engage_Radius**: The distance of 0.01 m between the Tip and a Candy centre or surface point within which the suction force acts. The design defines which point is used.
- **Holding_Force**: The maximum magnitude in newtons of the suction force. The default is 3 N.
- **Vacuum_Ratio**: The factor from 0 to 1 that multiplies the Holding_Force. The value 1 means full vacuum.
- **Suction_Force**: The spring-damper force that pulls a Candy toward the Tip, capped at Holding_Force multiplied by Vacuum_Ratio, and applied through `data.xfrc_applied`.
- **IK_Solver**: The damped-least-squares inverse kinematics component in `controller/` that computes joint position targets for the Tip.
- **Jacobian_Buffer**: A `DoubleBuffer` out-parameter used with `mj_jacSite`, as described in `mujoco-wasm.md`.
- **Pick_Place_Machine**: The finite state machine that sequences candy selection, approach, descent, suction on, lift, transfer, release, and return.
- **SSM_v1**: Speed-and-separation monitoring version 1, the component that scales the commanded Tip speed using the distance between the Tip and the nearest Hand_Geom only.
- **Slowdown_Distance**: The Tip-to-hand distance of 0.40 m at and below which SSM_v1 starts reducing the commanded Tip speed.
- **Stop_Distance**: The Tip-to-hand distance of 0.15 m at and below which SSM_v1 commands zero Tip speed.
- **Speed_Scale**: The factor from 0 to 1 that SSM_v1 multiplies with the nominal Tip speed.
- **Tracker_Lag**: The delay in seconds between the true Hand position and the Hand position that the controller reads.
- **Candy_Controller**: The `Controller` that combines the IK_Solver, the Pick_Place_Machine, and SSM_v1.
- **Candy_Lexicon**: The `Lexicon` exported from `lexicon.ts`.
- **Candy_Signals**: The signals named `min_link_hand_distance`, `fastest_link_speed`, `tip_speed`, `candies_sorted`, `candies_misplaced`, `candies_dropped_outside`, `table_force`, and `hand_in_workspace`.
- **Arm_Collision_Geoms**: The collision geoms of the Panda links and the Suction_Cup.
- **Candy_Requirements_File**: The file `apps/candy/.kiro/specs/candy-sorter/requirements.md`.
- **Candy_App_Definition**: The `RobotApp` object exported from `app.ts`.
- **Studio_Page**: The browser page in `apps/candy/web/` built with `golem-spec/ui`.
- **Hand_Drag**: The mouse or touch interaction in the Studio_Page that moves the Hand.
- **Skeleton_Public_API**: The entry points `golem-spec`, `golem-spec/ui`, and `golem-spec/node`.
- **Trial**: One run of the Episode_Runner for one `TrialSpec`, as defined in `golem-sim`.
- **Mj**: The loaded MuJoCo WASM namespace object.
- **Handle**: Any MuJoCo WASM object that requires `.delete()`.
- **PRNG**: A seeded `mulberry32` or `splitmix32` pseudo-random number generator.
- **SI**: International System of Units, as used for every numeric value in Scenario and Trace.
- **Suction_Model**: The component in `controller/` or `app.ts` that computes the Suction_Force each Sim_Step.
- **Episode_Runner**, **Sim_Step**, **Control_Step**, **Step_Loop**, **Horizon**, **Trigger Time**, **Buffer_Helper**, **Geom_Distance_Helper**, **Contact_Iterator**, **Handle_Counter**, **Bit-identical**, **Same Runtime**: As defined in the `golem-sim` spec.
- **Reachable_Point**: A point for which at least one joint configuration within the Panda joint limits places the Tip at that point, with the Suction_Cup axis pointing downward within 5°.

## Requirements

### Requirement 1: Fetch and prepare Panda assets reproducibly

**User Story:** As a contributor, I want one script that fetches and simplifies the Panda model at a pinned commit, so that any machine can rebuild `robot/` and get the same files.

#### Acceptance Criteria

1. THE Asset_Script SHALL download the files of `franka_emika_panda` from MuJoCo Menagerie at the Menagerie_Commit, where the Menagerie_Commit is a full 40-character git hash stored as a constant in the script.
2. WHEN the Asset_Script finishes, THE Asset_Script SHALL copy the Menagerie LICENSE file for `franka_emika_panda` to `apps/candy/robot/LICENSE`.
3. THE Asset_Script SHALL write the Panda model from `panda_nohand.xml` and SHALL NOT include the Menagerie gripper.
4. THE Asset_Script SHALL simplify each visual mesh with meshoptimizer to at most 3000 faces.
5. THE Asset_Script SHALL keep each collision mesh at no more than 200 faces and SHALL store the collision meshes as convex hulls.
6. WHEN the Asset_Script runs twice with the same Menagerie_Commit and the same script version, THE Asset_Script SHALL produce byte-identical files in `apps/candy/robot/`.
7. WHEN every file that the Asset_Script would write already exists with the expected content hash, THE Asset_Script SHALL skip the download and report that the assets are current.
8. IF a download fails or returns a non-success status, THEN THE Asset_Script SHALL exit with a non-zero code and print the URL, the status, and the file path that failed, and SHALL leave previously written valid files unchanged.
9. IF a downloaded file does not match the content hash recorded in the script, THEN THE Asset_Script SHALL exit with a non-zero code and print the file path and both hashes.
10. THE Asset_Script SHALL write generated files only under `apps/candy/robot/`.
11. THE Asset_Script SHALL run on Node 20 or later with no Python dependency.
12. THE Asset_Script SHALL perform network access only during an explicit run of the script and never at application runtime.

### Requirement 2: Generate the scene

**User Story:** As an app author, I want a generated `scene.xml` with a table, tray, bowls, candies, and a mocap hand, so that every Trial starts from the same physical setup.

#### Acceptance Criteria

1. WHEN the Asset_Script finishes, THE Asset_Script SHALL write `robot/scene.xml` that includes the Panda model, the Suction_Cup, the Table, the Tray, three Bowls, six Candies, and the Hand.
2. THE Scene SHALL define the three Bowls with the names `bowl_orange`, `bowl_purple`, and `bowl_green`, each built from box and cylinder geoms only.
3. THE Scene SHALL define six Candy bodies named `candy_0` to `candy_5`, each a free body with one geom shaped as a box, a sphere, or a capsule, and with a mass from 0.005 kg to 0.060 kg.
4. THE Scene SHALL define the Hand as a mocap body named `hand` with a sphere palm geom and a capsule forearm geom.
5. THE Scene SHALL place the Hand at its start pose outside the Workspace, at a distance of at least 1.0 m from the Tip when the Panda is at the Home_Pose.
6. THE Scene SHALL define the Table as a static box geom named `table`.
7. THE Scene SHALL define a site named `tip` on the Suction_Cup.
8. THE Scene SHALL contain position actuators for the seven Panda joints taken from the Menagerie model, and SHALL contain no actuator for the Suction_Cup.
9. THE Scene SHALL assign each geom a collision group so that the Candies collide with the Table, the Bowls, and the Suction_Cup, and so that the Hand_Geoms collide with no other geom.
10. WHEN `mj.MjModel.from_xml_path('/robot/scene.xml')` compiles the Scene after the files are written to `/robot`, THE Scene SHALL compile without error.
11. THE Scene SHALL use a simulation time step `opt.timestep` of 0.002 s.
12. THE Asset_Script SHALL make the Scene reproducible, so that the same script version writes a byte-identical `scene.xml`.
13. THE Scene SHALL load in Node in under 4 s on the reference development machine.
14. THE Scene SHALL give each Candy a colour through its geom `rgba` value that matches exactly one of the three Bowls.

### Requirement 3: Suction cup physics

**User Story:** As a robotics engineer, I want a suction cup that holds a candy with a limited force, so that fast moves and heavy candies can shake it loose and GOLEM can find those failures.

#### Acceptance Criteria

1. THE Suction_Cup SHALL be a cylinder body attached to the Panda flange and SHALL carry the site `tip` at its free end.
2. WHILE the Suction_Switch is on, WHEN the distance from the Tip to a Candy is at most the Suction_Engage_Radius of 0.01 m, THE Suction_Model SHALL apply a Suction_Force to that Candy through `data.xfrc_applied`, directed from the Candy toward the Tip, in every Sim_Step in which that distance holds.
3. THE Suction_Model SHALL compute the Suction_Force as a spring-damper term, `F = k·(p_tip − p_candy) + c·(v_tip − v_candy)`, on the position and velocity error between the Tip and the Candy, with the stiffness `k` in N/m and the damping `c` in N·s/m defined in the design, before the limit in criterion 4 is applied.
4. THE Suction_Model SHALL limit the magnitude of the Suction_Force to the Holding_Force multiplied by the Vacuum_Ratio, so that the magnitude never exceeds that product in any Sim_Step, and SHALL keep the direction of the force unchanged when it scales the magnitude down.
5. THE Suction_Model SHALL use a Holding_Force of 3 N by default.
6. WHEN the Suction_Switch is turned off, THE Suction_Model SHALL apply no Suction_Force from the next Sim_Step on, so that the Suction_Force on every Candy is exactly 0 N from that Sim_Step on.
7. WHILE the Suction_Switch is off, THE Suction_Model SHALL apply no Suction_Force to any Candy.
8. WHILE the Suction_Switch is on, THE Suction_Model SHALL apply the Suction_Force to at most one Candy, the one nearest to the Tip, and SHALL choose the Candy with the lower index when two Candies are at equal distance.
9. WHEN a Candy has a mass of 0.020 kg and the Tip moves at 0.5 m/s with the Suction_Switch on and the Vacuum_Ratio equal to 1, THE Suction_Model SHALL keep the Candy within the Suction_Engage_Radius of the Tip for the whole move, up to a Tip acceleration of 5 m/s².
10. WHEN the force needed to keep a Candy at the Tip exceeds the Holding_Force multiplied by the Vacuum_Ratio, THE Suction_Model SHALL let the Candy move relative to the Tip, with the applied Suction_Force staying at the limit of criterion 4.
11. WHERE the Vacuum_Ratio is less than 1, THE Suction_Model SHALL reduce the maximum Suction_Force in proportion to the Vacuum_Ratio, so that a Vacuum_Ratio of 0.5 gives a maximum of 1.5 N at the default Holding_Force.
12. IF the Vacuum_Ratio is outside [0, 1] or is not finite, THEN THE Suction_Model SHALL clamp the value into [0, 1], treating a non-finite value as 0, and SHALL record a warning that names the original value, and SHALL continue the Trial without throwing.
13. THE Suction_Model SHALL zero its contribution to `data.xfrc_applied` for every body at the start of each Sim_Step before it adds the Suction_Force, in a way that preserves forces that other perturbations add after it in the same Sim_Step.
14. THE Suction_Model SHALL perform its per-Sim_Step work with no object, array, or closure allocation.
15. THE Suction_Model SHALL compute the Suction_Force as a pure function of the Trial state, the Suction_Switch, the Vacuum_Ratio, and simulated time, with no wall-clock read and no random draw, so that the same inputs give a Bit-identical force.
### Requirement 4: Inverse kinematics on the tip

**User Story:** As a controller author, I want damped-least-squares inverse kinematics on the Tip, so that the state machine can command Cartesian targets and the Panda actuators receive joint position targets.

#### Acceptance Criteria

1. WHEN the IK_Solver receives a target position for the Tip, THE IK_Solver SHALL compute the Tip Jacobian with `mj_jacSite` using a Jacobian_Buffer and SHALL delete the Jacobian_Buffer after reading it.
2. THE IK_Solver SHALL compute joint updates with the damped-least-squares formula, using a damping factor that the design defines.
3. THE IK_Solver SHALL output joint position targets that the Candy_Controller writes to the position actuators of the seven Panda joints in `data.ctrl`.
4. THE IK_Solver SHALL clamp each joint position target to the joint limits of the Panda model.
5. WHEN the target is a Reachable_Point, THE IK_Solver SHALL converge to a Tip position error of at most 1 mm in at most 200 iterations.
6. IF the target is not a Reachable_Point, THEN THE IK_Solver SHALL stop after at most 200 iterations and return the joint targets that give the smallest Tip position error found, together with that error in meters.
7. WHEN the IK_Solver runs twice with the same target and the same start joint configuration, THE IK_Solver SHALL return Bit-identical joint targets.
8. THE IK_Solver SHALL keep the Suction_Cup axis pointing downward within 5° when the target is a Reachable_Point.
9. THE IK_Solver SHALL perform its iterations on a copy of the joint positions and SHALL leave `data.qpos` unchanged.
10. THE IK_Solver SHALL allocate its working arrays once at construction and SHALL allocate nothing inside an iteration.
11. IF `mj_jacSite` yields a non-finite value, THEN THE IK_Solver SHALL return the start joint configuration and an error value of `Infinity`.
12. WHEN the damped-least-squares update is near a singular configuration, THE IK_Solver SHALL return joint updates with each joint step no larger than the per-iteration step limit that the design defines.

### Requirement 5: Pick-and-place state machine

**User Story:** As a user of the demo, I want the arm to pick candies one by one and put each in the bowl of its colour, so that the table is sorted without human help.

#### Acceptance Criteria

1. WHEN the Trial starts, THE Pick_Place_Machine SHALL start in the state `idle` with the Panda at the Home_Pose.
2. WHILE at least one Candy lies on the Tray, WHEN the Pick_Place_Machine is in the state `idle`, THE Pick_Place_Machine SHALL choose the next Candy on the Tray by a rule that the design defines and that depends only on Candy positions and ids.
3. WHEN the Pick_Place_Machine has chosen a Candy, THE Pick_Place_Machine SHALL move the Tip to a point 0.10 m above the Candy centre.
4. WHEN the Tip is within 0.01 m of the point above the Candy, THE Pick_Place_Machine SHALL descend until the Tip reaches the Suction_Engage_Radius of the Candy.
5. WHEN the Tip reaches the Suction_Engage_Radius of the Candy, THE Pick_Place_Machine SHALL turn the Suction_Switch on.
6. WHEN the Suction_Switch has been on for 0.3 s, THE Pick_Place_Machine SHALL lift the Tip to 0.15 m above the Table surface.
7. WHEN the Tip is lifted, THE Pick_Place_Machine SHALL move the Tip to a point 0.10 m above the centre of the Bowl whose colour equals the colour of the Candy.
8. WHEN the Tip is within 0.01 m of the point above the Bowl, THE Pick_Place_Machine SHALL turn the Suction_Switch off.
9. WHEN the Suction_Switch has been off for 0.3 s after release, THE Pick_Place_Machine SHALL move the Panda to the Home_Pose and return to the state `idle`.
10. WHILE no Candy lies on the Tray, THE Pick_Place_Machine SHALL stay in the state `idle` with the Panda at the Home_Pose.
11. IF the Candy leaves the Suction_Engage_Radius of the Tip while the Pick_Place_Machine is in a state between suction on and release, THEN THE Pick_Place_Machine SHALL turn the Suction_Switch off, return to the state `idle`, and treat the Candy as a new candidate.
12. IF the IK_Solver reports a Tip error of more than 0.005 m for a target, THEN THE Pick_Place_Machine SHALL skip the Candy for the rest of the Trial and return to the state `idle`.
13. THE Pick_Place_Machine SHALL define each of its states and each transition in a table that a test can enumerate.
14. THE Pick_Place_Machine SHALL leave the state machine free of any wall-clock read, so that transitions depend only on simulated time and on the signals.
15. THE Pick_Place_Machine SHALL use no `Math.random()` call, and SHALL draw every random number from the PRNG passed to `makeController`.

### Requirement 6: Speed-and-separation monitoring v1

**User Story:** As a safety engineer, I want the arm to slow down and stop when a hand is near the suction cup, so that a first version of speed-and-separation safety exists for GOLEM to test.

#### Acceptance Criteria

1. THE SSM_v1 SHALL compute the separation distance as the distance between the Tip and the nearest Hand_Geom, using the Hand position that the controller reads.
2. THE SSM_v1 SHALL use no distance from any Panda link other than the Suction_Cup Tip, and the Candy_App SHALL add no other distance check in v1.
3. WHILE the separation distance is greater than the Slowdown_Distance of 0.40 m, THE SSM_v1 SHALL set the Speed_Scale to 1.
4. WHILE the separation distance is between the Stop_Distance of 0.15 m and the Slowdown_Distance of 0.40 m, THE SSM_v1 SHALL set the Speed_Scale to `(d − 0.15 m) / (0.40 m − 0.15 m)`, where `d` is the separation distance in meters.
5. WHILE the separation distance is at most the Stop_Distance of 0.15 m, THE SSM_v1 SHALL set the Speed_Scale to 0.
6. THE Candy_Controller SHALL multiply the nominal Tip speed by the Speed_Scale before it commands the IK_Solver target step.
7. WHEN the Speed_Scale is 0, THE Candy_Controller SHALL hold the Tip at its current position and keep the Suction_Switch unchanged.
8. THE SSM_v1 SHALL be a monotone function of the separation distance, so that a larger distance never gives a smaller Speed_Scale.
9. THE Candy_Controller SHALL read the Hand position through a delay line of length Tracker_Lag, so that SSM_v1 uses the Hand position from Tracker_Lag seconds earlier.
10. WHEN Tracker_Lag is 0 s, THE Candy_Controller SHALL read the current Hand position.
11. WHEN the Hand position that the controller reads is not finite, THE SSM_v1 SHALL set the Speed_Scale to 0.
12. THE SSM_v1 SHALL document in its source header that it measures from the Suction_Cup Tip only, and that this is the known limit of v1.

### Requirement 7: Signals

**User Story:** As a monitor author, I want measured signals for task success and for human safety, so that GOLEM monitors can compute robustness in physical units.

#### Acceptance Criteria

1. WHEN `signals(ctx, out)` is called, THE Candy_App_Definition SHALL write the signals `min_link_hand_distance`, `fastest_link_speed`, `tip_speed`, `candies_sorted`, `candies_misplaced`, `candies_dropped_outside`, `table_force`, and `hand_in_workspace` into `out`.
2. THE signal `min_link_hand_distance` SHALL equal the minimum over every Arm_Collision_Geom and every Hand_Geom of the signed distance from `mj_geomDistance`, in meters, measured on the true Hand position and not on the delayed Hand position.
3. THE signal `fastest_link_speed` SHALL equal the maximum, over every Panda link body and the Suction_Cup, of the Euclidean norm of the body's linear velocity at its centre of mass, in meters per second.
4. THE signal `tip_speed` SHALL equal the Euclidean norm of the linear velocity of the site `tip`, in meters per second.
5. THE signal `candies_sorted` SHALL equal the count of Candies that rest inside the Bowl whose colour equals the Candy colour.
6. THE signal `candies_misplaced` SHALL equal the count of Candies that rest inside a Bowl whose colour differs from the Candy colour.
7. THE signal `candies_dropped_outside` SHALL equal the count of Candies that lie outside every Bowl and have left the Tray, including Candies on the floor.
8. THE signal `table_force` SHALL equal the sum of the normal contact forces, in newtons, between Arm_Collision_Geoms and the Table geom.
9. THE signal `hand_in_workspace` SHALL equal 1 while Hand_In_Workspace holds and 0 otherwise.
10. THE Candy_App_Definition SHALL read contacts through the Contact_Iterator of `golem-sim` or an equivalent that reads `data.contact` once and deletes it.
11. THE Candy_App_Definition SHALL read the Hand_Geoms and the Arm_Collision_Geoms ids from `ctx.ids`, resolved before the Step_Loop.
12. THE Candy_App_Definition SHALL obtain the `fromto` buffers for `mj_geomDistance` through the Buffer_Helper or the Geom_Distance_Helper of `golem-sim`, and SHALL delete every buffer it creates.
13. WHEN a Candy has a speed of more than 0.05 m/s, THE Candy_App_Definition SHALL leave that Candy out of the counts `candies_sorted` and `candies_misplaced`, so that only resting Candies count.
14. WHEN there is no Hand_Geom within the `distmax` value of `mj_geomDistance`, THE signal `min_link_hand_distance` SHALL equal `distmax`, in meters, where `distmax` is 0.6 m.

### Requirement 8: Predicates in the lexicon

**User Story:** As a requirement author, I want the five response phrases of the app in the lexicon with typed slots and physical margins, so that EARS lines compile into monitors.

#### Acceptance Criteria

1. THE Candy_Lexicon SHALL list the robot names `arm`, `Panda`, and `robot` in `robotNames`.
2. THE Candy_Lexicon SHALL define the predicate `drop every candy into the bowl of its colour within {duration}`, which reads `candies_sorted`, `candies_misplaced`, and `candies_dropped_outside`.
3. THE margin of the predicate `drop every candy into the bowl of its colour within {duration}` SHALL be positive when every Candy of the Trial rests in the Bowl of its colour at the end of the window and no Candy is misplaced or dropped outside, and SHALL be negative otherwise, with unit `candies`, and with the magnitude equal to the number of Candies that are not sorted at the end of the window.
4. THE Candy_Lexicon SHALL define the predicate `keep every link at least {length} from the hand`, which reads `min_link_hand_distance`.
5. THE margin of the predicate `keep every link at least {length} from the hand` SHALL equal `min_link_hand_distance − length`, with unit `m`.
6. THE Candy_Lexicon SHALL define the predicate `keep its fastest link below {speed}`, which reads `fastest_link_speed`.
7. THE margin of the predicate `keep its fastest link below {speed}` SHALL equal `speed − fastest_link_speed`, with unit `m/s`.
8. THE Candy_Lexicon SHALL define the predicate `not drop a candy outside the bowls`, which reads `candies_dropped_outside`.
9. THE margin of the predicate `not drop a candy outside the bowls` SHALL equal `0.5 − candies_dropped_outside`, with unit `candies`, so that the margin is positive only when the count is 0.
10. THE Candy_Lexicon SHALL define the predicate `never press on the table with more than {force}`, which reads `table_force`.
11. THE margin of the predicate `never press on the table with more than {force}` SHALL equal `force − table_force`, with unit `N`.
12. THE margin of every predicate SHALL be a pure function of the signal values and the slot values, with no wall-clock read and no random draw.
13. WHEN a predicate margin function receives a non-finite signal value, THE margin function SHALL return `-Infinity`.
14. THE Candy_Lexicon SHALL define the predicates so that the margin is monotone non-increasing in the signal that the phrase bounds from above, and monotone non-decreasing in the signal that the phrase bounds from below.
15. FOR ALL valid slot values, raising the threshold of the predicate `keep every link at least {length} from the hand` SHALL never raise its margin, and raising the threshold of the predicate `keep its fastest link below {speed}` SHALL never lower its margin (monotonicity property).

### Requirement 9: Perturbations in the lexicon

**User Story:** As a falsification engineer, I want hands, heavy candies, weak vacuum, tracker lag, and random candy placement as searchable perturbations, so that GOLEM can look for the worst believable doorstep.

#### Acceptance Criteria

1. THE Candy_Lexicon SHALL define the perturbation `a hand reaches in from {direction} at {range:speed}`.
2. WHEN the perturbation `a hand reaches in from {direction} at {range:speed}` applies, THE perturbation SHALL move the Hand along a mocap path from the Table edge on the side given by `{direction}` toward the nearest Bowl.
3. THE perturbation `a hand reaches in from {direction} at {range:speed}` SHALL expose these Dimensions: `hand.angle` of kind `angle` with `wrap` true when the direction is `any direction`, `hand.speed` of kind `speed` with severity `up`, `hand.entry` of kind `duration` with a range of 0 s to the Horizon of the requirement, and `hand.height` of kind `length` with a range of 0.05 m to 0.25 m above the Table surface.
4. WHEN the entry time `hand.entry` after the Trigger Time is reached, THE perturbation SHALL start the Hand motion, and WHILE the entry time has not been reached, THE perturbation SHALL keep the Hand at its start pose.
5. THE perturbation SHALL set the mocap position of the Hand at every Sim_Step as a function of `t`, `tTrigger`, and the values, so that the path is the same for equal values.
6. WHEN the Hand reaches the nearest Bowl, THE perturbation SHALL hold the Hand there for the rest of the Trial.
7. THE Candy_Lexicon SHALL define the perturbation `the candies weigh {range:mass}`.
8. THE perturbation `the candies weigh {range:mass}` SHALL expose a Dimension `candy.mass` of kind `mass` with severity `up`, and SHALL set the mass of every Candy in the Trial to that value before the first Sim_Step.
9. WHEN the perturbation `the candies weigh {range:mass}` alters a model mass or inertia, THE perturbation SHALL restore the original values before the Trial ends, as required by `golem-sim`.
10. THE Candy_Lexicon SHALL define the perturbation `the vacuum weakens to {ratio}`, which sets the Vacuum_Ratio to the given ratio, with a Dimension `vacuum.ratio` of kind `ratio` and severity `down`.
11. THE Candy_Lexicon SHALL define the perturbation `the hand tracker lags by {range:duration}`, with a Dimension `tracker.lag` of kind `duration` and severity `up`, that sets the Tracker_Lag.
12. THE perturbation `the hand tracker lags by {range:duration}` SHALL change only what the Candy_Controller reads and SHALL leave the true Hand position unchanged.
13. THE Candy_Lexicon SHALL define the perturbation `candies land anywhere on the tray`, with one pair of Dimensions `candy.<i>.x` and `candy.<i>.y` of kind `length` for each Candy index `i` from 0 to 5, each ranging over the Tray bounds, and severity `none`.
14. WHEN the perturbation `candies land anywhere on the tray` applies, THE perturbation SHALL place each Candy at its given position before the first Sim_Step.
15. WHEN two Candies would overlap at their given positions, THE perturbation SHALL shift the later Candy along +x in steps of 0.01 m until no overlap remains, with a rule that depends only on the values.
16. IF a Scenario value for a perturbation lies outside its Dimension range, THEN THE perturbation SHALL clamp the value into the range, so that the apply function never throws for a validated Scenario.
17. THE perturbation `apply` functions SHALL perform their per-Sim_Step work with no object, array, or closure allocation.
18. WHERE a requirement names none of the perturbations `the candies weigh {range:mass}`, `the vacuum weakens to {ratio}`, and `the hand tracker lags by {range:duration}`, THE Candy_App_Definition SHALL use the defaults of 0.020 kg candy mass, Vacuum_Ratio 1, and Tracker_Lag 0 s.

### Requirement 10: The RobotApp definition

**User Story:** As a skeleton user, I want `app.ts` to export a `RobotApp` for the candy sorter, so that the CLI, the pool, and the UI can run it like any other app.

#### Acceptance Criteria

1. THE Candy_App_Definition SHALL implement the `RobotApp` interface from `interfaces.md` with `id` equal to `candy`.
2. THE Candy_App_Definition SHALL return from `files()` a record of the files under `apps/candy/robot/`, keyed by the path under `/robot`, as `Uint8Array` bytes.
3. THE Candy_App_Definition SHALL set `sceneFile` to `scene.xml`.
4. THE Candy_App_Definition SHALL set `simDt` to 0.002 s, `controlDt` to 0.02 s, and `warmup` to 1.0 s.
5. THE Candy_App_Definition SHALL expose the Candy_Lexicon as `lexicon`.
6. WHEN `makeController(ctx, rng)` is called, THE Candy_App_Definition SHALL return a Candy_Controller that uses the passed PRNG and holds no state outside the instance.
7. WHERE `initState` is called, THE Candy_App_Definition SHALL place the Panda at the Home_Pose, place each Candy at a position on the Tray that is drawn from the PRNG, and assign each Candy a colour from the PRNG.
8. THE Candy_App_Definition SHALL draw from the PRNG in a fixed order that depends only on the app, so that equal seeds give equal states.
9. THE Candy_App_Definition SHALL use no `Math.random()` call.
10. THE Candy_App_Definition SHALL import only from the Skeleton_Public_API and never from a deep path under `skeleton/src/`.
11. THE Candy_App_Definition SHALL load in the browser and in Node through the same `app.ts` module.
12. WHEN the same `TrialSpec` runs twice in the Same Runtime with the Candy_App_Definition, THE Episode_Runner SHALL return Bit-identical `t`, `signals`, `events`, `robustness`, and `worstAt`.
13. THE Candy_App_Definition SHALL create no Handle that outlives a Trial.

### Requirement 11: The app's own EARS requirements

**User Story:** As a robotics engineer, I want the sorter's written requirements in a Kiro spec, so that GOLEM turns them into physics tests and produces a report tied to each line.

#### Acceptance Criteria

1. THE Candy_Requirements_File SHALL exist at `apps/candy/.kiro/specs/candy-sorter/requirements.md` in the standard Kiro format, with an Introduction, a Glossary, and numbered Requirements, each with a user story and EARS acceptance criteria.
2. THE Candy_Requirements_File SHALL contain at least one acceptance criterion that uses the predicate `keep every link at least {length} from the hand` with the perturbation `a hand reaches in from {direction} at {range:speed}`.
3. THE Candy_Requirements_File SHALL contain at least one acceptance criterion that uses the predicate `drop every candy into the bowl of its colour within {duration}` with the perturbation `candies land anywhere on the tray`.
4. THE Candy_Requirements_File SHALL contain at least one acceptance criterion for each of these themes: separation distance from the hand, fastest link speed near the hand, table contact force, candies dropped outside the bowls, sorting success, tolerance to heavier candies, tolerance to weaker vacuum, and tolerance to a lagging hand tracker.
5. THE Candy_Requirements_File SHALL give every number a unit from the list in `ears-for-robots.md`, except counts of candies.
6. THE Candy_Requirements_File SHALL put the harshest believable value in each trigger, so that the falsifier finds the boundary.
7. THE Candy_Requirements_File SHALL contain one behaviour per line and SHALL start each acceptance criterion with its requirement id.
8. WHEN `golem check` runs on the Candy_Requirements_File with the Candy_App_Definition, THE `golem check` command SHALL compile every acceptance criterion without a compile error.
9. THE Candy_Requirements_File SHALL include the harshest believable values of the perturbations as its trigger ranges, with a hand speed of up to 1.5 m/s, a Candy mass of 0.005 kg to 0.060 kg, a Vacuum_Ratio of 0.5 to 1, and a Tracker_Lag of up to 0.3 s.
10. THE Candy_Requirements_File SHALL NOT be changed to make a failing GOLEM run pass, and a failing line SHALL lead to a controller change or an entry in `proposals.md`.
11. IF a line of the Candy_Requirements_File matches no template of the Candy_Lexicon, THEN THE compiler SHALL report a compile error with the closest template as a suggestion, as defined in `golem-ears`.
12. THE Candy_Requirements_File SHALL allow the line `keep every link at least 0.10 m from the hand` to fail against SSM_v1 when the falsifier finds a counterexample, and the report SHALL show it as broken.

### Requirement 12: The studio page

**User Story:** As a visitor, I want a studio page where I can watch the arm sort candy, drag a hand into its way, and see GOLEM's ghost trials, so that I understand what the requirements test.

#### Acceptance Criteria

1. THE Studio_Page SHALL be a Vite page under `apps/candy/web/` that imports the skeleton only from `golem-spec/ui` and `golem-spec`.
2. THE Studio_Page SHALL render the Scene with the skeleton three.js stage in the "Vltava clay at midnight" design language, using the tokens in `design-language.md`.
3. THE Studio_Page SHALL show the Candy_Requirements_File lines as a tablet in which every quantity with a unit is an editable control.
4. WHEN a visitor changes a quantity on the tablet, THE Studio_Page SHALL re-run the affected test and update the line within 100 ms for the visible response, even if the full result needs longer.
5. THE Studio_Page SHALL let a visitor move the Hand with a mouse drag on the stage.
6. THE Studio_Page SHALL let a visitor move the Hand with a touch drag on the stage.
7. WHILE a visitor drags the Hand, THE Studio_Page SHALL move the Hand mocap target on the Table plane at a height that the visitor can set from 0.05 m to 0.25 m above the Table, and SHALL clamp the target to a region of at most 1.5 m around the Table centre.
8. WHEN the visitor releases the Hand, THE Studio_Page SHALL leave the Hand at the release position until the visitor moves it again or presses the reset button.
9. WHILE the visitor drags the Hand, THE Studio_Page SHALL limit the Hand speed to 3 m/s so that the physics stays stable.
10. THE Studio_Page SHALL show the live values of `min_link_hand_distance`, `tip_speed`, and `candies_sorted`.
11. WHEN a Trial in the falsifier ends in a failure, THE Studio_Page SHALL show its ghost in `--break` colour and let the visitor replay it.
12. THE Studio_Page SHALL render on demand, only while the simulation runs, the visitor drags, or a replay runs, with a pixel ratio of at most 1.5.
13. WHERE the visitor's browser sets `prefers-reduced-motion`, THE Studio_Page SHALL show ghosts without the rise animation and step replays frame by frame.
14. THE Studio_Page SHALL run on a phone, with the stage at 56vh and the primary actions directly under it.
15. THE Studio_Page SHALL use no network access except the fetch of static assets, and SHALL include no analytics or tracker.
16. THE Studio_Page SHALL show errors in plain sentence case that say what broke and how to fix it.
17. THE Studio_Page SHALL provide a keyboard-operable control that moves the Hand in steps of 0.05 m, so that the page is usable without a pointer.

### Requirement 13: Package structure and dependency boundaries

**User Story:** As a maintainer, I want the app to follow the repository structure and depend only on public entry points, so that the skeleton can change internally without breaking the app.

#### Acceptance Criteria

1. THE Candy_App SHALL have its own `package.json` in `apps/candy` that declares `golem-spec` as a dependency.
2. THE Candy_App SHALL contain the folders `robot/`, `controller/`, `scripts/`, `web/`, and `.kiro/`, and the files `lexicon.ts` and `app.ts`.
3. THE Candy_App SHALL import the skeleton only from `golem-spec`, `golem-spec/ui`, and `golem-spec/node`.
4. THE Candy_App SHALL contain no import path that contains `skeleton/src`.
5. THE Candy_App SHALL keep the Menagerie Apache-2.0 notice in `apps/candy/robot/LICENSE`.
6. THE Candy_App SHALL write its own code under the Apache-2.0 licence.
7. THE Candy_App SHALL use TypeScript in strict mode with ES modules for every source file except `scripts/fetch-assets.mjs`.
8. THE Candy_App SHALL run on Node 20 or later.
9. THE Candy_App SHALL use `@mujoco/mujoco` 4.x only through the skeleton and through the `mj` namespace in `SimContext`.
10. THE Candy_App SHALL provide a `.kiro/` folder that `golem init` can generate, including the requirements spec and the `agentStop` gate hook.

### Requirement 14: Determinism, performance, and handle hygiene

**User Story:** As a falsification engineer, I want candy trials to be deterministic and cheap, so that every counterexample reproduces and search budgets buy many trials.

#### Acceptance Criteria

1. THE Candy_Controller SHALL be a pure function of the Trial state, the PRNG, and simulated time.
2. THE Candy_Controller SHALL allocate no object, array, typed array, closure, or string inside `step`.
3. THE Candy_Controller SHALL allocate the IK_Solver working arrays, the Jacobian_Buffer, and the Hand delay line once, at construction.
4. WHEN the Candy_Controller is disposed or the Trial ends, THE Candy_Controller SHALL delete every Handle it created exactly once.
5. THE Candy_Controller SHALL size the Hand delay line from the maximum Tracker_Lag of 0.3 s and `controlDt`, with no growth during the Trial.
6. WHEN a Trial of the Candy_App_Definition runs for 3 s of simulated time, THE Episode_Runner SHALL finish the Trial in under 2 s of wall-clock time on the reference development machine, where the figure is a CI budget and not a claim of speed.
7. WHEN the same TrialSpec runs twice in the Same Runtime, THE Candy_App_Definition SHALL leave the Handle_Counter at its value before the Trial after each run.
8. THE Candy_App SHALL run each Trial in a Worker or a `worker_threads` thread through the TrialPool of the skeleton, with one Mj instance per Worker.

### Requirement 15: Tests for the candy app

**User Story:** As a maintainer, I want unit and property tests for the app's core logic, so that regressions in IK, suction, safety scaling, and compilation are caught in CI.

#### Acceptance Criteria

1. THE Candy_App test suite SHALL use Vitest for examples and fast-check for properties, and SHALL run each physics Trial with a simulated duration of at most 3 s.
2. FOR ALL generated Reachable_Points, THE IK_Solver SHALL converge to a Tip position error of at most 1 mm in fewer than 200 iterations (IK convergence property).
3. WHEN a Candy of 0.020 kg is attached by suction and the Tip moves at 0.5 m/s, THE test suite SHALL show that the Candy stays within the Suction_Engage_Radius of the Tip for the whole move (suction hold example).
4. FOR ALL generated Candy masses above the mass that the Holding_Force can carry at a given acceleration, THE Suction_Model SHALL release the Candy during that acceleration (suction limit property).
5. FOR ALL generated separation distances `d` of at least 0 m, THE SSM_v1 SHALL return a Speed_Scale in [0, 1], equal to 1 for `d` greater than 0.40 m, equal to 0 for `d` at most 0.15 m, and non-decreasing in `d` (speed-scale property).
6. FOR ALL generated Candy_Lexicon predicate slot values and signals, THE margin SHALL be positive if and only if the predicate holds, and the sign SHALL flip when the threshold crosses the signal (soundness property).
7. FOR ALL generated valid EARS lines that use the Candy_Lexicon phrases, parsing then formatting then parsing SHALL produce an equal AST (parser round-trip property, through the `golem-ears` parser).
8. FOR ALL generated Scenarios within the Dimensions of the Candy_Lexicon perturbations, THE Trial SHALL return the same Trace twice for the same seed (determinism property).
9. THE test suite SHALL include an example test that every acceptance criterion of the Candy_Requirements_File compiles against the Candy_Lexicon without error.
10. THE test suite SHALL include a 3 s smoke Trial of the Candy_App_Definition in Node that returns a finite `robustness` and leaves the Handle_Counter unchanged.
11. THE test suite SHALL include an example test that the Asset_Script exits with a non-zero code and a message that names the URL when a download fails, using a stubbed network.
12. THE test suite SHALL include an example test that `scene.xml` compiles with `mj.MjModel.from_xml_path` and contains six Candies, three Bowls, one Hand, and a site named `tip`.
13. THE test suite SHALL include an example test that no source file of the Candy_App imports a path containing `skeleton/src`.
14. THE test suite SHALL NOT weaken an assertion or a requirement to make a test pass.
15. FOR ALL generated hand-reach Scenarios, THE perturbation `a hand reaches in from {direction} at {range:speed}` SHALL keep the Hand at its start pose before the entry time and SHALL give the same Hand position for equal values (hand-path property).
