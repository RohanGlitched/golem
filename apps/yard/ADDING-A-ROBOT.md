# Adding a robot to the yard: a test of the "Add a robot" claim

The /yard/ page says: *"Any Menagerie model with position servos and a free base works the same way. Add one row to
`apps/yard/robots.json` (its folder, model file, keyframe and base body), copy a folder under `apps/yard/robots/`, then:
`fetch-assets`, `golem-spec test --app apps/yard/robots/<id>`, `board.ts <id>`."* It also says adding a robot is "one row
in a JSON file".

This file records doing exactly that for the **Apptronik Apollo** (MuJoCo Menagerie folder `apptronik_apollo`, at the
commit pinned in `robots.json`, `370c439`), on the branch `feat/yard-apollo`. All times are wall clock on one Windows
laptop (Node 21.7, PowerShell), 2026-11-20, UTC+05:30. Outputs are real and trimmed to the relevant lines.

**Result.** The claim is not true as written. The row, the folder and the three commands were not enough. Four things
were missing or wrong (section "What the instructions got wrong"), one of them a real gap in the yard's scene generator
(the Apollo has no floor contact at all without it). With those fixed Apollo stands, and breaks all five lines.

**Total: 12:34:16 to 13:12:27, 38 min 11 s.** The three documented commands, in their final working form, took 3 min 14 s
(fetch 45 s, test 47 s, board 1 min 42 s). As they first ran they took 11 min 38 s (45 s, 116 s on a broken scene, 8 min 57 s).
The rest was finding and fixing what the instructions left out.

| # | Step | Start | Took |
|---|---|---|---|
| 1 | Read the page, the yard files and the model XML | 12:34:16 | 2 min 12 s |
| 2 | Add the row to `robots.json` | 12:36:28 | 15 s |
| 3 | Create `robots/apollo/` | 12:36:43 | 1 s (redone later, see 5) |
| 4 | `fetch-assets.mjs apollo` | 12:36:55 | 45 s |
| 5 | `golem-spec test` (three tries) | 12:37:54 | 2 min 18 s of runs, plus about 1 min 50 s of fixes between them |
| 6 | Find why every line broke at a 0% push | 12:42:00 | 3 min 44 s |
| 7 | Fix `fetch-assets.mjs`, refetch Apollo, check the other seven | 12:45:44 | 2 min 7 s |
| 8 | `golem-spec test` again | 12:48:03 | 3 min 28 s (slow; 47 s when repeated at 13:08) |
| 9 | `board.ts apollo` | 12:51:48 | 8 min 57 s (1 min 42 s when repeated at 13:09) |
| 10 | Confirm the fall-through, fix the site text, the stub page and the tests, build the site | 13:00:45 | 8 min |
| 11 | Clear stale seeds, re-test, re-run `board.ts apollo` | 13:08:46 | 2 min 40 s |
| 12 | Tests, type checks, site build, this file | 13:11:46 | ~1 min plus writing |

The same command was 2 to 5 times slower on the first runs than on the repeats (test 198 s then 47 s, rose 355 s then
69 s). I did not find the cause; nothing else of mine was running. Do not read the times of 5, 8 and 9 as the cost of the
steps.

## Step 1: what the files say (2 min 12 s)

The model file, the keyframe and the free-base body must be read from the model XML. The folder at the pinned commit:

```
$ GET https://api.github.com/repos/google-deepmind/mujoco_menagerie/contents/apptronik_apollo?ref=370c439...
file CHANGELOG.md / LICENSE / README.md / apptronik_apollo.png / apptronik_apollo.xml 34514 /
apptronik_apollo_stand.png / scene.xml 1598      dir assets
```

In `apptronik_apollo.xml`:

```
<compiler angle="radian" eulerseq="zyx" meshdir="assets" texturedir="assets"/>
<option timestep="0.005" integrator="implicitfast"/>
<position name="torso_yaw" kp="500" joint="torso_yaw" ctrlrange="-0.829031 0.829031" forcerange="-120 120"/>   (x 32, all <position>)
<body name="base_link" pos="0 0 1.0813"> ... <joint name="floating_base" type="free" .../>
<key name="stand" qpos="0.0 0.0 1.01597 1.0 0.0 0.0 0.0 ..." ctrl="0.0 0.0 0.0 0.0 0.0 0.0 0.2 0.0 0.1 -0.4 ..."/>
```

