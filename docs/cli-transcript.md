# GOLEM CLI on the real G1: end-to-end transcript

Run from `apps/stagger` against the built kit (`skeleton/dist`), Node v21.7.0 on Windows, with the 11 EARS lines of `.kiro/specs/g1-walking/requirements.md` and Unitree's walking policy in MuJoCo WASM. `golem` below is `node ../../node_modules/golem-spec/dist/cli/main.js`. Output is verbatim. The only trimming is JSON lines longer than 900 characters in the MCP section, marked where it happens. Wall times were measured around each command.

Before the run, `apps/stagger/.golem` was deleted, so the pinned seeds in `.golem/seeds/stagger/` are the ones this run created. Push directions use the current convention: `push.angle` is the side the push comes from, counterclockwise from the robot's heading (0 deg from the front, 90 deg from its left, 180 deg from behind, 270 deg from its right).

The spec's Expectation table marks 1.2, 4.2 and 6.2 as Expected_Break and every other line as Expected_Hold. 1.3 was Expected_Break until the team decided it is a real requirement now that Kiro's reflex exists (see the notes at the end of the requirements file).

A held line means no counterexample found within the stated budget. It is not a proof.
### 1. golem check

```text
$ golem check
11 requirements compiled, 0 warnings
```

Exit code 0. Compiling takes under a second; no trials run.
### 2. golem test --budget 200  (exit 2, 156 s)

```text
$ golem test --budget 200
1.1  HELD  closest margin +0.233 m  no counterexample found in 200 trials (failure rate below 7.5 % at 95 % confidence)  [Expected_Hold: met]
1.2  BROKEN  margin -0.339 m  50 trials  push.force = 223 N, push.angle = 220 deg, push.phase = 0.0715 (stride phase)  (shrunk, seed 2205968643)  [Expected_Break: met]
1.3  BROKEN  margin -0.442 m  122 trials  push.force = 72.7 N, push.angle = 88.1 deg, push.phase = 0.277 (stride phase)  (shrunk, seed 1291121316)  [Expected_Hold: NOT met]
2.1  HELD  closest margin +0.116 m/s  no counterexample found in 40 trials (failure rate below 7.5 % at 95 % confidence)  [Expected_Hold: met]
2.2  HELD  closest margin +0.257 m  no counterexample found in 200 trials (failure rate below 7.5 % at 95 % confidence)  [Expected_Hold: met]
3.1  HELD  closest margin +0.144 m  no counterexample found in 200 trials (failure rate below 7.5 % at 95 % confidence)  [Expected_Hold: met]
4.1  HELD  closest margin +0.191 m  no counterexample found in 200 trials (failure rate below 7.5 % at 95 % confidence)  [Expected_Hold: met]
4.2  BROKEN  margin -0.376 m  50 trials  payload.mass = 15.5 kg  (shrunk, seed 3160059130)  [Expected_Break: met]
5.1  HELD  closest margin +0.262 m  no counterexample found in 40 trials (failure rate below 7.5 % at 95 % confidence)  [Expected_Hold: met]
6.1  HELD  closest margin +0.223 m  no counterexample found in 200 trials (failure rate below 7.5 % at 95 % confidence)  [Expected_Hold: met]
6.2  BROKEN  margin -0.445 m  48 trials  latency.duration = 0.05 s  (shrunk, seed 229287175)  [Expected_Break: met]
11 requirements: 4 broken, 7 held, 0 error, in 155 s (search budget 200 trials per requirement; held means no counterexample found within that budget, not a proof)
```

Exit code 2: four lines broke. Each line ends with its row of the Expectation table. 1.2, 4.2 and 6.2 are Expected_Break, so their counterexamples are what the spec wants and are marked met. 1.3 is Expected_Hold, so its counterexample is marked NOT met: Unitree's policy alone falls when pushed with 72.7 N from its left (88.1 deg) at 28 % of its stride, under the 100 N the line asks it to survive. `golem test` still exits 2 on any broken line. The gate (step 5) is the command that weighs the table.

