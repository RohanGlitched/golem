# golem-falsify-hardening: before and after

Spec: `.kiro/specs/golem-falsify-hardening/` (bugfix.md, design.md, tasks.md). Audit: `falsify-audit.md`.
Probe output on the unfixed code: `falsify-hardening-runs/before-*.txt`; after: `after-*.txt`.
Benchmarks: `falsify-hardening-runs/bench-100.txt` and `bench-300.txt` (`npx tsx ../docs/reviews/falsify-bench.mts 300` from `skeleton/`).
Probe scripts now import this checkout through relative paths (they pointed at the `golem-wt-earsfix` worktree).

Test suite after the work: 158 files, 892 tests pass (`npx vitest run` in `skeleton/`); `tsc --noEmit` is clean.

## Per defect

| # | Defect | Before | After | Regression test |
|---|---|---|---|---|
| 1 | Label computed at the shrunk point | Probe 4: robust failure labelled `robust` in 7/30 runs (noise 0.02) and 2/30 (noise 0.05) | 30/30 and 30/30; seed-sensitive case still 30/30 `seed-sensitive`; `meta.boundarySensitive` reports the shrunk point | `falsifier.classification.test.ts` |
| 2 | CEM collapses on flat robustness | Flat 0.11% needle, 1000 trials: full 9/30 vs random-only 21/30 (probe); 26/100 vs 57/100 (CI property). Flat 0.78% at 400: 25/30 vs 29/30 | 15/30 vs 22/30 (probe, 30 seeds); 272/400 vs 260/400 and 270/400 vs 275/400 (CI property); 3000 seeds: 67.5% vs 67.7%. Flat 0.78%: 30/30 vs 29/30 | `search.benchmark.property.test.ts`, `cem.test.ts` |
| 3 | Property 22 assertion commented out | Monotonicity-in-k `expect` never ran | Runs (200 cases), passes | `test-hygiene.test.ts` |
| 4 | Wall-time overrun on small pools | Probe 6, 5 ms trials, `maxWallMs` 300: 322 ms; generation 64: 321 ms. Fake clock: 320 ms | 300 ms and 313 ms (real time); fake clock ≤ 305 ms for pool sizes 1 and 4, generation sizes 32 and 64; `stopReason: 'time-budget'` | `falsifier.wall.test.ts`, `budget.test.ts` |
| 5 | Timed run not replayable; flooring | No `meta.replayOptions`; `maxTrials` 7 ran 6 search trials | `meta.replayOptions` reruns the identical spec sequence (probe: `identical=true`, held and broken timed runs, Phase 0 cut by time); 7 of 7 trials; `maxPinned` | `falsifier.replay.test.ts` |
| 6 | Windows temp-dir removal | Direct `rmSync` without retry; worker builds of two test files shared one `pid-Date.now()` directory (seen during this work: `ENOTEMPTY ... golem-pool-test-9400-...\pool`) | `removeTempDir` with 10 retries; `mkdtempSync` per build | `test-hygiene.test.ts`, `worker-build.test.ts` |
| 7 | Single-pass, monotone shrinker | Window (130, 165) N from 240 N: 200.6 N. Interaction case: 151.6 N | (130, 132.5] N; about 50 N after the second pass. Half-space probe: 30/30 within tolerance, median 11 shrink trials (was 8). The probe's 20 N window [100, 120] from ~250 N is still missed (narrower than the 31 N sweep step) | `shrink.sweep.test.ts` |
| 8 | Node pool size = logical − 1 | 11 workers on this 6-core, 12-thread machine | 6 (physical cores; probe 1.4 s once on Windows) | `cores.test.ts` |
| 9 | Design doc drift | `BudgetClock.started`, `canStartGeneration`; tolerance 1e-12/1e-9 vs 1e-13 in code; no defaults table | Sections 3–9, 13, data models, Properties 5/7/17/26 rewritten; defaults table checked against exported constants | `design-doc.test.ts` |
| 10 | UI API gaps | Progress events without seeds, CEM state, elapsed time; `onResult(r)` only; no replay helper; `lowestRobustness` stayed 0 after −0 | `seeds`, `elapsedMs`, `timeFraction`, Phase 2 `cem`; `onResult(r, { phase, generation, index })`; `replayCounterexample`; −0 is the minimum | `falsifier.ui.test.ts` |