So: model `apptronik_apollo.xml`, key `stand`, free-base body `base_link`, all 32 actuators are position servos. The row:

```json
{ "id": "apollo", "name": "Apptronik Apollo", "kind": "humanoid", "folder": "apptronik_apollo", "model": "apptronik_apollo.xml", "key": "stand", "base": "base_link" }
```

Two things `stand.ts` assumes that the page does not say, both true here: the free joint is the first joint of the model
(it reads `qpos[0..6]` as the base), and the model's `ctrl` for the key is either full or all zero.

## Steps 3 and 4: the folder, then `fetch-assets` (45 s)

"Copy a folder" does not say which files. A folder holds `app.ts` and `golem.config.json`; `robot/` is made by the fetch.
I copied the go1 `app.ts` and `golem.config.json` and replaced the id (`go1` to `apollo`, `yard-go1` to `yard-apollo`).
My first copy used PowerShell `Set-Content -Encoding utf8`, which writes a byte order mark and made the config invalid
JSON (see step 5). Copy the bytes and replace the id without a BOM.

```
$ node apps/yard/scripts/fetch-assets.mjs apollo
apollo: 46 files (45 downloaded)
```

## Step 5: `golem-spec test`, three tries

**Try 1 (12 s). The command could not start in this worktree:**

```
$ npx --no-install golem-spec test --app apps/yard/robots/apollo --budget 128 --search-seed 1
'golem' is not recognized as an internal or external command,
```

`node_modules/.bin` had no `golem` shim (the worktree's `npm install` ran before `skeleton/dist` existed, so npm skipped
the bin link). This is a local setup problem, not the yard's. Fix, offline, 20 s:

```
$ npm rebuild golem-spec --offline
rebuilt dependencies successfully
```

**Try 2 (10 s). My BOM:**

```
golem: .../apps/yard/robots/apollo/golem.config.json: invalid JSON: Unexpected token '', "{ "app""... is not valid JSON
```

Rewrote both files without a BOM.

**Try 3 (116 s). The command ran, and every line broke at a push of nothing:**

```
1.1  BROKEN  margin -99 m  32 trials  push.weight = 0 %, push.angle = 4.5 deg  (shrunk, seed 738945670)
1.2  BROKEN  margin -99 m  32 trials  push.weight = 0 %, push.angle = 4.5 deg  (shrunk, seed 738945670)
1.3  BROKEN  margin -99 m  32 trials  push.weight = 0 %, push.angle = 4.5 deg  (shrunk, seed 738945670)
1.4  BROKEN  margin -99 m  32 trials  push.weight = 0 %, push.angle = 4.5 deg  (shrunk, seed 738945670)
2.1  BROKEN  margin -0.00209 m  37 trials  push.weight = 0.848 %, push.angle = 252 deg  (shrunk, seed 2794059187)
5 requirements: 5 broken, 0 held, 0 error, in 106 s
```

Berkeley and T1, which fall in the warm-up, report margins of -0.24 to -0.72 m. -99 m is not a fall.

## Step 6: why -99 m (3 min 44 s)

A throwaway `runTrial` probe (deleted afterwards) on line 1.1 with no push:

```
-98.964  "diagnostics": { "horizon": 3.2, "simSteps": 2350, "timestep": 0.002, "integrator": "implicitfast",
  "warnings": { ... "BADQPOS": 0 ... }, "maxSolverIterations": 1, "maxContacts": 0, "numerical": false }
```

Not a divergence (no BAD* warnings), and **`maxContacts: 0`**: the robot touched nothing and fell through the floor.
In the model XML every geom has `contype="0" conaffinity="0"` (defaults `visual` and `collision`). Menagerie's own
`scene.xml` for the Apollo declares the floor contact by hand:

