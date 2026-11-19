---
inclusion: fileMatch
fileMatchPattern: "**/requirements.md"
---

# EARS for robots: the GOLEM dialect

GOLEM compiles the numbered acceptance criteria of a `requirements.md` into physics property tests. A line that does not compile is an error with the closest template as a suggestion. Check every line you write with `npx --no-install golem-spec check`, or with the `check_requirement` tool, before you save it.

## The five patterns

| Pattern | Shape | Example |
|---|---|---|
| Ubiquitous | `THE <robot> SHALL <response>` | `THE robot SHALL track the commanded speed within 0.15 m/s` |
| Event | `WHEN <trigger> THE <robot> SHALL <response>` | `WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction THE robot SHALL stay upright for 3 s` |
| State | `WHILE <state> THE <robot> SHALL <response>` | `WHILE walking on a slope of up to 8 deg THE robot SHALL stay upright for 5 s` |
| Unwanted | `IF <fault> THEN THE <robot> SHALL <response>` | `IF the floor friction drops to 30% THEN THE robot SHALL stay upright for 5 s` |
| Optional | `WHERE <feature> THE <robot> SHALL <response>` | `WHERE payload mode is enabled THE robot SHALL stay upright for 5 s` |

The phrases you can use come from the `lexicon.ts` of the app. Each app lists its own triggers and responses. Never guess a phrase: when a line matches no template, read the suggestion in the diagnostic.

## Units on every number

Every number carries a unit, except counts (`3 candies`) and ratios declared as `{ratio}`. The accepted units are exactly:

`N, kN, m, cm, mm, s, ms, m/s, cm/s, deg, °, rad, kg, g, %`

A number without a unit is a compile error. Values are converted to SI inside GOLEM.

## Ranges in triggers define the search space

The falsifier searches the ranges you write in a trigger:

- `with up to 200 N` searches a force from 0 N to 200 N, and a larger force is harsher.
- `with 150 to 250 N` searches from 150 N to 250 N.
- `from any direction` searches an angle from 0 deg to 360 deg.
- `at any point in its stride` searches a gait phase from 0 to 1.
- `for 0.2 s` is a fixed value and is not searched.

Put the harshest believable value in the trigger. The falsifier finds the boundary, so you do not have to.

## Running the checks

- `npx --no-install golem-spec check` compiles every line and prints `file:line:col: severity: message` with a suggestion.
- `npx --no-install golem-spec test --budget 24` falsifies every requirement. `npx --no-install golem-spec falsify <id>` watches one.
- `npx --no-install golem-spec replay <id>` re-runs the pinned counterexample and writes `.golem/replays/<id>.csv`.
- `npx --no-install golem-spec gate` exits 0 only when every requirement meets its expectation (see below) and no pinned seed fails, exits 2 otherwise, and exits 1 when it cannot run (a usage error, a line that does not compile, or an error in the Expectation table).

## The gate confirms a green

A quick green is one search of 24 trials per line, and one search can miss a failure that another finds (an agent trusted such a green, and an independent gate with another search seed broke the line). So when every line meets its expectation, `gate` searches each `Expected_Hold` line again before it prints green. The second search uses a second search seed derived from the first (`fmix32(seed XOR 0xC0DEF57A)`, the same every time) and the same budget, on top of the pinned seeds. The first seed is 1 unless `--search-seed` or `searchSeed` in `golem.config.json` says otherwise.

- Green output names both seeds and the total trials: `confirmed: 3 Expected_Hold lines searched again with a second search seed derived from the first (search seed 1, then confirmation seed 588244584; ...; 144 in total)`.
- If the second search finds a counterexample, the gate is red. The block says the line held under the first seed and broke under the second, gives both seeds and `reproduce: npx --no-install golem-spec replay <id>`, and pins the counterexample. Fix the controller. Do not run `--no-confirm` to get past it, and do not search for a seed that passes.
- `--confirm-budget <n>` sets the searched trials per line of the second search (default: the budget of the first). `--no-confirm` skips the second search, prints `NOT confirmed (--no-confirm)` instead of the confirmation, and is recorded in `.golem/report.json` as `meta.confirm.status: "skipped"`. Use it only to time the first pass.
- Passing both seeds still means no counterexample was found within 2 searches. It is not a proof.
## The Expectation table