## Added items

| Item | Result |
|---|---|
| A. Search property in CI | Graded 0.11% needle at 400 trials: full 100/100 vs random-only 24/100 and 49/100 (two seed sets). Flat 0.11% needle at 1000 trials, 400 seeds per set: 272 vs 260, 270 vs 275 (bound: full ≥ random − 32). Fixed fast-check seed 20261119; about 5 s. The bound was first set at 8% of 100 runs, which is about 1.3 standard deviations, and failed once (58 vs 70) after the Phase 1 default changed; it now uses 400 runs (about 2.6 sd). |
| B. Calibration | Noise sweep, 325 classified runs: truly robust (p ≥ 0.99) labelled robust 188/188; truly seed-sensitive (p ≤ 0.5) labelled seed-sensitive 51/51; 86 runs with 0.5 < p < 0.99 excluded. The unfixed rule (label at the shrunk point) would have scored 33/188 on the robust row. |
| C. Exact Clopper-Pearson | `Verdict.failureRateUpper95Exact` beside the rule of three, e.g. 20 passing random trials: 0.1391 beside 0.15. Max relative error against exact binomial inversion: 6.72e-12 (probe 5, unchanged). |
| D. `replayCounterexample` | Re-runs `(app, reqId, scenario, seed)` with `record: 'poses'`; returns `reproduced`. |
| E. Phase 1 fraction | Default changed from 0.4 to 0.2 (table below). Cost: a looser `failureRateUpper95` for held runs (400 trials: 3/80 = 3.75% instead of 3/160 = 1.9%). Documented in `skeleton/src/falsify/README.md`. |

## Benchmark: 300 search seeds per case, equal budgets

Found / 300 with a two-sided 95% Clopper-Pearson interval; median `foundAfter` in trials ("-" when fewer than half the runs found the region). All rows use the hardened code; "full f1=0.4" is the old Phase 1 fraction.

| Case | Budget | random-only | full f1=0.4 | full f1=0.2 (default) |
|---|---|---|---|---|
| graded 0.11% (130–135°, > 230 N) | 400 | 107 (30–41%), - | 300 (99–100%), 207.5 | 300 (99–100%), 140.5 |
| graded 0.11% | 1000 | 207 (63–74%), 613 | 300, 435 | 300, 241 |
| flat 0.11% | 1000 | 207 (63–74%), 613 | 185 (56–67%), 712 | 188 (57–68%), 753.5 |
| graded 0.78% (130–140°, > 180 N) | 200 | 241 (75–85%), 89.5 | 300, 83 | 300, 50 |
| flat 0.78% | 400 | 293 (95–99%), 89.5 | 285 (92–97%), 89.5 | 287 (93–98%), 88 |
| 0.78% + 4 extra dimensions (0.19%) | 1000 | 250 (79–87%), 409 | 300, 401 | 300, 219 |
| wrap 355–5°, > 230 N (0.22%) | 400 | 172 (52–63%), 329 | 300, 195 | 300, 120 |

On the flat needles the full search is within noise of random-only: over 3000 seeds, flat 0.11% at 1000 trials gives random-only 67.7%, f1 0.4 66.9%, f1 0.2 67.5%; flat 0.78% at 400 trials gives 96.6%, 95.9%, 96.3%. The 300-seed rows above sit 1 to 2 standard deviations below random-only for this seed set. Before the fix the same flat 0.11% case was 9/30 against 21/30.

Audit headline, before → after (30 seeds, `falsify-probe-search.mts`): graded 0.11% at 400 trials, full 30/30 with median 211 → 30/30 with median 143.5; graded 0.11% at 1000, median 435 → 247.5; flat 0.11% at 1000, 9/30 → 15/30.

## Not changed

- The 3 or 6 verification trials still run past `maxWallMs` (bugfix 4.9).
- Real-time runs can overrun by more than one wave when the per-wave estimate is low (313 ms for generation 64 in probe 6); the one-wave bound is exact only on the fake clock.
- No pool scaling chart was produced (the audit's publish list); the default pool size change rests on the audit's measurement (1 → 8 workers: ×3.2).