```xml
<contact>
  <pair geom1="collision_l_sole" geom2="floor" condim="6" solref="0.005 1" friction="2 2 0.01 0.0001 0.0001"/>
  <pair geom1="collision_r_sole" geom2="floor" .../>
  <pair geom1="collision_cylinder_l_arm" geom2="collision_capsule_body_pelvis" condim="1"/>   (and 3 more pairs)
</contact>
```

The yard does not use the upstream `scene.xml`: `fetch-assets.mjs` writes its own (model, timestep, floor). That scene has
no `<contact>` block, so no Apollo geom can collide with anything. I checked the upstream `scene.xml` of the other seven
robots at the pinned commit: none of them has a `<contact>` element, which is why the yard never met this.
Hand-pasting the block into `robot/scene.xml` made the zero-push margin +0.218 m, so the diagnosis holds.

## Step 7: the change (2 min 7 s)

`apps/yard/scripts/fetch-assets.mjs`, the smallest change that keeps the "one row" promise:

- `contactBlock(sceneText)`: returns the upstream `scene.xml`'s `<contact>...</contact>` block, or `''`.
- `sceneXml(robot, contact = '')`: adds that block after `</worldbody>` when it is not empty. With no block the output
  is byte for byte what it was.
- On a first fetch of a robot (no pinned `SOURCE.json`) the script fetches the upstream `scene.xml` and, if it has a
  block, records it in `SOURCE.json` as `sceneContact: { from, sha256, xml }`. Later runs and `--check` read it from
  `SOURCE.json`, so a rebuild needs no extra network and the generated scene is reproducible.

Why not put it in `stand.ts` or the row: `stand.ts` does not own the scene, and the contact names (`floor`, the sole
geoms) belong to the upstream file, so copying them verbatim and hashing them keeps them honest.

**The other seven are unchanged.** None has a block, so `sceneXml` is called with `''`. Checked rather than assumed: I
fetched all seven, `git status` shows no change to their `SOURCE.json`, and `--check` compares each regenerated
`scene.xml` hash to the manifest:

```
$ node apps/yard/scripts/fetch-assets.mjs        # all robots, 83 s (the seven had no meshes in this worktree)
go1: 7 files (6 downloaded) ... g1: 37 files (36 downloaded)   apollo: 46 files (0 downloaded)
$ node apps/yard/scripts/fetch-assets.mjs --check
go1: current   a1: current   spot: current   anymal_c: current   berkeley: current   t1: current   g1: current   apollo: current
```

Their `board.json` rows are untouched (the diff is 170 added lines, 0 removed).

## Step 8: `golem-spec test`, again (3 min 28 s)

```
$ npx --no-install golem-spec test --app apps/yard/robots/apollo --budget 128 --search-seed 1
1.1  BROKEN  margin -0.0327 m  108 trials  push.weight = 9.33 %, push.angle = 174 deg  (shrunk, seed 1978229444)
1.2  BROKEN  margin -0.182 m  44 trials  push.weight = 23.1 %, push.angle = 4.5 deg  (shrunk, seed 738945670)
1.3  BROKEN  margin -0.994 m  42 trials  push.weight = 23.8 %, push.angle = 19.3 deg  (shrunk, seed 2916678175)
1.4  BROKEN  margin -1.64 m  39 trials  push.weight = 31.2 %, push.angle = 57 deg  (not shrunk, seed 1935230720)
2.1  BROKEN  margin -0.000267 m  73 trials  push.weight = 9.38 %, push.angle = 198 deg  (not shrunk, seed 1961856845)
5 requirements: 5 broken, 0 held, 0 error, in 198 s
```

Apollo now stands unpushed (zero-push margin +0.218 m, base at 1.006 m for the whole 3.2 s) and the lines break for a
physical reason. Two things to read carefully:

