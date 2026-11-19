# GOLEM CLI on the real G1: end-to-end transcript

Run from `apps/stagger` against the built kit (`skeleton/dist`), Node v21.7.0 on Windows, with the 11 EARS lines of `.kiro/specs/g1-walking/requirements.md` and Unitree's walking policy in MuJoCo WASM. `golem` below is `node ../../node_modules/golem-spec/dist/cli/main.js`. Output is verbatim. The only trimming is JSON lines longer than 900 characters in the MCP section, marked where it happens. Wall times were measured around each command.

A held line means no counterexample found within the stated budget. It is not a proof.
### 1. golem check

```text
$ golem check
11 requirements compiled, 0 warnings
```

Exit code 0. Compiling takes under a second; no trials run.
### 2. golem test --budget 48  (exit 2, 33 s)

```text
$ golem test --budget 48
1.1  HELD  closest margin +0.247 m  no counterexample found in 48 trials (failure rate below 33.3 % at 95 % confidence)
1.2  BROKEN  margin -0.151 m  63 trials  push.force = 220 N, push.angle = 220 deg, push.phase = 0.535 (stride phase)  (not shrunk, seed 1076273446)
1.3  BROKEN  margin -0.01 m  23 trials  push.force = 55.6 N, push.angle = 235 deg, push.phase = 0.334 (stride phase)  (not shrunk, seed 3379468565)
2.1  HELD  closest margin +0.117 m/s  no counterexample found in 9 trials (failure rate below 33.3 % at 95 % confidence)
2.2  HELD  closest margin +0.258 m  no counterexample found in 48 trials (failure rate below 33.3 % at 95 % confidence)
3.1  HELD  closest margin +0.206 m  no counterexample found in 48 trials (failure rate below 33.3 % at 95 % confidence)
4.1  HELD  closest margin +0.194 m  no counterexample found in 48 trials (failure rate below 33.3 % at 95 % confidence)
4.2  BROKEN  margin -0.0265 m  27 trials  payload.mass = 15 kg  (shrunk, seed 4080057767)
5.1  HELD  closest margin +0.262 m  no counterexample found in 9 trials (failure rate below 33.3 % at 95 % confidence)
6.1  HELD  closest margin +0.228 m  no counterexample found in 48 trials (failure rate below 33.3 % at 95 % confidence)
6.2  BROKEN  margin -0.01 m  26 trials  latency.duration = 0.05 s  (shrunk, seed 2916678175)
11 requirements: 4 broken, 7 held, 0 error, in 33 s (search budget 48 trials per requirement; held means no counterexample found within that budget, not a proof)
```

Exit code 2: four lines broke. The README table marks 1.2, 1.3, 4.2 and 6.2 as Expected_Break, so these are the four the falsifier is meant to find. `-0.01 m` is the app's fixed margin for a fall (tilt over 60 deg, see `apps/stagger/predicates.ts`), not a measured height. 2.1 and 5.1 have no searched dimension, so only the random phase runs, which takes 20 % of the budget (9 of 48 trials here, 4 of 24 under the gate).
### 3. golem falsify 1.3 --budget 96  (exit 2, 5.5 s)

```text
$ golem falsify 1.3 --budget 96
1.3  pinned generation 0: lowest -0.01 m, 1 trials used, 95 remaining
1.3  shrink generation 0: lowest -0.01 m, 15 trials used, 81 remaining
1.3  BROKEN  margin -0.01 m  15 trials  push.force = 55.6 N, push.angle = 235 deg, push.phase = 0.334 (stride phase)  (not shrunk, seed 3379468565)
```

The pinned seed from step 2 still fails, so the run goes straight from the pinned re-run to shrinking and reports 15 trials with no random or guided phase. The shrink phase ran 14 trials without finding a milder failing scenario, so the counterexample stays `not shrunk`.
### 4. golem replay 1.3  (exit 0)

```text
$ golem replay 1.3
replay 1.3: seed 3379468565, push.force = 55.6 N, push.angle = 235 deg, push.phase = 0.334 (stride phase)
robustness -0.01 m at t = 3.94 s (the worst moment)
signals: minimum, maximum, and value at the worst moment
  pelvis_z: min 0.0584 m, max 0.776 m, at worst 0.459 m
  tilt_deg: min 0.336 deg, max 98.6 deg, at worst 62.7 deg
  forward_speed: min -0.0926 m/s, max 0.566 m/s, at worst 0.553 m/s
  commanded_speed: min 0.5 m/s, max 0.5 m/s, at worst 0.5 m/s
  lateral_drift: min 0 m, max 1.22 m, at worst 0.883 m
  episode_time: min 2 s, max 5.2 s, at worst 3.94 s
trace: .golem/replays/1.3.csv (161 samples)
studio: apps/stagger/web/index.html#r=1.3&seed=3379468565&d.push.angle=4.097523985475356&d.push.force=55.609404201823054&d.push.phase=0.334303052200994
```