All four counterexamples are shrunk. 1.3 needs the larger budget: with the same search seed, `golem falsify 1.3` finds nothing in 24 trials (closest margin +0.236 m) or in 96 trials (+0.223 m), and finds the failure in guided generation 1 of a 200-trial run (first failing trial: the 98th). The margin is the lower of the pelvis height headroom and the tilt headroom, in metres, so -0.442 m means the pelvis ended up 0.44 m under the 0.5 m limit. 2.1 and 5.1 have no searched dimension, so only the random phase runs, which takes 20 % of the budget (40 of 200 trials here, 4 of 24 under the gate).
### 3. golem falsify 1.3 --budget 200  (exit 2, 11 s)

```text
$ golem falsify 1.3 --budget 200
1.3  pinned generation 0: lowest -0.442 m, 1 trials used, 199 remaining
1.3  shrink generation 0: lowest -0.442 m, 19 trials used, 181 remaining
1.3  BROKEN  margin -0.439 m  19 trials  push.force = 72.1 N, push.angle = 88.1 deg, push.phase = 0.277 (stride phase)  (shrunk, seed 1291121316)
```

The pinned seed from step 2 still fails, so the run goes from the pinned re-run straight to shrinking and uses 19 of the 200 trials. The shrinker took the push from 72.7 N down to 72.1 N at the same direction and stride point and kept the failure, so the entry is marked `shrunk`. An earlier recording of this step said `not shrunk`. That was because the upright margin was a fixed -0.01 m for every fall, so no milder scenario ever looked better than another; `apps/stagger/predicates.ts` now grades the margin (height and tilt headroom) and the shrinker has a signal.
### 4. golem replay 1.3  (exit 0)

```text
$ golem replay 1.3
replay 1.3: seed 1291121316, push.force = 72.1 N, push.angle = 88.1 deg, push.phase = 0.277 (stride phase)
robustness -0.439 m at t = 4.84 s (the worst moment)
signals: minimum, maximum, and value at the worst moment
  pelvis_z: min 0.0613 m, max 0.774 m, at worst 0.0613 m
  tilt_deg: min 0.339 deg, max 120 deg, at worst 87.7 deg
  forward_speed: min -0.456 m/s, max 0.742 m/s, at worst -0.456 m/s
  commanded_speed: min 0.5 m/s, max 0.5 m/s, at worst 0.5 m/s
  lateral_drift: min 0 m, max 1.51 m, at worst 1.44 m
  episode_time: min 2 s, max 5.2 s, at worst 4.84 s
trace: .golem/replays/1.3.csv (161 samples)
studio: apps/stagger/web/index.html#r=1.3&seed=1291121316&d.push.angle=1.5384007323433917&d.push.force=72.13254767388582&d.push.phase=0.2771663910578735
```

The robot is pushed from its left at 28 % of its stride and falls: the pelvis reaches the floor with 87.7 deg of tilt and 0.061 m of height at t = 4.84 s, 2.8 s after the push at t = 2 s. The trace is written to `.golem/replays/1.3.csv` (git-ignored).
### 5. golem gate  (exit 2, 43 s)

```text
$ golem gate
Expected_Hold (8 lines: must hold)
  ok    1.1  HELD  closest margin +0.252 m  no counterexample found in 24 trials (failure rate below 75 % at 95 % confidence)
  FAIL  1.3  BROKEN  margin -0.439 m  19 trials  push.force = 72.1 N, push.angle = 88.1 deg, push.phase = 0.277 (stride phase)  (shrunk, seed 1291121316)  <- expected to hold but a counterexample was found
  ok    2.1  HELD  closest margin +0.117 m/s  no counterexample found in 4 trials (failure rate below 75 % at 95 % confidence)
  ok    2.2  HELD  closest margin +0.257 m  no counterexample found in 24 trials (failure rate below 75 % at 95 % confidence)
  ok    3.1  HELD  closest margin +0.197 m  no counterexample found in 24 trials (failure rate below 75 % at 95 % confidence)
  ok    4.1  HELD  closest margin +0.192 m  no counterexample found in 24 trials (failure rate below 75 % at 95 % confidence)
  ok    5.1  HELD  closest margin +0.262 m  no counterexample found in 4 trials (failure rate below 75 % at 95 % confidence)
  ok    6.1  HELD  closest margin +0.227 m  no counterexample found in 24 trials (failure rate below 75 % at 95 % confidence)

Expected_Break (3 lines: must break)
  ok    1.2  BROKEN  margin -0.318 m  19 trials  push.force = 216 N, push.angle = 220 deg, push.phase = 0.0715 (stride phase)  (shrunk, seed 2205968643)
  ok    4.2  BROKEN  margin -0.41 m  19 trials  payload.mass = 15 kg  (shrunk, seed 3160059130)
  ok    6.2  BROKEN  margin -0.445 m  15 trials  latency.duration = 0.05 s  (not shrunk, seed 229287175)

1.3: WHEN the pelvis is pushed with up to 100 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s
  scenario: push.force = 72.1 N, push.angle = 88.1 deg, push.phase = 0.277 (stride phase) (seed 1291121316)
  margin: -0.439 m
  reproduce: npx golem-spec replay 1.3

gate RED: 1 of 11 requirements do not meet their expectation
```