- **Margins below about -0.6 m are not depths of a fall.** Apollo's only floor contacts are its two soles. Once it
  tips, nothing else touches the floor and the pelvis keeps falling. Probe with the recorded base height:
  ```
  push 0%    from 0 deg:   robustness  0.218 m, base z at start / middle / end:  1.006 /  1.006 /  1.006 m
  push 9.4%  from 180 deg: robustness -1.353 m, base z:                          1.006 /  1.005 / -0.998 m
  push 31.2% from 57 deg:  robustness -1.637 m, base z:                          1.006 /  0.984 / -0.117 m
  push 100%  from 57 deg:  robustness -1.626 m, base z:                          1.006 / -0.361 / -0.981 m
  ```
  The verdicts (broken) are right: it is on its way down in each. The sizes of -1 m and -1.6 m on the board are an
  artefact of the model's contact set. The sign and the push that causes it are real.
- Run 8 was **not** the first clean run: the seeds pinned by the broken run (try 3) were still in
  `robots/apollo/.golem/seeds`, and `golem test` replays pinned seeds first. They are in the output above as one extra
  trial each. Step 11 clears them.

## Step 9: `board.ts apollo` (8 min 57 s)

```
$ npx vite-node apps/yard/scripts/board.ts apollo
apollo 1.1 broken, 1.2 broken, 1.3 broken, 1.4 broken, 2.1 broken weakest { deg: 180, breaks: 0.094 } 170.3s + 355s
wrote board.json and board.md
```

It runs `golem test` itself (`--budget 128 --search-seed 1`, from the pinned seeds) and then the 24-direction bisection.
So step 5's test is not an input to step 9; its only effect is to leave the seeds that step 9 replays (see below).

## Step 11: stale seeds, and the final run

Because `board.ts` replays the pinned seeds and does not search again, the counterexamples on the board come from the seeds
that are on disk, not from a fresh search. The seeds from the broken try 3 (a 0% push "breaking" every line at -98.96 m)
would have been replayed too, so I deleted `robots/apollo/.golem` and ran both again on the fixed scene:

```
$ npx --no-install golem-spec test --app apps/yard/robots/apollo --budget 128 --search-seed 1
1.1  BROKEN  margin -0.0327 m  107 trials  push.weight = 9.33 %, push.angle = 174 deg  (shrunk, seed 1978229444)
1.2  BROKEN  margin -0.182 m  43 trials  push.weight = 23.1 %, push.angle = 4.5 deg  (shrunk, seed 738945670)
1.3  BROKEN  margin -0.994 m  41 trials  push.weight = 23.8 %, push.angle = 19.3 deg  (shrunk, seed 2916678175)
1.4  BROKEN  margin -1.64 m  38 trials  push.weight = 31.2 %, push.angle = 57 deg  (not shrunk, seed 1935230720)
2.1  BROKEN  margin -0.000267 m  72 trials  push.weight = 9.38 %, push.angle = 198 deg  (not shrunk, seed 1961856845)
5 requirements: 5 broken, 0 held, 0 error, in 46.7 s
$ npx vite-node apps/yard/scripts/board.ts apollo
apollo 1.1 broken, 1.2 broken, 1.3 broken, 1.4 broken, 2.1 broken weakest { deg: 180, breaks: 0.094 } 30.8s + 68.7s
```

Same verdicts and counterexamples as step 8. The board row, from `board.md`:

```
| Apptronik Apollo | BROKEN | BROKEN | BROKEN | BROKEN | BROKEN | 9.4% | 180 deg |
```

The rose (smallest toppling push as a share of the weight, by direction from the front, counterclockwise):

```
0:23%  15:23.4%  30:25%  45:27.7%  60:31.1%  75:33.6%  90:34%  105:22.5%  120:15.4%  135:12.3%  150:10.5%
165:9.6%  180:9.4%  195:9.6%  210:10.5%  225:12.3%  240:15.4%  255:22.5%  270:33.8%  285:33.6%  300:30.9% ...
```

Weakest direction is from behind (180 deg): 9.4% of its weight. Strongest side: 34% from the left. Nothing holds 100%
from any direction. The weak half is the back: 120 to 240 deg all topple it at 15.4% or less.

## Everything else that changed, and why