The robot falls 1.9 s after the push (t = 3.94 s, tilt 62.7 deg). The trace is written to `.golem/replays/1.3.csv` (git-ignored).
### 5. golem gate  (exit 2, 22 s)

```text
$ golem gate
1.2: WHEN the pelvis is pushed with up to 250 N for 0.2 s from behind at any point in its stride THE robot SHALL stay upright for 3 s
  scenario: push.force = 220 N, push.angle = 220 deg, push.phase = 0.535 (stride phase) (seed 1076273446)
  margin: -0.151 m
  reproduce: golem replay 1.2

1.3: WHEN the pelvis is pushed with up to 100 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s
  scenario: push.force = 55.6 N, push.angle = 235 deg, push.phase = 0.334 (stride phase) (seed 3379468565)
  margin: -0.01 m
  reproduce: golem replay 1.3

4.2: WHEN carrying a payload of up to 20 kg THE robot SHALL stay upright for 5 s
  scenario: payload.mass = 14.9 kg (seed 4080057767)
  margin: -0.0606 m
  reproduce: golem replay 4.2

6.2: WHEN the sensor latency rises to up to 100 ms THE robot SHALL stay upright for 5 s
  scenario: latency.duration = 0.05 s (seed 2916678175)
  margin: -0.01 m
  reproduce: golem replay 6.2

gate RED: 4 of 11 requirements are not held
```

Exit code 2 and one block per broken line, each with its reproduction command. Gate re-runs the pinned seeds first and then the default budget of 24 trials per line, so its 4.2 numbers differ from the budget-48 run above: its shrink reached a milder failing mass at the same seed (14.9 kg, margin -0.0606 m, against 15.0 kg and -0.0265 m). Both entries are in `.golem/seeds/stagger/4.2.json`.
### 6. golem mcp, over stdio

A client from `@modelcontextprotocol/sdk` starts `golem mcp` as a child process in `apps/stagger`, lists the tools and calls them. Each call prints the one-line summary and then the JSON block.

