# Implementation Plan: golem-evidence

Compact plan, built in one session in this order. Each task that adds logic adds its Vitest tests (fast-check for the properties in `design.md`). Commit message form: `golem-evidence: <n> <what>`.

- [x] 0. Spec: compact `design.md` and `tasks.md`.
- [x] 1. `evidence/PREREG.md`: budgets, seeds, metrics and analysis for each experiment, committed before any new campaign.
  - Also: `evidence/package.json` scripts, `vitest.config.ts`, `core/stats.ts` (exact Wilcoxon, Clopper-Pearson, Fisher, quantiles) with tests.
- [x] 2. `bench-falsifier`: `core/severity.ts`, `core/jsonl.ts`, `falsifier.ts`, tests with a synthetic trial function; run the campaign; write `results/falsifier.jsonl` and `results/falsifier.summary.json`.
- [x] 3. `map-g1`: `core/bisect.ts`, `core/map-summary.ts`, `map-g1.ts` on the Node pool, `evidence/requirements/map-g1.md`; test that the committed rows give the committed summary; run a 2-direction spot check against the committed rows; remove `map-g1.mts`.
- [x] 4. `agent-gate`: `core/stream.ts` (stream-json parser, credits, claim rule), `core/credit-cap.ts`, `agent-gate.ts` with injected `exec`; tests; dry run with N = 1 per arm and a tiny goal; write `results/agent-gate.dryrun.jsonl`. Do not run the full experiment.
- [x] 5. `report.ts`: `results/*.jsonl` to `evidence/REPORT.md` and `site/data/{falsifier,g1-map,agent-gate,meta}.json`, with tests.