A `requirements.md` may say which lines are known to break. Each criterion is `Expected_Hold` unless a row says otherwise: the gate is red when an `Expected_Hold` line breaks and also when an `Expected_Break` line holds.

```
| Criterion | Topic | Expectation |
|---|---|---|
| 1.1 | Push recovery | Expected_Hold |
| 1.2 | Push recovery | Expected_Break |
```

- The id is the criterion's own number, exactly as `golem-spec check` prints it (`1.2`, not `R1.2` or `1.2.`). Give each criterion one row. The mark is `Expected_Hold` or `Expected_Break`; any other word is an error, never a guess.
- Marks live in a table only. A table inside a code fence, or indented 4 spaces, is not read.
- An unknown id, an unreadable mark, or two rows that give one id different marks is an error. The gate then exits 1, or blocks the stop with the rows named, and runs no trial. `npx --no-install golem-spec check` reports the same errors, so run it after you edit the table.
- A criterion with no row, while a table exists, is a warning.
- Do not change a mark to turn a red gate green. That is the same as editing a requirement to make a test pass. The gate prints every mark that differs from the committed file (`1.2: Expected_Hold -> Expected_Break (uncommitted)`) and records `expectation` and `met` for every line in `.golem/report.json`.
- An `Expected_Break` line that holds means the controller is better than the spec expects. Tell the user to move its row to `Expected_Hold`. Do not edit `requirements.md` yourself.
- An `Expected_Break` mark should have a pinned seed. When it holds in the first 24 trials, the gate searches that line once more with 4 times the budget; a counterexample it finds is pinned, so the next run starts from it.

A `held` verdict means no counterexample was found within the stated search budget. It is not a proof.

## Never edit a requirement to make a test pass

When a requirement fails, change the controller. Do not weaken, delete or reword the requirement to make a run green. If you think a requirement is wrong or too harsh, propose a change with the `propose_requirement` tool. It records the line in `.kiro/specs/<robot>/proposals.md`, where a human or Kiro spec mode decides whether to merge it into `requirements.md`.

## Hook timeouts

`hooks/golem.json` sets each timeout in seconds. Raise them for a slower app.

| Hook | Timeout | Reason |
|---|---|---|
| Check requirements on save | 30 s | Compile only; no trial runs. |
| Falsify controller on save | 300 s | 24 trials per requirement at up to 2 s of simulated time each. |
| Gate the agent (Stop) | 300 s | Pinned seeds, the 24-trial quick budget, then the same budget again with the confirmation seed (a gate with a slow app can need up to twice the time of 0.1.1). |
| Test after spec task | 300 s | The default of 64 trials per requirement. |
| Summon the ghosts (manual) | 1800 s | 256 trials per requirement. |

The Stop hook blocks the agent at most once per stop attempt and at most five times in a row per session. Kiro runs the Stop hook once per user turn, so the repair loop is driven by the `golem-tuner` agent itself and by the `falsify-and-fix` workflow, which runs `npx --no-install golem-spec gate` after every tuner iteration.

## How the commands run

Kiro's hook shells and MCP launcher do not have `node_modules/.bin` on the path, and a bare `npx golem` resolves to an unrelated npm package. Every command here therefore runs as `npx --no-install golem-spec <command>`, which uses the copy installed with `npm i -D golem-spec` and never downloads another. The MCP entry in `.kiro/settings/mcp.json` is `{ "command": "npx", "args": ["--no-install", "golem-spec", "mcp"] }`.