# golem-gate: the GOLEM gate as a CI step

A composite GitHub Action that runs `golem-spec gate` on a robot app. The job fails exactly when the gate exits non-zero, and the run page shows one row per requirement.

```yaml
- uses: RohanGlitched/golem/.github/actions/golem-gate@main
```

## Copy-paste workflow

For a project that has `golem-spec` in its `devDependencies` and a `package-lock.json`:

```yaml
# .github/workflows/golem.yml
name: golem
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  gate:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: RohanGlitched/golem/.github/actions/golem-gate@main
        with:
          app-dir: .        # the directory with golem.config.json
          budget: 24        # trials per requirement
          # search-seed: 7  # fix the search for a reproducible run
          # node-version: 20
```

Pin `@main` to a commit SHA or tag when you want the action itself to stay still.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `app-dir` | `.` | Directory of the app (the one with `golem.config.json`), relative to the workspace. |
| `budget` | `24` | Trials per requirement, passed as `--budget`. Pinned seeds run first and count inside it. |
| `search-seed` | empty | Optional `--search-seed` (a positive integer). Empty uses `golem.config.json`, else 1. |
| `node-version` | `20` | Passed to `actions/setup-node`. |
| `install` | `true` | `true` runs `npm ci` where a `package-lock.json` is found: in `app-dir`, or the nearest parent inside the workspace (a monorepo root). `false` skips it, for workflows that have already installed and built. |
| `artifact-name` | `golem-gate` | Name of the uploaded artifact. Names must be unique within a run, so give each use of the action in one workflow its own. |

`install` and `artifact-name` go beyond the four inputs the gate itself needs. A monorepo that builds its own `golem-spec` before the gate needs `install: 'false'`, and a workflow that gates twice needs two artifact names.

