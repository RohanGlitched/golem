# Bugfix Requirements Document: golem-falsify-hardening

## Introduction

An independent review of `skeleton/src/falsify` and `skeleton/src/pool` (`docs/reviews/falsify-audit.md`, probes `docs/reviews/falsify-probe-{search,stats,replay}.mts`) found ten defects. Two change verdict metadata or search results without any error: the robust / seed-sensitive label is computed at the boundary, where it is close to a coin flip, and cross-entropy search on a flat robustness function does worse than random sampling. This spec fixes defects 1 to 10 and adds five outcome-level items (A to E): a search-effectiveness property in CI, a calibration test for the classification label, the exact Clopper-Pearson bound beside the rule of three, a `replayCounterexample` helper, and a benchmarked default for the Phase 1 fraction.

Terms:
- **Falsifier**: `falsify` in `skeleton/src/falsify/falsifier.ts`.
- **Original failure**: the failing search trial with the lowest robustness (the trial Phase 3 starts from). **Shrunk point**: the scenario the shrinker returns.
- **Graded needle**: the synthetic function of the search probe, `max(dA/360, (230 - force)/250)` with `dA` the signed circular distance outside angle [130°, 135°], over force [0, 250] N × angle [0, 360)°. The failing region is 0.11% of the space. **Flat needle**: the same region, robustness -0.01 inside and 1 outside.
- **Wave**: `pool.size` trials, the number a pool runs at the same time.
- **Generation prefix**: the first `n` scenarios of a generation drawn at its full nominal size.

The golem-falsify criteria and design text this spec supersedes are listed per defect. Every other golem-falsify criterion still holds.

## Defect 1: classification at the shrunk point mislabels robust failures (HIGH)

### Current Behavior
1.1 WHEN a failure is robust in the interior (probe 4: `(150 - force)/250 + σ·N(0,1)`, base margin down to -0.4) THEN the three verification seeds run at the shrunk point, where the base margin is about 0, and the label is `seed-sensitive` in 23 of 30 runs at σ = 0.02 and 28 of 30 at σ = 0.05.