| File | Change | Why |
|---|---|---|
| `apps/yard/scripts/fetch-assets.mjs` | `contactBlock`, `sceneXml(robot, contact)`, `sceneContact` in `SOURCE.json` | step 7 |
| `apps/yard/test/stand.test.ts` | count 7 to 8; a test for `contactBlock`/`sceneXml`; the real-trial test now needs the zero-push margin above -1 m (it asserted only "finite", which -99 m also is, and passed on a robot that had fallen through the floor); one `ModelCache` per robot, disposed after it | the 8th model in one shared WASM heap failed with `Could not allocate memory`. I confirmed the new assertion fails on the old scene (`expected -98.96 to be greater than -1`) and passes on the new one |
| `site/yard/apollo/index.html` | new, a byte copy of `site/yard/go1/index.html` | the site build (`vite build`) failed with `Could not resolve entry module "yard/apollo/index.html"` until it existed |
| `site/src/build/layout.ts`, `site/src/pages/yard.ts` | the count (`seven`) is read from `robots.json` through `countWord()`; the page title, lede, sitemap note and a code comment; Apptronik added to the licence line; "Add a robot" text corrected | the page said "seven" in five places; adding the row made it wrong |
| `site/tests/yard.test.ts` | a test that the count words come from `robots.json` | so the next robot cannot silently leave "eight" in the text |
| `apps/yard/board.json`, `board.md` | the Apollo row, written by `board.ts` | step 9 |
| `apps/yard/robots/apollo/.golem/seeds/` | Apollo's five pinned seeds | every other yard robot commits its seeds; they were not in the "commit only" list (see below) |

## Tests

```
$ cd apps/yard && npx vitest --run      Test Files 1 passed (1)   Tests 18 passed (18)
$ cd site && npx vitest run             Test Files 5 passed (5)   Tests 58 passed (58)
$ tsc -p tsconfig.json --noEmit         exit 0 (apps/yard and site)
$ cd site && npx vite build             ... dist/yard/apollo/index.html 8.59 kB ... built in 5.29 s
```

I did not open the studio page for Apollo in a browser. The build produces `/yard/apollo/` and its `robot/` files and the
worker code is the same as for the other robots, but nothing here ran it in Chrome.

## What the instructions got wrong or left out

1. **"Any Menagerie model with position servos and a free base works the same way" is false for a model whose floor
   contacts live in its `scene.xml`.** The Apollo has position servos and a free base and fell through the floor, because
   the yard's own scene drops the upstream scene's `<contact>` pairs. Fixed in `fetch-assets.mjs` (step 7). A different
   model that needs something else from its upstream scene (an `<equality>`, an `<option>` flag, a `<default>`) would
   hit the same kind of gap; I only checked `<contact>`.
2. **`apps/yard/robots/<id>/` has two files to write, not a "folder to copy"**, and the other robots also commit
   `.golem/seeds/`. The page does not say which.
3. **The site needs `site/yard/<id>/index.html`.** Without it `vite build` fails. Not mentioned on the page.
4. **The three commands are not three independent steps.** The test in command 2 leaves pinned seeds that command 3
   replays instead of searching again. If command 2 ran on a broken scene, the broken seeds poison the board. The page
   should say to delete `.golem` after fixing a model problem. Also, command 2 as written has no `--budget 128
   --search-seed 1`, so its output is not the board's; command 3 re-runs the test with those settings anyway.
5. **A shell without `node_modules/.bin/golem`** (a fresh worktree) cannot run `npx golem-spec`. The fix is
   `npm rebuild golem-spec --offline`. This is a worktree matter, not the yard's.
6. **The test file asserted exactly seven robots, shared one `ModelCache`, and only checked for a finite margin.** Eight
   models in one WASM heap ran out of memory; a finite margin did not notice the robot fell through the floor.
7. **The site text said "seven" in five places** and listed the vendors by name; the count is now read from
   `robots.json`.
8. **Finding the model file, key and base body is manual.** It takes about two minutes and needs reading the XML for
   `type="free"`, the `<keyframe>` and the compiler directories. A line in the page saying where to look would help
   (`grep -n 'type="free"\|<key ' <model>.xml`).