Outputs: `exit-code` (the gate's exit code) and `report-path` (`<app-dir>/.golem/report.json`).

Environment variables on the `uses:` step reach the gate, so `env: { GOLEM_REFLEX: kiro }` runs the gate with that setting. The summary names every `GOLEM_*` variable and puts it into each reproduce command.

## What it does

1. `actions/setup-node` with `node-version`.
2. Finds `package-lock.json` (in `app-dir` or a parent inside the workspace), restores `~/.npm` with `actions/cache`, and runs `npm ci`.
3. Runs `npx --no-install golem-spec gate --json --budget <budget> [--search-seed <n>]` in `app-dir`. It records the exit code and does not fail yet.
4. Writes the job summary with `summary.mjs`: a RED or GREEN line, then one row per requirement with its expectation (`Expected_Hold` or `Expected_Break`), verdict, whether it meets the expectation, margin, counterexample (scenario, shrunk or not, seed) and the command that reproduces it (`replay <id>` for a broken line, `falsify <id>` for a held one).
5. Uploads `.golem/report.json` and `.golem/replays/` with `actions/upload-artifact`.
6. Fails the job with the gate's exit code when it is not 0: **2** when a requirement misses its expectation, **1** when the gate could not run (the requirements do not compile, no app was found, `golem-spec` is not installed).

A passing gate means no counterexample was found within the budget. It is not a proof, and the summary says so.

The official actions it uses are `actions/setup-node@v4`, `actions/cache@v4` and `actions/upload-artifact@v4`. The action reads no secrets and needs only `contents: read`.

## A gate that is expected to fail

This repository gates the Unitree G1 app twice. Unitree's policy alone breaks requirement 1.3, so that run must fail. With Kiro's balance reflex the same gate must pass. See `.github/workflows/golem.yml`:

```yaml
- id: unitree
  continue-on-error: true
  uses: RohanGlitched/golem/.github/actions/golem-gate@main
  with: { app-dir: apps/stagger, artifact-name: golem-gate-unitree }
- run: test "${{ steps.unitree.outcome }}" = failure   # the step failed, as it must

- uses: RohanGlitched/golem/.github/actions/golem-gate@main
  env: { GOLEM_REFLEX: kiro }
  with: { app-dir: apps/stagger, artifact-name: golem-gate-reflex }
```

## Tests

`summary.mjs` is a plain Node module with no dependencies. `summary.test.mjs` tests it with Vitest and fast-check (one table row per requirement whatever the text contains, units, exit codes, a gate that printed nothing):

```
npx vitest run --root .github/actions/golem-gate
```

## Recorded locally

Everything the workflow runs was run from a fresh `git clone` of this branch, with the same commands, in Git Bash on Windows (Node 21.7, npm 10.5). The three jobs ran one after another, so the times are one job each. The composite action itself needs a GitHub runner for `setup-node`, `cache` and `upload-artifact`; its `run:` steps (find lockfile, gate, summary, fail) were extracted from `action.yml` and run with the same environment variables the runner sets.

### Job `skeleton`

```
$ npm run typecheck -w skeleton
> tsc -p tsconfig.json --noEmit
typecheck exit 0

$ cd skeleton && npx vitest run
 Test Files  310 passed | 1 skipped (311)
      Tests  1935 passed | 10 skipped (1945)
   Duration  77.26s

$ npx vitest run --root .github/actions/golem-gate
 summary.test.mjs (15 tests)
      Tests  15 passed (15)
```

About 106 s for the three commands, after `npm ci` (13 s).

### Job `starter` (tail)

```
$ npx --no-install golem-spec check
3 requirements compiled, 0 warnings
[check] exit 0
ok    check compiles the 3 starter lines with 0 warnings and exits 0

$ npx --no-install golem-spec test --budget 24
1.1  HELD  closest margin +17.9 deg  no counterexample in 24 trials; from the 4 uniformly random ones, failure rate below 75 % (95 % confidence)
1.2  BROKEN  margin -0.421 deg  21 trials  push.force = 14.5 N  (shrunk, seed 3909821944)
2.1  HELD  closest margin +0.193 m  no counterexample in 4 trials; from the 4 uniformly random ones, failure rate below 75 % (95 % confidence)
3 requirements: 1 broken, 2 held, 0 error, in 7.87 s (search budget 24 trials per requirement; held means no counterexample found within that budget, not a proof)
[test] exit 2
ok    test exits 2 (a requirement is broken)
ok    test: 1.1 held
ok    test: 1.2 broken
ok    test: 2.1 held

$ npx --no-install golem-spec gate --json
[gate] exit 2
ok    gate exits 2 on line 1.2 (red on purpose)
ok    gate names only 1.2 as not met (got ["1.2"])

starter smoke test: passed
```

100 s for build, pack, install and the four commands. (The gate's one-line JSON is left out here.)

### Job `stagger-gate`

Setup is `npm run build -w skeleton` and `npm rebuild golem-spec`. `npm ci` links no `golem-spec` bin when `skeleton/dist` does not exist yet, so the rebuild is needed (the bin list was empty right after `npm ci`).

```
=== Unitree's policy alone (expect failure)
npx --no-install golem-spec gate --json --budget 24  (in apps/stagger)
golem-spec gate exited with code 2
::error::golem-spec gate exited with code 2
action step result: exit 2

=== GOLEM_REFLEX=kiro (must pass)
npx --no-install golem-spec gate --json --budget 24  (in apps/stagger)
golem-spec gate exited with code 0
action step result: exit 0
```

Both gates took 68 s together. The assert step of the workflow, run with the three outcomes it can meet:

```
OUTCOME=failure CODE=2  -> exit 0   (what the Unitree run must give)
OUTCOME=success CODE=0  -> exit 1   ::error::the gate on Unitree's policy should fail (line 1.3 breaks) but its outcome was success
OUTCOME=failure CODE=1  -> exit 1   ::error::expected gate exit code 2 (a requirement misses its expectation), got 1
```

The job summary the two runs wrote (rows for the other lines left out):

```
## GOLEM gate (`apps/stagger`): RED (exit 2)
1 of 11 requirements do not meet their expectation: 1.3.
| **1.3** WHEN the pelvis is pushed with up to 100 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s | Expected_Hold | broken | **NO** | -0.439 m | push.angle = 88.1 deg, push.force = 72.1 N, push.phase = 0.277 of the stride (shrunk, seed 1291121316) | `cd apps/stagger && npx --no-install golem-spec replay 1.3` |

## GOLEM gate (`apps/stagger`): GREEN (exit 0)
Every requirement meets its expectation: 11 of 11.
Budget: 24 trials per requirement, pinned seeds included. Search seed: from golem.config.json, else 1. Environment: `GOLEM_REFLEX=kiro`.
| **1.3** WHEN ... | Expected_Hold | held | yes | closest +0.216 m | none found in 24 trials | `cd apps/stagger && GOLEM_REFLEX=kiro npx --no-install golem-spec falsify 1.3 --budget 24` |
```

Not run locally: the GitHub runner itself (`setup-node`, `actions/cache`, `upload-artifact`, `continue-on-error` and the composite `outputs`). The first push shows whether they behave as written here.