### Expected Behavior
1.2 THE falsifier SHALL run the three verification seeds at the original failure and SHALL set `meta.classification` (and the pin entry's `classification`) from those trials, with the same rule as before (all three below 0 gives `robust`).
1.3 WHEN the shrunk point differs from the original failure THEN THE falsifier SHALL also run the three verification seeds at the shrunk point and SHALL report `meta.boundarySensitive` (and the pin entry's `boundarySensitive`): `true` when any of them is at or above 0, `false` when all three fail, unset when any of them errors.
1.4 WHEN the shrunk point equals the original failure THEN THE falsifier SHALL NOT run extra trials and SHALL set `boundarySensitive` to `classification === 'seed-sensitive'`.
1.5 `meta.verification` SHALL record the scenario it ran at; `meta.boundaryVerification` SHALL record seeds, scenario, robustness and errors of 1.3.
1.6 WHEN probe 4 runs at σ = 0.02 THEN at least 28 of 30 runs SHALL be labelled `robust`.

### Unchanged Behavior
1.7 Verification trials SHALL CONTINUE TO run even when the budget is exhausted, to use `verificationSeeds(searchSeed, originalSeed)`, and to leave the counterexample's scenario, seed and robustness unchanged.
1.8 The genuinely seed-sensitive case of probe 4 (fails in about 11% of seeds) SHALL CONTINUE TO be labelled `seed-sensitive` in 30 of 30 runs.

Supersedes golem-falsify 7.1 ("the shrunk scenario runs under each verification seed") and the trial bound `trials <= T + R + 3`, which becomes `trials <= T + R + 6`.

## Defect 2: cross-entropy search collapses on flat robustness (HIGH)

### Current Behavior
2.1 WHEN every trial of a generation has the same robustness (the flat needle) THEN elites are the lowest input indices, sigma shrinks onto an arbitrary cluster, and the search does worse than random: flat needle at 1000 trials, 9/30 found against 21/30 for random-only; 0.78% flat needle at 400 trials, 25/30 against 29/30.

### Expected Behavior
2.2 THE elite set SHALL be every observation whose robustness is at or below the `e`-th lowest robustness `γ` (`e = ceil(eliteFraction · m)`), so tied observations enter together and the input index never decides membership.
2.3 WHEN every usable observation has the same robustness (no information) THEN THE fit SHALL return the uniform distribution on every non-fixed dimension (`uniform` for interval dimensions, `uniformCircle` for wrap dimensions), and a generation drawn from that state SHALL be drawn wholly by Latin hypercube, the distribution random-only search uses. The same applies to the initial fit from Phase 1 and when Phase 1 gives fewer than 2 elites.
2.4 THE search SHALL keep the `e` best observations of the previous fit (ordered by robustness, then run order) and add them to the next generation's observations before selecting elites.
2.5 EACH Phase 2 generation SHALL draw `round(lhsFraction · G)` of its `G` scenarios from a Latin hypercube (option `cem.lhsFraction`, default 0.2, in [0, 1)), at interleaved positions, from a stream separate from Phase 1.
2.6 THE default `cem.generationSize` SHALL be 32.
2.7 WHEN the flat needle runs at 1000 trials over a fixed set of search seeds THEN full mode SHALL find it in no fewer runs than random-only minus 8% of the runs (Item A).

### Unchanged Behavior
2.8 `selectElites` SHALL CONTINUE TO be a total order with lower-index tie-break (Property 6); sampling SHALL CONTINUE TO be dimension-major from one stream per generation, in range and wrap-aware (Properties 2, 8); search SHALL CONTINUE TO be deterministic (Property 19).
2.9 On the graded needle full mode SHALL CONTINUE TO find the region in 30 of 30 runs at 400 trials.

Supersedes golem-falsify 5.1 (midpoint and 25% width prior), 5.5 (refit from the generation alone) and the default generation size 16.

## Defect 3: a property test is commented out

### Current Behavior
3.1 WHEN `beta.property.test.ts` runs THEN the monotonicity-in-`k` assertion of Property 22 never executes, because line 33 holds literal `\n` sequences inside a `//` comment, which comments out the `fc.pre` and the `expect`.

### Expected Behavior
3.2 THE comment, the precondition and the assertion SHALL be on separate lines, so the assertion runs.
3.3 A hygiene test SHALL fail when any `//` comment in a test file under `skeleton/src` contains a literal `\n`.

### Unchanged Behavior
3.4 The documented exception (rule of three above the exact `k = 1` bound for `n <= 3`) SHALL CONTINUE TO be excluded by the precondition.

## Defect 4: wall-time overrun on small pools

### Current Behavior
4.1 WHEN trials take 5 ms on a pool of size 1 and `maxWallMs` is 300 THEN the run takes 322 ms (generation size 64: 321 ms), because a generation is granted without regard to the time left and the pool size.

### Expected Behavior
4.2 WHERE `maxWallMs` is set THE falsifier SHALL measure each batch's wall time and keep an estimate of the time per wave (exponential average, weight 0.5, of `batchMs / ceil(n / pool.size)`).
4.3 BEFORE submitting trials of a generation THE falsifier SHALL grant at most `floor(timeLeft / waveMs) · pool.size` of them, where `timeLeft` runs to the phase's deadline.
4.4 WHEN no estimate exists yet THEN THE falsifier SHALL submit the first `min(n, pool.size)` trials of the generation as their own batch, measure them, and grant the rest of the generation by 4.3.
4.5 A generation shortened by 4.3 SHALL be the last generation of its phase.
4.6 A shrink trial SHALL start only when `elapsed + waveMs` is within the shrink deadline.
4.7 WHEN a run with 5 ms trials on a pool of size 1 and `maxWallMs` 300 holds THEN `verdict.ms` SHALL be at most 305 ms (one wave over), for generation sizes 32 and 64 and pool sizes 1 and 4.

### Unchanged Behavior
4.8 Without `maxWallMs` no decision SHALL read the clock (golem-falsify 19.5).
4.9 The three (or six) verification trials SHALL CONTINUE TO run past the deadline.

## Defect 5: a timed run cannot be replayed; fraction flooring wastes a trial

### Current Behavior
5.1 WHEN a timed run (phases 64/64) is replayed with `maxTrials = 128` THEN the default fractions give phases 51/76 and different trials; with `phase1Fraction = p1/T` the replay matches only by luck of rounding, and nothing in the result says how to replay.
5.2 WHEN `maxTrials = 7` with the default fractions THEN `floor(0.4·7) + floor(0.6·7) = 6` search trials run.

### Expected Behavior
5.3 THE falsifier SHALL return `meta.replayOptions`: the options (budget `maxTrials` equal to the search trials run, fractions, generation sizes, CEM and shrink settings, `maxPinned`) that, with the same requirement, pool trial function, seed database and search seed, run the identical sequence of trial specs and give the same verdict apart from `ms`.
5.4 Phase quotas SHALL be `q1 = min(T - u0, floor(f1·T + 1e-9))` and `q1+2 = floor((f1 + f2)·T + 1e-9)`, so Phase 2 may run up to `min(T - u0 - u1, q1+2 - u1)`. With the default `f2 = 1 - f1` the search uses all `T - u0` trials.
5.5 A generation shortened by its quota or by time SHALL be the generation prefix (Phase 1: the first `n` of a size-`G1` Latin hypercube; Phase 2: the first `n` of the size-`G` CEM and LHS mix).
5.6 THE option `maxPinned` (default unlimited) SHALL cap the Phase 0 trials.

### Unchanged Behavior
5.7 Trial-limited runs SHALL CONTINUE TO be deterministic, and full-mode Phase 1 SHALL CONTINUE TO be a prefix of random-only Phase 1 (now for every Phase 1 size, golem-falsify Property 5).

Supersedes golem-falsify 8.10 and 8.11 (separate floors) and design section 3 "the last one smaller" (an LHS of the reduced size).

## Defect 6: Windows `rmSync` race in Node test cleanup

### Current Behavior
6.1 WHEN a Node pool test removes its temp directory on Windows while a terminated worker still holds a handle THEN `rmSync` can throw `EBUSY` or `ENOTEMPTY`, failing a test that passed.
6.1a WHEN `node.test.ts` and `mujoco.integration.test.ts` build the worker entry in the same millisecond from the same process id THEN both write to one `golem-pool-test-<pid>-<ms>` directory, and the first file's cleanup deletes the other file's build while it is in use (seen during this work: `ENOTEMPTY ... golem-pool-test-9400-1795088384954\pool`, with the `sim/` files of the other build still inside).

### Expected Behavior
6.2 Pool tests and testkits SHALL remove temp directories through one helper that calls `rmSync` with `recursive`, `force`, `maxRetries: 10` and `retryDelay: 50`.
6.2a `buildWorkerEntry` SHALL create its output directory with `mkdtempSync`, so every build has its own directory.
6.3 A hygiene test SHALL fail when a test file or testkit under `skeleton/src/pool` calls `rmSync` directly.

### Unchanged Behavior
6.4 The tests SHALL CONTINUE TO leave no temp directory behind.

## Defect 7: the shrinker is single-pass and assumes monotonicity

### Current Behavior
7.1 WHEN the failing set is not monotone (probe 3: fails for force in [100, 120] or above 200, start near 240) THEN bisection tests 120, sees a pass, and lands at 200 to 202 N while 100 N fails.
7.2 WHEN dimensions interact THEN a dimension shrunk early is never revisited after a later dimension became milder.

### Expected Behavior
7.3 FOR each severity dimension, after the milder end passes, THE shrinker SHALL test the severities `k·hi/8` for `k = 1..7` in increasing order, stop at the first failing one, and bisect between the last passing and the first failing point (or between `7·hi/8` and `hi`).
7.4 AFTER the first pass THE shrinker SHALL run a second pass over each dimension that has another dimension changed after it was last shrunk.
7.5 WHEN the failing set is force in (130, 165) N or above 200 N and the shrink starts at 240 N THEN the shrunk force SHALL be in (130, 132.5] N (plain bisection tests 120, 180 and 210 and lands at 200 N). The sweep finds a failing window only when the window is at least `hi/8` wide; the probe's 20 N window [100, 120] from a start near 250 N (sweep step 31 N) is still missed, and the result is still a confirmed failure no more severe than the start.

### Unchanged Behavior
7.6 Properties 10 to 14 SHALL CONTINUE TO hold: the output fails under the original seed, is never more severe in any dimension, leaves `none` and fixed dimensions alone, respects `maxTrials` and the budget, is deterministic, and a scenario already at the milder end runs no trial.
7.7 The half-space probe SHALL CONTINUE TO land within tolerance of the true boundary in 30 of 30 runs.

Supersedes golem-falsify design section 5 procedure (plain bisection, single pass).

## Defect 8: the Node pool size defaults to logical cores minus one

### Current Behavior
8.1 WHEN no size is given THEN `createNodePool` starts `availableParallelism() - 1` workers (11 on a 6-core, 12-thread machine), while MuJoCo trials scale with physical cores (1 → 8 workers gives ×3.2 trials per second).

### Expected Behavior
8.2 THE pool SHALL export `physicalCoreCount()`: Linux from the distinct (physical id, core id) pairs of `/proc/cpuinfo`, macOS from `sysctl -n hw.physicalcpu`, Windows from the sum of `Win32_Processor.NumberOfCores`, cached after the first call; `undefined` when the probe fails.
8.3 `defaultNodePoolSize()` SHALL return `max(1, physicalCoreCount())`, or `max(1, availableParallelism() - 1)` when the count is unknown.

### Unchanged Behavior
8.4 An explicit `size` SHALL CONTINUE TO be used as given and validated.

## Defect 9: the golem-falsify design document has drifted

### Current Behavior
9.1 THE design document describes a `BudgetClock` with `started()`, `canStartGeneration` and `trialsUsed`, which the code does not have; states a Clopper-Pearson stopping tolerance of 1e-12 and 1e-9 where the code uses 1e-13; and does not describe the shrink reserve accounting as implemented.

### Expected Behavior
9.2 THE design document SHALL describe the code as it is after this spec: budget clock methods, quota formulas, wave estimate, CEM elites and fallback, LHS mix, shrinker sweep and passes, classification points and the bisection tolerance.
9.3 A test SHALL check that every method the document lists for `BudgetClock` exists, and that the defaults it states (Phase 1 fraction, generation sizes, elite fraction, LHS fraction, shrink tolerance and limit, bisection tolerance) equal the exported constants.

### Unchanged Behavior
9.4 Requirements text in `golem-falsify/requirements.md` SHALL stay as written; superseded criteria are listed here.

## Defect 10: gaps in the API the UI needs

### Current Behavior
10.1 THE progress event lacks per-trial seeds, the CEM mean and sigma per dimension, elapsed time and the time fraction.
10.2 `onResult` receives only the TrialResult, so the UI cannot tell the phase or generation of a trial.
10.3 There is no helper to re-run a counterexample with pose recording for the reel.
10.4 WHEN a generation reports robustness `0` and then `-0` THEN `lowestRobustness` stays `0` while the minimum is `-0` (found while checking a flaky run of Property 26).

### Expected Behavior
10.5 THE progress event SHALL add `seeds` (aligned with `scenarios`), `elapsedMs`, `timeFraction` (`elapsedMs / maxWallMs`, null without a time limit) and, for Phase 2, `cem`: one `{ name, kind, mu, sigma }` per dimension of the distribution the generation was drawn from (`mu`, `sigma` null for uniform and fixed).
10.6 `onResult` SHALL receive a second argument `{ phase, generation, index }` (index within the generation; Phase 3 shrink trials use generation 0 and the verification trials generation 1).
10.7 THE falsify module SHALL export `replayCounterexample(pool, cx, { appId?, record?, signal? })`, which runs `{ app, reqId, scenario, seed, record }` from the counterexample as one trial and returns the TrialResult with `reproduced: robustness === cx.robustness`. `record` defaults to `'poses'`.
10.8 `lowestRobustness` SHALL be the minimum under `Math.min` semantics (so `-0` is below `0`).

### Unchanged Behavior
10.9 Progress events SHALL CONTINUE TO be deep-frozen and one per Phase 0, generation and Phase 3; callbacks SHALL CONTINUE TO never change a verdict.

## Item A: search effectiveness in CI

A.1 A property test SHALL run the graded needle at 400 trials and the flat needle at 1000 trials over fixed sets of search seeds, in full and random-only mode, and SHALL assert: graded, full finds the region in at least as many runs as random-only; flat, full finds it in at least (random-only − 8% of the runs).
A.2 The test SHALL finish within 60 s in CI with the in-process pool.

## Item B: calibration of robust versus seed-sensitive

B.1 A test SHALL sweep synthetic noise (`base(scenario) + σ·N(0,1)` with σ in {0.01, 0.02, 0.05, 0.1}) over seeded runs, compute for each classified run the true failure probability `p = Φ(-base/σ)` at the classified scenario, and build the confusion matrix with truth `robust` for `p ≥ 0.99` and `seed-sensitive` for `p ≤ 0.5`.
B.2 THE test SHALL assert that at least 90% of truly robust runs are labelled `robust` and at least 85% of truly seed-sensitive runs are labelled `seed-sensitive`.

## Item C: exact Clopper-Pearson beside the rule of three

C.1 THE Verdict SHALL carry `failureRateUpper95Exact`, the exact one-sided 95% Clopper-Pearson bound for the Phase 1 counts (`1 - 0.05^(1/n)` when there are no failures), whenever `failureRateUpper95` is set.
C.2 `failureRateUpper95` SHALL stay the rule of three for zero failures.

## Item D: `replayCounterexample`

D.1 Covered by 10.7. A test SHALL show that replaying a counterexample found by `falsify` returns `reproduced: true` and pose frames.

## Item E: Phase 1 fraction default

E.1 A benchmark (`docs/reviews/falsify-bench.mts`) SHALL compare Phase 1 fractions 0.4 and 0.2 at equal budgets on the graded and flat needles, the 0.78% needle, the extra-dimension needle and the wrap needle, with 95% intervals.
E.2 THE default SHALL become 0.2 only if it finds the region in at least as many runs on every case and has a lower median `foundAfter` on the graded needle. The trade-off (fewer Phase 1 trials give a looser `failureRateUpper95`) SHALL be documented in the falsify README and in `docs/reviews/falsify-hardening.md`.