Default configuration: Unitree's policy alone. Exit code 2. The gate prints the two groups of the Expectation table. 1.2, 4.2 and 6.2 broke as the spec expects (ok). 1.3 is Expected_Hold and broke (FAIL), so it gets a block with the scenario, the margin and the reproduction command, and the gate is RED. The gate re-runs the pinned seeds first and then 24 trials per line. 1.3 is red because its pinned seed fails: 24 trials alone do not find it (see step 2). 6.2 says `not shrunk` because its pinned seed is already shrunk to 0.05 s and the re-shrink found nothing milder; the seed file holds the shrunk entry.
### 6. GOLEM_REFLEX=kiro golem gate  (exit 0, 45 s)

```text
$ GOLEM_REFLEX=kiro golem gate
Expected_Hold (8 lines: must hold)
  ok    1.1  HELD  closest margin +0.251 m  no counterexample found in 24 trials (failure rate below 75 % at 95 % confidence)
  ok    1.3  HELD  closest margin +0.216 m  no counterexample found in 26 trials (failure rate below 60 % at 95 % confidence)
  ok    2.1  HELD  closest margin +0.116 m/s  no counterexample found in 4 trials (failure rate below 75 % at 95 % confidence)
  ok    2.2  HELD  closest margin +0.257 m  no counterexample found in 24 trials (failure rate below 75 % at 95 % confidence)
  ok    3.1  HELD  closest margin +0.207 m  no counterexample found in 24 trials (failure rate below 75 % at 95 % confidence)
  ok    4.1  HELD  closest margin +0.193 m  no counterexample found in 24 trials (failure rate below 75 % at 95 % confidence)
  ok    5.1  HELD  closest margin +0.262 m  no counterexample found in 4 trials (failure rate below 75 % at 95 % confidence)
  ok    6.1  HELD  closest margin +0.228 m  no counterexample found in 24 trials (failure rate below 75 % at 95 % confidence)

Expected_Break (3 lines: must break)
  ok    1.2  BROKEN  margin -0.439 m  44 trials  push.force = 201 N, push.angle = 179 deg, push.phase = 0.56 (stride phase)  (shrunk, seed 3844575921)
  ok    4.2  BROKEN  margin -0.43 m  20 trials  payload.mass = 15.2 kg  (shrunk, seed 3160059130)
  ok    6.2  BROKEN  margin -0.441 m  15 trials  latency.duration = 0.05 s  (not shrunk, seed 229287175)

gate GREEN: every requirement meets its expectation (8 held as expected, 3 broke as expected; 233 trials, pinned seeds first, then the quick budget)
```

The same spec and the same pinned seeds, with the balance reflex that Kiro's `golem-tuner` agent wrote (`GOLEM_REFLEX=kiro`). Exit code 0. The pinned 1.3 seed from step 5 now holds (closest margin +0.216 m), so 1.3 meets its Expected_Hold. 1.2, 4.2 and 6.2 still break, which is what their Expected_Break rows ask for, so every line meets its expectation. 1.2 breaks with a new counterexample (201 N from 179 deg at 56 % of the stride): its two older pinned seeds no longer fail with the reflex, and the search found another. That entry is now pinned in `.golem/seeds/stagger/1.2.json`.
### 7. golem mcp, over stdio

A client from `@modelcontextprotocol/sdk` starts `golem mcp` as a child process in `apps/stagger`, lists the tools and calls them. Each call prints the one-line summary and then the JSON block. A line that has a row in the Expectation table carries it: `[Expected_Hold: NOT met]` in the summary, and `expectation` and `meetsExpectation` in the JSON.

