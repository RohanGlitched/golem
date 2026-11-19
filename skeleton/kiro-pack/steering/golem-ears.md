---
inclusion: fileMatch
fileMatchPattern: "**/requirements.md"
---

# EARS for robots: the GOLEM dialect

GOLEM compiles the numbered acceptance criteria of a `requirements.md` into physics property tests. A line that does not compile is an error with the closest template as a suggestion. Check every line you write with `golem check`, or with the `check_requirement` tool, before you save it.

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

- `golem check` compiles every line and prints `file:line:col: severity: message` with a suggestion.
- `golem test --budget 24` falsifies every requirement. `golem falsify <id>` watches one.
- `golem replay <id>` re-runs the pinned counterexample and writes `.golem/replays/<id>.csv`.
- `golem gate` exits 0 only when every requirement holds and no pinned seed fails, and exits 2 otherwise.

A `held` verdict means no counterexample was found within the stated search budget. It is not a proof.

## Never edit a requirement to make a test pass

When a requirement fails, change the controller. Do not weaken, delete or reword the requirement to make a run green. If you think a requirement is wrong or too harsh, propose a change with the `propose_requirement` tool. It records the line in `.kiro/specs/<robot>/proposals.md`, where a human or Kiro spec mode decides whether to merge it into `requirements.md`.

## Hook timeouts

`hooks/golem.json` sets each timeout in seconds. Raise them for a slower app.

| Hook | Timeout | Reason |
|---|---|---|
| Check requirements on save | 30 s | Compile only; no trial runs. |
| Falsify controller on save | 300 s | 24 trials per requirement at up to 2 s of simulated time each. |
| Gate the agent (Stop) | 300 s | Pinned seeds plus the 24-trial quick budget. |
| Test after spec task | 300 s | The default of 64 trials per requirement. |
| Summon the ghosts (manual) | 1800 s | 256 trials per requirement. |

The Stop hook blocks the agent at most once per stop attempt and at most five times in a row per session. Kiro runs the Stop hook once per user turn, so the repair loop is driven by the `golem-tuner` agent itself and by the `falsify-and-fix` workflow, which runs `golem gate` after every tuner iteration.

## When `golem` is not on the path

`golem init` registers the MCP server as `golem mcp`. When the `golem` binary is not on the path, replace the entry in `.kiro/settings/mcp.json` with:

```json
{
  "mcpServers": {
    "golem": { "command": "npx", "args": ["golem-spec", "mcp"] }
  }
}
```
