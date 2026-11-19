# Implementation Plan: golem-falsify-hardening

Rules for every task:
- Write the regression test first, run it on the unfixed code and record the failure in the commit message, then fix.
- Never weaken an assertion to make a test pass. Where an old test encoded a defect or a superseded behaviour, replace it and say why in the commit message.
- All falsify tests use synthetic trial functions; statistical properties use a fixed, logged fast-check seed.
- Commit after each task as `golem-falsify-hardening: <n> <what>`, staging only `skeleton/`, `docs/reviews/` and `.kiro/`.

## Tasks

- [x] 1. Spec, probe paths and baseline
  - Write `bugfix.md`, `design.md`, `tasks.md`; record the contract additions in `.kiro/steering/interfaces.md`.
  - Point the probe scripts at this checkout (relative imports) and save their output on the unfixed code in `docs/reviews/falsify-hardening-runs/before-*.txt`.
  - _Bugfix: introduction_

- [x] 2. Restore the commented-out property (defect 3)
  - Test: `test-hygiene.test.ts` fails on any `//` comment holding a literal `\n` in a test file.
  - Split line 33 of `beta.property.test.ts`; check that Property 22 passes with the assertion live.
  - _Bugfix: 3.2–3.4_

- [x] 3. Retrying temp-directory removal (defect 6)
  - Test: the hygiene test fails on a direct `rmSync` in pool tests and testkits.
  - Add `removeTempDir` to a pool testkit with `maxRetries: 10, retryDelay: 50`; use it at every call site.
  - _Bugfix: 6.2–6.4_

- [x] 4. Classify at the original failure (defect 1)
  - Test: on `(150 - force)/250 + 0.02·N(0,1)`, at least 28 of 30 runs are `robust`; `boundarySensitive` is set; no extra trials when the shrink changed nothing; the seed-sensitive case stays `seed-sensitive`.
  - Update the trial bound to `T + R + 6` in the accounting property.
  - _Bugfix: 1.2–1.8_

- [x] 5. CEM elites with ties, uniform fallback, elitism, LHS mix, generation size 32 (defect 2)
  - Tests: `eliteSet` includes every tie and flags no information; a flat generation gives a uniform state; carried elites survive a bad generation; the LHS share sits at interleaved positions; the flat needle at 1000 trials is found no less often than random-only minus 8% (fails before: 9/30 against 21/30).
  - _Bugfix: 2.2–2.9_

- [x] 6. Generation prefix, quota flooring, `maxPinned`, `meta.replayOptions` (defect 5)
  - Tests: `maxTrials = 7` uses 7 search trials; full-mode Phase 1 is a prefix of random-only Phase 1 for every Phase 1 size; replaying a timed run (fake clock) with `meta.replayOptions` gives the identical spec sequence and verdict.
  - _Bugfix: 5.3–5.7_

- [x] 7. Time-aware grants (defect 4)
  - Tests (fake clock, 5 ms per wave): held run with `maxWallMs` 300 ends by 305 ms for generation sizes 32 and 64 and pool sizes 1 and 4; a time-limited generation ends its phase; shrink trials respect the wave estimate; trial-only runs never read the clock.
  - _Bugfix: 4.2–4.9_

- [x] 8. Shrinker sweep and second pass (defect 7)
  - Tests: a failing window (130, 165) N that bisection jumps over is found from 240 N (before: 200.6 N); a second pass lowers force from 151.6 N to about 50 N when a later dimension changed; a single severity dimension gets no second pass; Properties 10–14 still hold.
  - _Bugfix: 7.3–7.7_

- [x] 9. Physical-core pool size (defect 8)
  - Tests: the `/proc/cpuinfo` parser counts (physical id, core id) pairs; `defaultNodePoolSize()` equals `physicalCoreCount()` when known.
  - _Bugfix: 8.2–8.4_

- [x] 10. UI API: progress fields, `ResultInfo`, `replayCounterexample`, `-0` minimum (defect 10, item D)
  - Tests: events carry seeds, `elapsedMs`, `timeFraction` and Phase 2 `cem`; `onResult` info matches the generation; a found counterexample replays with `reproduced: true` and poses; `lowestRobustness` is `-0` after `[0, -0]`.
  - _Bugfix: 10.5–10.9, D.1_

- [x] 11. Exact Clopper-Pearson on the Verdict (item C)
  - Test: `failureRateUpper95Exact` equals `1 - 0.05^(1/n)` with no failures and `clopperPearsonUpper(n, k)` otherwise, and is set exactly when `failureRateUpper95` is.
  - _Bugfix: C.1–C.2_

- [ ] 12. Search-effectiveness property (item A)
  - `search.benchmark.property.test.ts`: graded needle at 400 trials, full ≥ random-only; flat needle at 1000 trials, full ≥ random-only − 8%.
  - _Bugfix: A.1–A.2_

- [ ] 13. Classification calibration (item B)
  - `classify.calibration.test.ts`: confusion matrix over the noise sweep; robust recall ≥ 90%, seed-sensitive recall ≥ 85%.
  - _Bugfix: B.1–B.2_

- [ ] 14. Phase 1 fraction benchmark (item E)
  - `docs/reviews/falsify-bench.mts`; change the default to 0.2 only under bugfix E.2; document the trade-off in the README.
  - _Bugfix: E.1–E.2_

- [ ] 15. Design document and README (defect 9)
  - Test: `design-doc.test.ts` checks the `BudgetClock` methods and the stated defaults against the code.
  - Rewrite the drifted sections of `golem-falsify/design.md` and `falsify/README.md`.
  - _Bugfix: 9.2–9.4_

- [ ] 16. Final checkpoint
  - Full falsify and pool suites, typecheck, probe scripts after the fixes (`docs/reviews/falsify-hardening-runs/after-*.txt`), before/after table per defect and benchmark numbers in `docs/reviews/falsify-hardening.md`.