```text
$ golem mcp

> tools/list
  list_requirements: List every requirement in the Requirements_Files in file order, with its EARS line and its last status from the last run
  check_requirement: Compile one EARS line against the lexicon of the app without running any trial and without writing any file. Returns Dia
  run_requirement: Run one requirement for at most `budget` random trials (pinned seeds first, default 24) and return its verdict: status, 
  falsify: Search for a counterexample to one requirement: pinned seeds, random trials, guided search, then shrinking to the mildes
  get_counterexample: Return the most recently pinned counterexample of a requirement: scenario with units, seed and robustness with unit.
  replay: Re-run a pinned counterexample exactly (the latest, or the one with `seed`) and return a 10 Hz trace summary of at most 
  explain_margin: Replay the latest pinned counterexample (or the closest scenario of the last run) and report which signal has the lowest
  propose_requirement: Record one EARS line as a proposal in .kiro/specs/<robot>/proposals.md for a human to review. The line must compile and 

> tools/call list_requirements {}   (0.0 s, isError=false)
11 requirements: 8 held, 3 broken, 0 error, 0 unknown
{"requirements":[{"id":"1.1","source":"WHEN the pelvis is pushed with up to 60 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s","status":"held","expectation":"Expected_Hold"},{"id":"1.2","source":"WHEN the pelvis is pushed with up to 250 N for 0.2 s from behind at any point in its stride THE robot SHALL stay upright for 3 s","status":"broken","expectation":"Expected_Break"},{"id":"1.3","source":"WHEN the pelvis is pushed with up to 100 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s","status":"held","expectation":"Expected_Hold"},{"id":"2.1","source":"THE robot SHALL track the commanded speed within 0.15 m/s","status":"held","expectation":"Expected_Hold"},{"id":"2.2","source":"WHEN commanded to walk at 0 m/s to 0.8 m/s THE robot SHALL stay upright for 5 s","status":"held","expectation":"Expected ... [902 more characters trimmed]

> tools/call check_requirement {"text":"WHEN the pelvis is pushed with up to 150 N for 0.2 s from behind THE robot SHALL stay upright for 3 s"}   (0.0 s, isError=false)
does not compile: The perturbation phrase ends early: more words are expected after 'behind'. Did you mean "the pelvis is pushed with {range:force} for {duration} from {direction} at {phase}"? (line 1
{"ok":false,"diagnostics":[{"line":1,"column":65,"severity":"error","message":"The perturbation phrase ends early: more words are expected after 'behind'. Did you mean \"the pelvis is pushed with {range:force} for {duration} from {direction} at {phase}\"?","suggestion":"the pelvis is pushed with {range:force} for {duration} from {direction} at {phase}"}]}

> tools/call falsify {"reqId":"1.3","budget":96}   (5.4 s, isError=false)
1.3 broken: margin -0.439 m at push.force = 72.1 N, push.angle = 88.1 deg, push.phase = 0.277 (stride phase) (seed 1291121316), 19 trials, shrunk; reproduce: npx golem-spec replay 1.3 [Expected_Hold: 
{"expectation":"Expected_Hold","meetsExpectation":false,"reqId":"1.3","status":"broken","trials":19,"randomTrials":0,"guidedTrials":0,"closest":{"robustness":-0.44193487868792536,"scenario":{"push.angle":1.5384007323433917,"push.force":72.70052049021564,"push.phase":0.2771663910578735},"seed":3254842707,"unit":"m"},"counterexample":{"reqId":"1.3","scenario":{"push.angle":1.5384007323433917,"push.force":72.13254767388582,"push.phase":0.2771663910578735},"seed":1291121316,"robustness":-0.43868391292559167,"shrunk":true,"foundAfter":1,"unit":"m"},"pinned":"duplicate"}

> tools/call falsify {"reqId":"4.2","budget":24}   (3.2 s, isError=false)
4.2 broken: margin -0.41 m at payload.mass = 15 kg (seed 3160059130), 17 trials; reproduce: npx golem-spec replay 4.2 [Expected_Break: met]
{"expectation":"Expected_Break","meetsExpectation":true,"reqId":"4.2","status":"broken","trials":17,"randomTrials":0,"guidedTrials":0,"closest":{"robustness":-0.41314459601759834,"scenario":{"payload.mass":14.990384537948387},"seed":3254842707,"unit":"m"},"counterexample":{"reqId":"4.2","scenario":{"payload.mass":14.990384537948387},"seed":3160059130,"robustness":-0.40963216410018505,"shrunk":false,"foundAfter":2,"unit":"m"},"pinned":"duplicate"}

> tools/call falsify {"reqId":"3.1","budget":24}   (1.7 s, isError=false)
3.1 held: no counterexample found in 24 trials (closest margin +0.197 m) [Expected_Hold: met]
{"expectation":"Expected_Hold","meetsExpectation":true,"reqId":"3.1","status":"held","trials":24,"randomTrials":4,"guidedTrials":20,"closest":{"robustness":0.19676195713558275,"scenario":{"slope.angle":0.13956263682084025},"seed":2774681620,"unit":"m"},"failureRateUpper95":0.75}

> tools/call get_counterexample {"reqId":"1.3"}   (0.0 s, isError=false)
1.3: pinned counterexample push.force = 72.1 N, push.angle = 88.1 deg, push.phase = 0.277 (stride phase) (seed 1291121316), margin -0.439 m; reproduce: npx golem-spec replay 1.3
{"reqId":"1.3","counterexample":{"scenario":{"push.angle":1.5384007323433917,"push.force":72.13254767388582,"push.phase":0.2771663910578735},"seed":1291121316,"robustness":-0.43868391292559167,"unit":"m","shrunk":true,"foundAfter":1}}

> tools/call explain_margin {"reqId":"1.3"}   (0.9 s, isError=false)
1.3: lowest margin on pelvis_z, -0.439 m at t = 4.84 s (pinned counterexample, seed 1291121316, push.force = 72.1 N, push.angle = 88.1 deg, push.phase = 0.277 (stride phase)). The requirement itself h
{"reqId":"1.3","source":"pinned","seed":1291121316,"scenario":{"push.angle":1.5384007323433917,"push.force":72.13254767388582,"push.phase":0.2771663910578735},"robustness":-0.43868391292559167,"worstAt":4.84,"unit":"m","lowest":{"signal":"pelvis_z","margin":-0.43868391292559167,"at":4.84,"unit":"m"},"others":[{"signal":"tilt_deg","margin":-0.2998260875852937,"at":4.2,"unit":"m"}],"marginSource":"monitor"}

> tools/call explain_margin {"reqId":"6.2"}   (0.3 s, isError=false)
6.2: lowest margin on pelvis_z, -0.445 m at t = 3.98 s (pinned counterexample, seed 229287175, latency.duration = 0.05 s). The requirement itself has margin -0.445 m at t = 3.98 s. Other signals, each
{"reqId":"6.2","source":"pinned","seed":229287175,"scenario":{"latency.duration":0.050048744587775224},"robustness":-0.4449513394929417,"worstAt":3.98,"unit":"m","lowest":{"signal":"pelvis_z","margin":-0.4449513394929417,"at":3.98,"unit":"m"},"others":[{"signal":"tilt_deg","margin":-0.1916992772356965,"at":4.68,"unit":"m"}],"marginSource":"monitor"}

> tools/call run_requirement {"reqId":"3.1","budget":8}   (0.7 s, isError=false)
3.1 held: no counterexample found in 8 trials (closest margin +0.215 m) [Expected_Hold: met]
{"expectation":"Expected_Hold","meetsExpectation":true,"reqId":"3.1","status":"held","trials":8,"randomTrials":8,"guidedTrials":0,"closest":{"robustness":0.21512330343173502,"scenario":{"slope.angle":0.12498614917720856},"seed":3909821944,"unit":"m"},"failureRateUpper95":0.375}
```

`falsify 1.3` is a broken line that the spec expects to hold, so the summary says `[Expected_Hold: NOT met]` right after the status word. `falsify 4.2` is a broken line that is expected to break: `[Expected_Break: met]`. `explain_margin` on 1.3 and 6.2 reports `pelvis_z` as the lowest number (-0.44 m, once the robot lies on the floor). Its summary also states the requirement's own margin and time. Each per-signal margin judges that signal alone, with the other signals held at their first-window value.