```text
> tools/list
  list_requirements: List every requirement in the Requirements_Files in file order, with its EARS line and its last status from th
  check_requirement: Compile one EARS line against the lexicon of the app without running any trial and without writing any file
  run_requirement: Run one requirement for at most `budget` random trials (pinned seeds first, default 24) and return its verdict
  falsify: Search for a counterexample to one requirement: pinned seeds, random trials, guided search, then shrinking to 
  get_counterexample: Return the most recently pinned counterexample of a requirement: scenario with units, seed and robustness with
  replay: Re-run a pinned counterexample exactly (the latest, or the one with `seed`) and return a 10 Hz trace summary o
  explain_margin: Replay the latest pinned counterexample (or the closest scenario of the last run) and report which signal has 
  propose_requirement: Record one EARS line as a proposal in .kiro/specs/<robot>/proposals.md for a human to review

> tools/call list_requirements {}   (0.0 s, isError=false)
11 requirements: 7 held, 4 broken, 0 error, 0 unknown
{"requirements":[{"id":"1.1","source":"WHEN the pelvis is pushed with up to 60 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s","status":"held"},{"id":"1.2","source":"WHEN the pelvis is pushed with up to 250 N for 0.2 s from behind at any point in its stride THE robot SHALL stay upright for 3 s","status":"broken"},{"id":"1.3","source":"WHEN the pelvis is pushed with up to 100 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s","status":"broken"},{"id":"2.1","source":"THE robot SHALL track the commanded speed within 0.15 m/s","status":"held"},{"id":"2.2","source":"WHEN commanded to walk at 0 m/s to 0.8 m/s THE robot SHALL stay upright for 5 s","status":"held"},{"id":"3.1","source":"WHEN walking on a slope of up to 8 deg THE robot SHALL stay upright for 5 s","status":"held"},{"id":"4.1","source":"WHE ... [571 more characters trimmed]

> tools/call check_requirement {"text":"WHEN the pelvis is pushed with up to 150 N for 0.2 s from behind THE robot SHALL stay upright for 3 s"}   (0.0 s, isError=false)
does not compile: The perturbation phrase ends early: more words are expected after 'behind'. Did you mean "the pelvis is pushed with {range:force} for {duration} from {direction} at {phase}"? (line 1
{"ok":false,"diagnostics":[{"line":1,"column":65,"severity":"error","message":"The perturbation phrase ends early: more words are expected after 'behind'. Did you mean \"the pelvis is pushed with {range:force} for {duration} from {direction} at {phase}\"?","suggestion":"the pelvis is pushed with {range:force} for {duration} from {direction} at {phase}"}]}

> tools/call falsify {"reqId":"1.3","budget":96}   (4.8 s, isError=false)
1.3 broken: margin -0.01 m at push.force = 55.6 N, push.angle = 235 deg, push.phase = 0.334 (stride phase) (seed 3379468565), 15 trials; reproduce: golem replay 1.3
{"reqId":"1.3","status":"broken","trials":15,"randomTrials":0,"guidedTrials":0,"closest":{"robustness":-0.01,"scenario":{"push.angle":4.097523985475356,"push.force":55.609404201823054,"push.phase":0.334303052200994},"seed":3379468565,"unit":"m"},"counterexample":{"reqId":"1.3","scenario":{"push.angle":4.097523985475356,"push.force":55.609404201823054,"push.phase":0.334303052200994},"seed":3379468565,"robustness":-0.01,"shrunk":false,"foundAfter":1,"unit":"m"},"pinned":"duplicate"}

> tools/call falsify {"reqId":"3.1","budget":24}   (1.4 s, isError=false)
3.1 held: no counterexample found in 24 trials (closest margin +0.197 m)
{"reqId":"3.1","status":"held","trials":24,"randomTrials":4,"guidedTrials":20,"closest":{"robustness":0.19676195713558275,"scenario":{"slope.angle":0.13956263682084025},"seed":2774681620,"unit":"m"},"failureRateUpper95":0.75}

> tools/call get_counterexample {"reqId":"1.3"}   (0.0 s, isError=false)
1.3: pinned counterexample push.force = 55.6 N, push.angle = 235 deg, push.phase = 0.334 (stride phase) (seed 3379468565), margin -0.01 m; reproduce: golem replay 1.3
{"reqId":"1.3","counterexample":{"scenario":{"push.angle":4.097523985475356,"push.force":55.609404201823054,"push.phase":0.334303052200994},"seed":3379468565,"robustness":-0.01,"unit":"m","shrunk":false,"foundAfter":9}}

> tools/call explain_margin {"reqId":"1.3"}   (0.8 s, isError=false)
1.3: lowest margin on pelvis_z, -0.442 m at t = 4.34 s (pinned counterexample, seed 3379468565, push.force = 55.6 N, push.angle = 235 deg, push.phase = 0.334 (stride phase)). The requirement itself ha
{"reqId":"1.3","source":"pinned","seed":3379468565,"scenario":{"push.angle":4.097523985475356,"push.force":55.609404201823054,"push.phase":0.334303052200994},"robustness":-0.01,"worstAt":3.94,"unit":"m","lowest":{"signal":"pelvis_z","margin":-0.44159190504022655,"at":4.34,"unit":"m"},"others":[{"signal":"tilt_deg","margin":-0.01,"at":3.94,"unit":"m"}],"marginSource":"monitor"}

> tools/call explain_margin {"reqId":"6.2"}   (0.3 s, isError=false)
6.2: lowest margin on pelvis_z, -0.439 m at t = 3.96 s (pinned counterexample, seed 2916678175, latency.duration = 0.05 s). The requirement itself has margin -0.01 m at t = 3.52 s. Other signals, each
{"reqId":"6.2","source":"pinned","seed":2916678175,"scenario":{"latency.duration":0.05003299688513607},"robustness":-0.01,"worstAt":3.52,"unit":"m","lowest":{"signal":"pelvis_z","margin":-0.43933376748122227,"at":3.96,"unit":"m"},"others":[{"signal":"tilt_deg","margin":-0.01,"at":3.52,"unit":"m"}],"marginSource":"monitor"}

> tools/call run_requirement {"reqId":"3.1","budget":8}   (0.6 s, isError=false)
3.1 held: no counterexample found in 8 trials (closest margin +0.215 m)
{"reqId":"3.1","status":"held","trials":8,"randomTrials":8,"guidedTrials":0,"closest":{"robustness":0.21512330343173502,"scenario":{"slope.angle":0.12498614917720856},"seed":3909821944,"unit":"m"},"failureRateUpper95":0.375}
```

`explain_margin` on 1.3 and 6.2 reports `pelvis_z` as the lowest number (-0.44 m, once the robot lies on the floor) and `tilt_deg` at -0.01 m at the moment the requirement actually broke (t = 3.94 s and 3.52 s). The summary now also states the requirement's own margin and time, so the two readings do not conflict. Each per-signal margin judges that signal alone, with the other signals held at their first-window value.
