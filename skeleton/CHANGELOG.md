# Changelog

## Unreleased

- The truncated-normal sampler of the cross-entropy search returns the bound, not the mean, when a draw at the very edge of the mass rounds to a quantile of ±Infinity, so its draws stay monotone (a fast-check counterexample from CI: an upper bound 8 sigma out and u just below 1).

## 0.1.3

- Python controllers. `pythonController(...)` in `golem-spec/node` runs a controller written in Python as a GOLEM `Controller`: each trial worker starts the script once, sends a reset before every trial and the observation every control step, and blocks (`Atomics.wait`) until the action returns, so trials stay deterministic and synchronous. About 80 µs per step on a laptop. Node only (CLI, gate, MCP); the browser studio still runs JavaScript controllers.
- The starter gains `controller.py` (the same law as `app.js`) and `golem_bridge.py` (the Python side, standard library only, little-endian float64 frames on stdin and stdout). `GOLEM_CONTROLLER=python` makes the starter use them; its verdicts, margins and counterexamples are the same as with the JavaScript controller, and the CI starter job checks that.
- `golem init` writes the two Python files with the rest of the starter.

## 0.1.2

- `golem gate` confirms a green. When every line meets its expectation, each `Expected_Hold` line is searched again with a second search seed, derived from the first, before the gate prints green. Experiment 3b found agents trusting a 24-trial green that another search seed broke (a 200 N push that still breaks requirement 1.3).
- The second seed is `fmix32(first seed XOR 0xC0DEF57A)`: a pure function of the first seed (1 by default, or `--search-seed`, or `searchSeed` in `golem.config.json`), a uint32 that is never 0 and never the first seed. Seed 1 confirms with 588244584. The budget is that of the first pass, as searched trials on top of the pinned seeds, which re-run first.
- A line that held under the first seed and breaks under the second makes the gate red. The output (and the `--kiro` block reason) says so, with both seeds, `reproduce: npx golem-spec replay <id>` and a `search again` command; the counterexample is pinned. An error in the confirmation run is red too. A green prints `confirmed: ...` with both seeds and the total trials.
- New flags: `--confirm-budget <n>` (searched trials per line in the second pass) and `--no-confirm` (skip it; the output says `NOT confirmed (--no-confirm)`; the two cannot be combined). Both work with `--kiro` and `--json`.
- `.golem/report.json` gains `meta.confirm` (`status`, `firstSeed`, `secondSeed`, `budget`, `reqIds`, `failedIds`, `trials`) and a `confirmation` on each searched verdict. `--json` gains `confirm` and `totalTrials`. The total trials in the green line now include the confirmation pass.
- The pass runs only when every line already meets its expectation; a red first pass is reported as before. `Expected_Break` lines keep their 4-times retry and are not confirmed. The MCP tools do not gate and are unchanged.
- A gate takes about twice as long as in 0.1.1 when it is green. Changed in the pack: `steering/golem-ears.md` (a section on the confirmation, the Stop hook row of the timeout table).
- Projects should run `npx golem-spec init --force` to replace the installed pack.
- `golem replay` prints a `studio:` link only when `golem.config.json` names a `studioUrl` or the app has its own `web/index.html`; otherwise it says the app has no studio page (the starter used to get a path that does not exist).
- The red gate lines agree in number: `gate RED: 1 of 3 requirements is not held`, `gate RED: 1 of 11 requirements does not meet its expectation`.
- The starter README and spec give a fix that is checked to turn the gate green (a 60 N motor and doubled gains). A stronger motor alone is not enough, and the old text implied it was.
- Studio: the verdict panel's margin row says how to read its sign (`Worst margin (below 0 = broke)`), the floor summary names a direction sector (`Weakest sector, around 245 deg`) so it no longer seems to disagree with the exact angle of the counterexample, and the counterexample's seed classification reads `fails again with other seeds` instead of `classification: robust`.
- Studio: a new `shippedSeeds` option re-runs an app's committed counterexamples (its `.golem/seeds`) first when a line is summoned, before seeds pinned in the browser and before the search, as `golem test` does; so a line the CLI found broken shows broken in the studio too, whatever the browser's budget.
- Studio: the floor aura also reads a push written as a ratio (such as a share of the robot's weight) when a line has no force dimension, and its summary prints it as `push.weight = 58.5 %`.

## 0.1.1

- The Kiro pack runs every command as `npx --no-install golem-spec <command>`. Kiro's hook shells and MCP launcher do not have `node_modules/.bin` on the path, so the bare `golem` of 0.1.0 was not found, and a bare `npx golem` resolves to an unrelated npm package. `--no-install` makes npx use the copy installed by `npm i -D golem-spec` and never download another.
- The MCP entry is now `{ "command": "npx", "args": ["--no-install", "golem-spec", "mcp"] }` in `settings/mcp.json`, the three agents, the Power and the Crew app.
- Changed in the pack: `hooks/golem.json`, the agents (shell allow-lists, Stop hook), skills, steering, the `falsify-and-fix` workflow and the pack README.
- The CLI help, usage errors and `reproduce:` lines print `npx golem-spec <command>`. The bin is still named `golem`.
- `scripts/build-pack.ts` rejects agents that use the old `golem` command forms.
- Projects that ran `golem init` with 0.1.0 should run `npx golem-spec init --force` to replace the installed pack.
- `golem init` in a project with no robot also writes a starter cart-pole robot (`app.js`, `robot/scene.xml`, `.kiro/specs/cartpole/requirements.md`, `README.md`) and a `golem.config.json` that points at it, so `check`, `test --budget 24`, `gate` and `replay 1.2` work straight after `npm i -D golem-spec` with no TypeScript and no build step. Line 1.2 of the starter breaks on purpose. The starter ships in the package (`starter/`).
- `golem init` never overwrites `app.js`, `robot/`, the cartpole spec or `README.md`, and writes no starter when `golem.config.json` already names an app that exists. The new flag `--no-starter` skips it. `--force` still applies to the pack only, and no longer replaces a `golem.config.json` that names an app that exists. An earlier empty placeholder config is replaced when the starter is written. `golem init` prints `next: npx --no-install golem-spec check` after writing the starter.
- A `.js` app written as an ES module now loads when the nearest `package.json` has no `"type": "module"` (the default after `npm init -y`). The kit imports a copy under `node_modules/.cache/golem/` with `import.meta.url` still pointing at the original file. An app that also imports other files still needs `"type": "module"`, and the error says so.

## 0.1.0

First release.
