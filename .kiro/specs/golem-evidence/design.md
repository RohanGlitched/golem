# Design Document

## Overview

`golem-evidence` is the experiment layer in `evidence/`. It runs three experiments against the real engine and real apps, appends raw records to `evidence/results/*.jsonl`, and turns those records into `evidence/REPORT.md` and `site/data/*.json`. The pre-registration `evidence/PREREG.md` is committed before any campaign.

This design replaces an earlier, much longer draft (it is in git history at `bf43343`). It keeps the requirement numbers as the contract and the scope below as the build.

| Experiment | Question | Scale |
|---|---|---|
| `falsifier` | Does guided search find breaks sooner than random sampling at the same budget? | every `Expected_Break` line of `apps/stagger` (and of `apps/candy` once it has a `golem.config.json`), 20 search seeds per arm, budget 96 |
| `map-g1` | How hard a 0.2 s pelvis push does the G1 policy survive, by direction and stride phase? | 36 directions x 5 phases x 3 seeds, 8 bisection steps (4,860 trials) |
| `agent-gate` | Does the Stop gate stop an agent from claiming a red controller is done? | N runs per arm (default 6), hard credit cap (default 150) |
| `report` | Same numbers, in prose and JSON | reads only committed files |

## Decisions

- **Real engine only.** Scripts import `golem-spec` and `golem-spec/node` (built to `skeleton/dist`). Apps load through `createDefaultDeps().loadApp` and the Node worker pool through `createPool`. There are no mocks in the runners. Tests inject fakes into the pure cores.
- **Functional core, thin shell.** `evidence/scripts/core/` holds pure functions (statistics, severity, bisection, summaries, stream-json parsing, credit cap, report tables). `evidence/scripts/` holds the runners that do I/O. Every runner takes its effects (`runTrial`, `falsify`, `exec`, `clock`, `fs`) as arguments.
- **Raw files are append-only JSONL**, one record per line, sorted keys. A runner resumes by skipping the keys already in the file. Summaries and reports are pure functions of the raw files.
- **Run with `vite-node`** (`npm run <name> -w evidence`), since the scripts are TypeScript and `golem-spec` is consumed from `dist`.

## Statistics (`core/stats.ts`)

- **Wilcoxon signed-rank, exact.** Zero differences are dropped. Ties get average ranks. Ranks are doubled to integers and the null distribution of W+ is counted by dynamic programming over subset sums, which is the same as enumerating all 2^m sign assignments. Two-sided p = min(1, 2 x min tail). Exact is used for m <= 20 (always, here: n = 20 pairs). For m > 20 the function throws; this study never reaches it.
- **Clopper-Pearson** two-sided 95% interval from the regularised incomplete beta function (continued fraction) and bisection. k = 0 gives lower 0, k = n gives upper 1.
- **Quantiles** type 7. **Fisher exact** two-sided for 2x2 tables (agent-gate).
- No multiplicity correction is applied across requirements; the report prints the Bonferroni-adjusted p beside each raw p.

## Falsifier benchmark (`falsifier.ts`)

For each requirement and each search seed s in 1..20, run `falsify(req, pool, { budget: { maxTrials: 96 }, searchSeed: s, mode })` once with `mode: 'full'` (guided) and once with `mode: 'random-only'`. No seed database is passed, so Phase 0 is empty. One pool per campaign, sized by the default (physical cores).

Record per run: `found`, `trialsToFirst` (`counterexample.foundAfter`, completion-order count inside the search phases), `sevFound` (lowest severity of any failing trial in phases 1 and 2, from `onResult`), `sevShrunk` (severity of the shrunk counterexample, guided arm only), `robustness`, `trials` (all phases), `wallMs`.

Severity of a scenario: the mean over dimensions with `severity` up or down and `max > min` of the position in the range, 0 = mildest, 1 = harshest (`up`: (v - min) / (max - min); `down`: (max - v) / (max - min)).

Pairing: guided and random-only with the same search seed. Paired outcome for the test: `trialsToFirst`, censored at 97 when not found; and `sevFound`, censored at 1 when not found.

## G1 map (`map-g1.ts`)

Same method as the prototype `map-g1.mts`: for each (direction, phase, seed) run the push at 400 N; if it holds, record `heldN = 400`; else bisect 8 steps on [0, 400] N for the largest force that holds. The requirement line lives in `evidence/requirements/map-g1.md`, so pool workers compile it like any app requirement. Cells run concurrently, at most `pool.size` at a time. Rows are sorted by (direction, phase, seed) before summarising. `--dir-indices 0,18` restricts the grid for a spot check.

## Agent-gate harness (`agent-gate.ts`)

Per run: copy the app (candy when `golem.config.json` exists, otherwise stagger) into a temporary workspace under the OS temp directory, with a junction to the repo `node_modules`; run `golem init`; for arm A remove every Stop hook (`.kiro/hooks/*.json` and the `stop` hook inside `.kiro/agents/golem-tuner.json`). Put a `golem` shim for `skeleton/dist/cli/main.js` on `PATH`. Hash `requirements.md` files. Run

`kiro-cli chat --no-interactive --trust-all-tools --agent golem-tuner --output-format stream-json "<goal>"`

parse the stream, then run an independent `golem gate --search-seed 7919` in the workspace and re-hash. Arms are interleaved (A, B, A, B, ...) to spread drift. Credits are summed from every `"credits":[{"usage":N}]` event; the process is killed when the running total would pass the cap, and no run starts when the total used is at or above the cap. The temporary workspace is removed afterwards.

Final-message claim: a pure keyword rule (`core/claims.ts`) with positive and negative patterns, fixed in `PREREG.md`. The final message text is stored beside the verdict so a person can audit the rule.

## Report (`report.ts`)

Pure functions from parsed records to Markdown tables and JSON. Writes to temporary names, then renames. Sections: methods, budgets, results with intervals, limits, what went wrong (taken from `evidence/results/NOTES.md`, which holds the dated incidents including the invalid pre-fix map run).

## Correctness Properties

1. Wilcoxon p equals brute-force enumeration for random small samples; p is in (0, 1]; swapping the arms preserves p.
2. Clopper-Pearson contains k/n, is within [0, 1], widens with confidence, and has the exact boundary values.
3. Bisection returns a held force below a broke force within 400/2^8 N, for any monotone threshold.
4. The map summary of the committed raw rows equals the committed summary (apart from `seconds`).
5. Credit cap: the used total never exceeds cap + one event; no run starts at or above the cap.
6. Resume: running a plan twice appends nothing the second time.
7. Report output is a pure function of its inputs (same input, same bytes).

## Testing

Vitest with fast-check for the properties above. Pure-core tests need no MuJoCo or `kiro-cli`. One short physics test checks the map cell at two directions against the committed rows.
