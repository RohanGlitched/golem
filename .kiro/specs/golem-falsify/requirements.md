# Requirements Document

## Introduction

`golem-falsify` covers the two modules that turn one `CompiledRequirement` into a `Verdict`: `skeleton/src/falsify` (search, shrinking, verdicts, seed database) and `skeleton/src/pool` (the `TrialPool` implementations that run trials). It uses only the cross-module contracts in `interfaces.md` (`ScenarioSpace`, `Dimension`, `Scenario`, `TrialSpec`, `TrialResult`, `Counterexample`, `Verdict`, `TrialPool`). It adds fields where needed and renames or removes none.

The falsifier runs four phases against one requirement:

- **Phase 0** re-runs pinned seeds from `.golem/seeds/<app>/<reqId>.json`.
- **Phase 1** samples scenarios at random with a Latin hypercube over the `ScenarioSpace`.
- **Phase 2** runs a cross-entropy search toward the lowest robustness.
- **Phase 3** shrinks a failing scenario to the mildest one that still fails, then classifies the counterexample as robust or seed-sensitive.

A `random-only` baseline mode spends the same budget on random sampling alone, for the evidence benchmark.

A `Verdict` of `held` means "no counterexample found within this search budget". It is never a proof. Verdicts come only from deterministic monitors, and every trial is a pure function of (app, requirement, scenario, seed). Engine code uses a seeded PRNG and never `Math.random()`.

Out of scope: EARS parsing and monitors (`skeleton/src/ears`), the MuJoCo episode runner (`skeleton/src/sim`), the CLI and MCP commands that call the falsifier, and the UI that renders ghosts. This spec defines the progress callback that the UI consumes.

## Glossary

- **Falsifier**: The module in `skeleton/src/falsify` that runs the four phases against one `CompiledRequirement` and returns a `Verdict`.
- **Trial**: One simulated episode described by a `TrialSpec` and reported as a `TrialResult`.
- **Robustness**: The signed margin returned by a requirement monitor. A value above zero means the requirement held. A value below zero means it broke. A value of exactly zero is the boundary and counts as not failing.
- **Failing_Trial**: A Trial whose robustness is below zero.
- **Scenario_Space**: The `ScenarioSpace` of a `CompiledRequirement`, a list of `Dimension` entries.
- **Fixed_Dimension**: A `Dimension` with `min` equal to `max`. The Falsifier never varies it.
- **Severity_Dimension**: A `Dimension` whose `severity` is `'up'` or `'down'`. Its milder end is `min` for `'up'` and `max` for `'down'`.
- **Wrap_Dimension**: A `Dimension` with `wrap` set to true (angles and phases). Its values live on a circle of circumference `max - min`.
- **LHS_Sampler**: The Latin hypercube sampler. For N samples over D dimensions, each dimension is split into N equal strata, and each stratum holds exactly one sample.
- **CEM_Search**: The cross-entropy search of Phase 2.
- **Generation**: One batch of trials in Phase 1 or Phase 2, submitted to the Trial_Pool together.
- **Elite_Fraction**: The fraction of a Generation with the lowest robustness that CEM_Search uses to refit its distribution.
- **Shrinker**: The Phase 3 component that bisects each Severity_Dimension toward its milder end.
- **Classification**: The label `robust` or `seed-sensitive` assigned to a shrunk counterexample.
- **Verification_Seeds**: The 3 extra seeds, distinct from the original seed, used to classify a counterexample.
- **Budget**: The search limit, either a maximum trial count, a maximum wall time in milliseconds, or both. The Budget includes Phase 0 and Phase 3 trials.
- **Pinned_Seed**: A `Counterexample` stored in the Seed_Database.
- **Seed_Database**: The module that reads and writes `.golem/seeds/<app>/<reqId>.json`.
- **Trial_Pool**: An implementation of the `TrialPool` interface.
- **InProcess_Pool**: The single-thread Trial_Pool used in tests.
- **Node_Pool**: The Trial_Pool built on `worker_threads`.
- **Browser_Pool**: The Trial_Pool built on module Web Workers.
- **Worker**: A `worker_threads` worker or a Web Worker that loads MuJoCo and the app once, then runs trials.
- **Backpressure**: The rule that a Trial_Pool holds no more than a bounded number of undispatched trials per Worker.
- **Progress_Event**: The record passed to the progress callback after each Generation.
- **Random_Only_Mode**: The baseline mode that runs Phase 0 and Phase 1 over the whole Budget, with no CEM_Search and no shrinking.
- **Failure_Rate_Bound**: The one-sided 95% upper confidence bound on the failure rate, computed from Phase 1 trials only.
- **Synthetic_Robustness_Function**: An analytic function from a `Scenario` and seed to a robustness value, used in property tests with no physics.
- **Seed**: The integer that fixes all randomness inside one Trial.
- **Search_Seed**: The integer that fixes all randomness inside the Falsifier itself (sampling, elite selection, Verification_Seeds).

## Requirements

### Requirement 1: Falsify one requirement through a phased search

**User Story:** As a robotics engineer, I want one call that falsifies a compiled requirement, so that I get a verdict tied to that spec line.

#### Acceptance Criteria

1. WHEN `falsify` is called with a `CompiledRequirement`, a Trial_Pool, a Budget and a Search_Seed, THE Falsifier SHALL run Phase 0, Phase 1, Phase 2 and Phase 3 in that order and return a `Verdict`, skipping a phase only as stated in criteria 2 to 4, 8 and 9.
2. WHEN a Failing_Trial is observed in Phase 0 or Phase 1, THE Falsifier SHALL skip the remaining unstarted trials of the current phase, skip Phase 2, and continue to Phase 3 with the failing scenario of lowest robustness and the seed of the Trial that produced it.
3. WHEN a Failing_Trial is observed in Phase 2, THE Falsifier SHALL complete the current Generation, start no further Generation, and continue to Phase 3 with the failing scenario of lowest robustness and the seed of the Trial that produced it.
4. WHEN a Failing_Trial is observed in Phase 0, THE Falsifier SHALL skip Phase 1 and Phase 2.
5. THE Falsifier SHALL set `Verdict.trials` equal to the sum of the Phase 0 trial count, `Verdict.randomTrials`, `Verdict.guidedTrials` and the Phase 3 trial count, where `Verdict.randomTrials` counts Phase 1 Trials and `Verdict.guidedTrials` counts Phase 2 Trials.
6. THE Falsifier SHALL record in `Verdict.closest` the scenario, seed and robustness of the Trial with the lowest robustness among all Trials it ran, and on equal robustness SHALL record the earliest-run Trial.
7. THE Falsifier SHALL set `Verdict.ms` to the elapsed wall time of the whole call in milliseconds, measured from entry to return.
8. WHEN the Scenario_Space has no dimension that is not a Fixed_Dimension, THE Falsifier SHALL run Phase 1 as repeated trials of the single fixed scenario with distinct seeds, and SHALL skip Phase 2 and the bisection steps of Phase 3.
9. WHEN the Budget is exhausted before a phase starts, THE Falsifier SHALL skip that phase and every later phase except the Verification_Seeds trials of Requirement 7.
10. WHEN no Failing_Trial is observed in any phase and no trial error occurred, THE Falsifier SHALL return a `Verdict` with `status` `'held'` and no `counterexample`.
11. WHEN a Failing_Trial is observed, THE Falsifier SHALL return a `Verdict` with `status` `'broken'` and a `counterexample` whose `robustness` is below zero, whose `shrunk` is true if Phase 3 changed the scenario and false otherwise, and whose `foundAfter` is the number of Trials run up to and including the first Failing_Trial.
12. IF the Trial_Pool rejects a `run` call for a reason other than cancellation, or a Trial returns a robustness that is NaN, THEN THE Falsifier SHALL stop starting new Trials, return a `Verdict` with `status` `'error'` that keeps the counts and `closest` from the Trials completed so far, and leave the Seed_Database unchanged, unless a Failing_Trial was already observed (Requirement 2, criterion 1).
13. IF the Budget is exhausted while a Generation is running, THEN THE Falsifier SHALL record the Trials of that Generation that completed, start no further Trial, and return a `Verdict` that states the number of Trials actually run.
14. WHEN `falsify` is called twice with the same `CompiledRequirement`, Budget (a trial-count limit only), Search_Seed and Synthetic_Robustness_Function, THE Falsifier SHALL return Verdicts with identical `status`, `trials`, `closest` and `counterexample`.

### Requirement 2: Verdict status and failure-rate bound

**User Story:** As a robotics engineer, I want an honest verdict with a stated confidence, so that a pass is never mistaken for a proof.

#### Acceptance Criteria

1. THE Falsifier SHALL set `Verdict.status` to `'broken'` if and only if at least one Trial in the run had robustness below zero, and this rule SHALL take precedence over `'error'` when both a Failing_Trial and a trial error occurred.
2. IF a Trial throws or the Trial_Pool reports a trial error, THEN THE Falsifier SHALL count that Trial toward `Verdict.trials`, SHALL exclude it from `Verdict.closest` and from the Phase 1 trial count `n` used for `Verdict.failureRateUpper95`, and SHALL stop as stated in Requirement 1, criterion 12.
3. IF a trial error occurred and no Failing_Trial was observed, THEN THE Falsifier SHALL set `Verdict.status` to `'error'`, even when all other Trials had robustness of zero or above.
4. THE Falsifier SHALL set `Verdict.status` to `'held'` if and only if no Trial had robustness below zero, no trial error occurred, and at least one Trial completed.
5. WHEN a Failing_Trial was observed, THE Falsifier SHALL set `Verdict.counterexample` with `reqId`, `scenario`, `seed`, `robustness` (below zero), `shrunk` and `foundAfter` (the 1-based count of Trials run when the first Failing_Trial completed), and SHALL leave `Verdict.counterexample` undefined otherwise.
6. WHEN Phase 1 ran with `n` trials (n ≥ 1) and zero failures, THE Falsifier SHALL set `Verdict.failureRateUpper95` to `3 / n`, capped at 1.
7. WHEN Phase 1 ran with `n` trials (n ≥ 1) and `k` failures where `k` is at least 1, THE Falsifier SHALL set `Verdict.failureRateUpper95` to the one-sided 95% Clopper-Pearson upper bound for `k` failures in `n` trials, accurate to within 1e-6 absolute error.
8. THE Falsifier SHALL compute `Verdict.failureRateUpper95` from Phase 1 trials only, and SHALL NOT include Phase 0, Phase 2 or Phase 3 trials in `n` or `k`.
9. WHEN Phase 1 ran zero trials (including when Phase 0 found a Failing_Trial, or in `error` runs with no completed Phase 1 trial), THE Falsifier SHALL leave `Verdict.failureRateUpper95` undefined.
10. THE Falsifier SHALL return a `failureRateUpper95` value, when defined, in the closed interval [0, 1].
11. THE Falsifier SHALL include in the returned run metadata the Budget, the Search_Seed, and the number of trials in each phase (Phase 0, Phase 1, Phase 2, Phase 3), so that a `held` verdict reads "no counterexample found in N trials" where N equals `Verdict.trials`.

### Requirement 3: Phase 0, pinned seed replay

**User Story:** As a robotics engineer, I want old counterexamples re-run first, so that a fixed bug stays fixed.

#### Acceptance Criteria

1. WHEN the Seed_Database holds one or more Pinned_Seeds for the app and requirement, THE Falsifier SHALL run each Pinned_Seed as one Trial, using its stored scenario and stored seed, before any Phase 1, Phase 2 or Phase 3 Trial.
2. WHEN the Seed_Database holds Pinned_Seeds, THE Falsifier SHALL run them in ascending order of their stored robustness, lowest first, and SHALL break ties by file order.
3. WHEN a Pinned_Seed produces a robustness below zero, THE Falsifier SHALL treat it as a Failing_Trial found in Phase 0 and SHALL apply Requirement 1 criteria 2 and 4.
4. WHEN a Pinned_Seed produces a robustness of zero or above, THE Falsifier SHALL keep it in the Seed_Database unchanged and SHALL list its scenario, seed and new robustness as resolved in the run metadata.
5. WHEN no seed file exists for the app and requirement, or the seed file holds an empty list, THE Falsifier SHALL run Phase 0 with zero trials and continue to Phase 1.
6. IF the seed file for the app and requirement cannot be parsed as a list of `Counterexample`, or a Pinned_Seed contains a scenario with a dimension name absent from the Scenario_Space or a value outside that dimension's `[min, max]`, THEN THE Falsifier SHALL skip that file or entry, SHALL list the file path and the reason in the run metadata, SHALL leave the file unmodified, and SHALL continue the run.
7. IF a Pinned_Seed Trial throws or the Trial_Pool reports a trial error, THEN THE Falsifier SHALL record the error in the run metadata, SHALL keep the Pinned_Seed in the Seed_Database unchanged, and SHALL continue with the next Pinned_Seed.
8. THE Falsifier SHALL count Phase 0 trials against the Budget, SHALL stop Phase 0 when the Budget is exhausted, and SHALL record the number of Pinned_Seeds not run in the run metadata.
9. THE Falsifier SHALL NOT write to the Seed_Database during Phase 0.

### Requirement 4: Phase 1, Latin hypercube random sampling

**User Story:** As a robotics engineer, I want evenly spread random scenarios, so that a small budget still covers the whole trigger range.

#### Acceptance Criteria

1. WHEN Phase 1 draws `n` scenarios with `n` at least 1, THE LHS_Sampler SHALL place exactly one sample in each of the `n` equal strata of every dimension that is not a Fixed_Dimension, where stratum `i` (0-based) covers `[min + i·(max − min)/n, min + (i+1)·(max − min)/n)`.
2. THE LHS_Sampler SHALL assign each Fixed_Dimension its `min` value in every sample and SHALL NOT consume Search_Seed random draws for it.
3. THE LHS_Sampler SHALL return every sample value within `[min, max]` of its dimension, and SHALL return Wrap_Dimension values in `[min, max)`.
4. WHEN a dimension is a Wrap_Dimension, THE LHS_Sampler SHALL treat the `n` strata as a partition of the circle of circumference `max - min`, so that the last stratum (ending at `max`) is adjacent to the first stratum (starting at `min`), and SHALL treat `max` as equivalent to `min`.
5. THE LHS_Sampler SHALL shuffle the stratum order independently for each non-fixed dimension using a PRNG seeded from the Search_Seed and the dimension name, so that the permutation of one dimension does not depend on the number of other dimensions.
6. THE LHS_Sampler SHALL draw each sample from a uniform distribution within its stratum, using the same seeded PRNG.
7. WHEN the same Search_Seed, Scenario_Space and `n` are given, THE LHS_Sampler SHALL return a bit-identical sequence of scenarios, with keys in the order of the Scenario_Space dimensions.
8. THE Falsifier SHALL assign each Phase 1 Trial a Seed that is a deterministic integer function of the Search_Seed and the zero-based Phase 1 trial index, and SHALL assign distinct Seeds to distinct trial indices within one run.
9. THE Falsifier SHALL run Phase 1 in Generations whose size is a configurable positive integer (default 32), each Generation being one independent Latin hypercube batch of that size, with the last Generation holding the remaining trials when the Budget is not a multiple of the size.
10. WHEN `n` is 0, THE LHS_Sampler SHALL return an empty list.
11. IF `n` is negative, not an integer, or not finite, THEN THE LHS_Sampler SHALL reject the call with an error that names the invalid `n`, and SHALL return no samples.
12. IF a non-fixed dimension has `min` greater than `max` or a non-finite bound, THEN THE LHS_Sampler SHALL reject the call with an error that names the dimension, and SHALL return no samples.

### Requirement 5: Phase 2, cross-entropy search

**User Story:** As a robotics engineer, I want the search to home in on the weakest region, so that I find failures that random sampling misses.

#### Acceptance Criteria

1. WHEN Phase 2 starts, THE CEM_Search SHALL initialise the mean and standard deviation of each non-fixed dimension from the Elite_Fraction of Phase 1 trials with the lowest robustness, where the elite count is `ceil(Elite_Fraction × n)` for `n` Phase 1 trials. WHEN Phase 1 ran zero trials, THE CEM_Search SHALL initialise each dimension with a mean at the midpoint of `[min, max]` and a standard deviation of 25% of the dimension width.
2. THE CEM_Search SHALL keep one independent distribution per non-fixed dimension and SHALL assign each Fixed_Dimension its `min` value in every sample.
3. WHEN a dimension is not a Wrap_Dimension, THE CEM_Search SHALL draw its values from a normal distribution truncated to `[min, max]`, so that every drawn value lies within `[min, max]`.
4. WHEN a dimension is a Wrap_Dimension, THE CEM_Search SHALL draw its values from a wrapped normal distribution whose mean and spread are fitted by circular statistics, so that every drawn value lies in `[min, max)`.
5. WHEN a Generation completes with no Failing_Trial, THE CEM_Search SHALL refit each distribution to the `ceil(Elite_Fraction × g)` trials with the lowest robustness in that Generation, where `g` is the number of trials in that Generation.
6. THE CEM_Search SHALL accept a Generation size that is an integer of at least 2, with a default of 16, and an Elite_Fraction in the open interval (0, 1), with a default of 0.25.
7. IF the Generation size is not an integer of at least 2, or the Elite_Fraction is not in the open interval (0, 1), THEN THE CEM_Search SHALL run zero Phase 2 trials, and THE Falsifier SHALL set `Verdict.status` to `'error'` unless a Failing_Trial was already observed.
8. THE CEM_Search SHALL clamp each fitted standard deviation to a minimum of 1% of the dimension width, so that the distribution does not collapse.
9. WHEN a Generation contains a Failing_Trial, THE CEM_Search SHALL stop after that Generation and SHALL NOT start another Generation.
10. WHEN the Budget is exhausted, THE CEM_Search SHALL stop without starting a new Generation.
11. WHEN the Budget would be exceeded by a full Generation, THE CEM_Search SHALL shrink the final Generation to the remaining trial count, and SHALL skip refitting if that count is 0.
12. WHEN the same Search_Seed, requirement and Trial results are given, THE CEM_Search SHALL produce the same sequence of scenarios and the same Seed for each Trial, with each Seed derived from the Search_Seed and the Phase 2 trial index.
13. WHEN fewer than 2 elite scenarios are available for a refit, THE CEM_Search SHALL keep the previous distribution unchanged.
14. WHILE the Falsifier runs in Random_Only_Mode, THE Falsifier SHALL run zero CEM_Search trials and SHALL report `Verdict.guidedTrials` as 0.
15. WHEN a Trial in a Generation is rejected by the Trial_Pool or returns NaN, THE CEM_Search SHALL exclude it from refitting, and THE Falsifier SHALL apply Requirement 1, criterion 12.

### Requirement 6: Phase 3, shrinking

**User Story:** As a robotics engineer, I want the mildest failing scenario, so that I can read and reproduce "falls from 168 N at 135°" instead of an extreme case.

#### Acceptance Criteria

1. WHEN a failing scenario is given, THE Shrinker SHALL bisect each Severity_Dimension toward its milder end, one dimension at a time in the order the dimensions appear in the Scenario_Space, holding the Seed fixed.
2. WHEN the Shrinker bisects a dimension, THE Shrinker SHALL run one Trial at the midpoint between the current failing value and the milder end of the interval, and SHALL accept the midpoint as the new failing value only if that Trial is a Failing_Trial.
3. WHEN the midpoint Trial is not a Failing_Trial, THE Shrinker SHALL move the milder bound of the interval to the midpoint and keep the current failing value.
4. THE Shrinker SHALL return a scenario that is a Failing_Trial under the original Seed, confirmed by a Trial result with robustness below zero.
5. THE Shrinker SHALL return a scenario in which no Severity_Dimension is more severe than in the input scenario.
6. THE Shrinker SHALL leave every dimension whose `severity` is `'none'` and every Fixed_Dimension at its input value.
7. THE Shrinker SHALL stop bisecting a dimension when the interval width is at most a configurable tolerance, expressed as a fraction of the dimension width in the open interval (0, 1), with a default of 0.01 (1%).
8. THE Shrinker SHALL stop when the shrink trial limit is reached, configurable as an integer of at least 1, with a default of 60 trials.
9. WHEN the Budget is exhausted during shrinking, THE Shrinker SHALL return the mildest failing scenario found so far.
10. WHEN a Severity_Dimension is a Wrap_Dimension, THE Shrinker SHALL measure severity as distance along the dimension from its `min`, taking `min` as the milder end, and SHALL NOT bisect across the wrap point.
11. THE Shrinker SHALL set `Counterexample.shrunk` to true when the returned scenario differs from the input scenario in at least one dimension, and to false otherwise.
12. WHEN the input scenario is already at the milder end of every Severity_Dimension, THE Shrinker SHALL return it unchanged without running any Trial.
13. WHEN a Trial during shrinking throws or the Trial_Pool reports a trial error, THE Shrinker SHALL treat that candidate as not failing, SHALL continue with the remaining dimensions, and SHALL report the error in the run metadata. Such an error SHALL NOT change `Verdict.status` from `'broken'`.
14. THE Shrinker SHALL count every shrink Trial against the Budget and against `Verdict.trials`.
15. WHEN the same Search_Seed, failing scenario, Seed and Trial results are given, THE Shrinker SHALL return the same scenario.

### Requirement 7: Counterexample classification

**User Story:** As a robotics engineer, I want to know whether a failure depends on luck, so that I know whether it is a real controller weakness.

#### Acceptance Criteria

1. WHEN shrinking completes, THE Falsifier SHALL re-run the shrunk scenario once under each of exactly 3 Verification_Seeds.
2. THE Falsifier SHALL derive the Verification_Seeds deterministically from the Search_Seed, so that the same Search_Seed and original Seed always give the same 3 Verification_Seeds, and each SHALL differ from the original Seed and from each other.
3. WHEN all 3 Verification_Seeds produce a Failing_Trial, THE Falsifier SHALL classify the counterexample as `robust`.
4. WHEN at least 1 of the 3 Verification_Seeds produces a robustness of zero or above, THE Falsifier SHALL classify the counterexample as `seed-sensitive`.
5. IF at least 1 of the 3 Verification_Seeds Trials throws or the Trial_Pool reports a trial error for it, THEN THE Falsifier SHALL leave the Classification unset, SHALL record the error against that Verification_Seed in the run metadata, and SHALL still return `Verdict.status` as `'broken'` with the counterexample preserved.
6. THE Falsifier SHALL record the Classification, the 3 Verification_Seeds and their robustness values in the run metadata and in the Pinned_Seed file entry, and SHALL write the entry even when the Classification is `seed-sensitive`.
7. THE Falsifier SHALL keep the original Seed in `Counterexample.seed`, so that the pinned reproduction is deterministic.
8. WHEN the Budget is exhausted before the Verification_Seeds run, THE Falsifier SHALL still run all 3 Verification_Seeds, SHALL NOT run any other Trial after the Budget is exhausted, and SHALL report the 3 Trials in the Phase 3 trial count.
9. THE Falsifier SHALL leave `Counterexample.scenario`, `Counterexample.seed` and `Counterexample.robustness` unchanged by classification, so that the values are those of the shrunk scenario under the original Seed.

### Requirement 8: Budgets

**User Story:** As a robotics engineer, I want to cap how long a falsification takes, so that CI and the browser stay responsive.

#### Acceptance Criteria

1. THE Falsifier SHALL accept a Budget with a maximum trial count (a positive integer), a maximum wall time in milliseconds (a positive finite number), or both.
2. WHEN both limits are given, THE Falsifier SHALL stop at whichever is reached first.
3. WHEN the number of Trials started, counting Phase 0, Phase 1, Phase 2 and Phase 3 Trials, equals the maximum trial count, THE Falsifier SHALL not start another Trial, except the Verification_Seeds required by Requirement 7.
4. WHEN the elapsed wall time since the start of the `falsify` call is at least the maximum wall time, THE Falsifier SHALL not start a new Generation or a new Shrinker Trial.
5. WHEN the maximum wall time elapses while a Generation is running, THE Falsifier SHALL let the Trials already submitted to the Trial_Pool finish, count them against the Budget, and not submit further Trials.
6. IF a Budget has neither a maximum trial count nor a maximum wall time, THEN THE Falsifier SHALL reject it before running any Trial with an error that names both missing fields.
7. IF a Budget limit is not a positive finite number, or the maximum trial count is not an integer, THEN THE Falsifier SHALL reject the Budget before running any Trial with an error that names the field and the value received.
8. THE Falsifier SHALL divide the Budget between phases with configurable fractions, each in the closed interval [0, 1], defaulting to 40% of the Budget for Phase 1 and the remainder for Phase 2, with Phase 0 and Phase 3 Trials taken from the total as they run.
9. IF the configured Phase 1 and Phase 2 fractions sum to more than 1, THEN THE Falsifier SHALL reject the configuration before running any Trial with an error that names both fractions and their sum.
10. WHEN Phase 1 ends with Budget unused and no Failing_Trial was found, THE Falsifier SHALL carry the unused Budget forward into Phase 2.
11. WHEN Phase 2 ends with Budget unused and no Failing_Trial was found, THE Falsifier SHALL not carry the unused Budget into any other phase.
12. WHEN the Budget is exhausted before Phase 2 starts and no Failing_Trial was found, THE Falsifier SHALL return a Verdict with `status` `'held'`, `guidedTrials` equal to 0, and run metadata that states the Budget was exhausted.

### Requirement 9: Progress callbacks

**User Story:** As a UI developer, I want a callback after each generation, so that I can draw ghosts generation by generation.

#### Acceptance Criteria

1. WHEN a Generation completes in Phase 1 or Phase 2, THE Falsifier SHALL call the progress callback exactly once with a Progress_Event, after all Trial results of that Generation have been received and before the first Trial of the next Generation is submitted to the Trial_Pool.
2. THE Progress_Event SHALL contain the phase (0, 1, 2 or 3), the zero-based Generation index, the list of scenarios of that Generation with their robustness values in the same order, the lowest robustness seen so far in the run, the number of trials used, and the number of trials remaining in the Budget.
3. WHEN the Budget has no maximum trial count, THE Falsifier SHALL set the trials-remaining field of the Progress_Event to `null`.
4. WHEN a Generation is shrunk to the remaining trial count, THE Falsifier SHALL report the shrunk Generation size in the Progress_Event, so that the list of scenarios and the list of robustness values both have the number of Trials actually run.
5. WHEN Phase 0 completes, THE Falsifier SHALL call the progress callback exactly once with a Progress_Event for phase 0, containing one entry per Pinned_Seed run, including when that count is zero.
6. WHEN Phase 3 completes, THE Falsifier SHALL call the progress callback exactly once with a Progress_Event for phase 3, containing the shrink Trials and the 3 Verification_Seeds Trials.
7. THE Falsifier SHALL call the progress callback in phase order and, within a phase, in ascending Generation index order, one call at a time and never concurrently.
8. IF the progress callback throws or returns a rejected promise, THEN THE Falsifier SHALL ignore the error, SHALL NOT count it as a Trial error, and SHALL leave `Verdict.status`, `Verdict.trials` and the Budget unchanged.
9. THE Falsifier SHALL NOT wait for a progress callback that returns a promise, so that a slow callback adds 0 ms to the Budget wall time and never delays the next Generation.
10. WHERE no progress callback is supplied, THE Falsifier SHALL run to the same `Verdict` as a run with a callback, given the same Search_Seed, Budget and Trial results.
11. THE Falsifier SHALL pass each Progress_Event to the callback as a value the callback may keep, so that later changes to Falsifier state do not alter an event already delivered.
12. WHEN the Falsifier calls `TrialPool.run`, THE Falsifier SHALL pass an `onResult` callback that forwards to the optional `onResult` supplied by the caller of `falsify`, so that each `TrialResult` is delivered as that Trial finishes and before the Generation's Progress_Event.
13. IF the caller's `onResult` callback throws, THEN THE Falsifier SHALL ignore the error and continue the run with the Trial result unchanged, so that the error never reaches the Trial_Pool.

### Requirement 10: Random-only baseline

**User Story:** As a benchmark author, I want a random-only mode with the same budget, so that I can show how much the guided search adds.

#### Acceptance Criteria

1. WHERE Random_Only_Mode is selected, THE Falsifier SHALL run Phase 0 and then Phase 1 over the whole Budget, with 100% of the Budget available to Phase 1 after the Phase 0 trials are counted.
2. WHERE Random_Only_Mode is selected, THE Falsifier SHALL set `Verdict.guidedTrials` to 0 and SHALL run no CEM_Search Generation.
3. WHERE Random_Only_Mode is selected, WHEN a Failing_Trial is observed in Phase 0 or Phase 1, THE Falsifier SHALL skip the remaining unstarted trials of the current phase and run Phase 3 on the failing scenario with the lowest robustness, so that the benchmark reports a comparable counterexample.
4. WHERE Random_Only_Mode is selected, WHEN no Failing_Trial is observed and the maximum trial count or the maximum wall time is reached, THE Falsifier SHALL stop and return a Verdict with `status` `'held'`, or `'error'` if Requirement 2, criterion 3 applies, and SHALL NOT start a new Generation after the Budget is exhausted.
5. WHERE Random_Only_Mode is selected, THE Falsifier SHALL compute `Verdict.failureRateUpper95` from Phase 1 trials only, using the rule of Requirement 2, criteria 6 to 10.
6. WHERE Random_Only_Mode is selected, THE Falsifier SHALL run Phase 3 with the same shrink trial limit, tolerance and Verification_Seeds rule (Requirements 6 and 7) as the full mode.
7. WHEN Random_Only_Mode and the full mode are given the same Search_Seed, Scenario_Space, Generation size and Phase 1 size `n`, THE Falsifier SHALL produce identical Phase 1 scenarios and Seeds for the first `n` trials in both modes.
8. WHERE Random_Only_Mode is selected, THE Falsifier SHALL record the mode name in the run metadata, so that the mode that produced a Verdict is identifiable.

### Requirement 11: Seed database

**User Story:** As a robotics engineer, I want counterexamples pinned to disk, so that they re-run first, like a property-testing database.

#### Acceptance Criteria

1. THE Seed_Database SHALL store Pinned_Seeds for an app and requirement in `.golem/seeds/<app>/<reqId>.json` as a JSON array of `Counterexample`.
2. WHEN a seed file is read, THE Seed_Database SHALL return its `Counterexample` entries in file order.
3. WHEN a counterexample is added, THE Seed_Database SHALL append it after the last stored entry unless an equal counterexample is already stored, and in that case SHALL leave the file content unchanged.
4. THE Seed_Database SHALL treat two counterexamples as equal when they have the same `reqId`, the same `seed`, and the same set of dimension names with each scenario value equal under exact numeric equality (`===`), ignoring `robustness`, `shrunk` and `foundAfter`.
5. WHEN the seed file or its directory does not exist, THE Seed_Database SHALL create them on the first write, and WHEN a read finds no file, THE Seed_Database SHALL return an empty array without creating any file.
6. WHEN a seed file is read and then written back unchanged, THE Seed_Database SHALL produce a file whose parsed content is deep-equal to the original array, including the Classification, Verification_Seeds and their robustness values stored under Requirement 7, criterion 6 (round-trip property).
7. IF a seed file holds invalid JSON or entries that do not match `Counterexample`, THEN THE Seed_Database SHALL reject the read or write with an error that names the file path and the zero-based index of the first invalid entry (or the parse position for invalid JSON), and SHALL leave the file unchanged.
8. THE Seed_Database SHALL write the file by writing a temporary file in the same directory and renaming it over the target, so that an interrupted write leaves the previous file intact.
9. IF writing the temporary file or renaming it fails, THEN THE Seed_Database SHALL report an error that names the file path, SHALL remove the temporary file when it exists, and SHALL leave the previous file unchanged.
10. THE Seed_Database SHALL format the file as JSON with a stable key order, 2-space indentation, and a single trailing newline, so that writing the same entries twice produces byte-identical files and version control diffs are minimal.
11. THE Seed_Database SHALL reject an app id or requirement id that is empty, contains a path separator (`/` or `\`), contains `..`, or contains a null character, with an error that names the rejected id, and SHALL perform no file-system access for that call.
12. THE Seed_Database SHALL accept an injected file-system interface, so that tests run without touching the disk.

### Requirement 12: TrialPool contract

**User Story:** As a skeleton developer, I want one pool interface with three implementations, so that the Falsifier runs unchanged in tests, Node and the browser.

#### Acceptance Criteria

1. THE Trial_Pool SHALL implement `TrialPool` as defined in `interfaces.md`, with `run`, `size` and `close`, and SHALL expose `size` as a positive integer equal to the number of Workers (1 for the InProcess_Pool). A trailing optional options argument on `run` (Requirement 17, criterion 1) is an added field.
2. WHEN `run` is called with a list of `TrialSpec`, THE Trial_Pool SHALL return a promise of `TrialResult` entries in the same order as the input specs, with `result[i].spec` equal to `specs[i]` for every index `i`.
3. WHEN a Trial finishes, THE Trial_Pool SHALL call `onResult` exactly once with that `TrialResult`, in completion order, before the promise returned by `run` resolves.
4. WHEN `run` is called with an empty list, THE Trial_Pool SHALL resolve with an empty list and SHALL NOT call `onResult`.
5. THE Trial_Pool SHALL return a `TrialResult` for a given `TrialSpec` whose `robustness`, `worstAt`, `unit` and `poses` are bit-identical regardless of the pool kind, the pool size, the Worker that ran it, or the order and number of other trials in the same `run` call. Only `wallMs` may differ.
6. WHEN `close` is called, THE Trial_Pool SHALL release every Worker and every MuJoCo handle, and SHALL resolve after all Workers have stopped.
7. WHEN `close` is called more than once, THE Trial_Pool SHALL resolve each call without error and without releasing any resource twice.
8. IF `run` is called after `close`, THEN THE Trial_Pool SHALL reject with an error that states the pool is closed, and SHALL start no Trial.
9. IF `close` is called while a `run` is in progress, THEN THE Trial_Pool SHALL reject the pending `run` with a cancellation error, SHALL start no further Trial for that `run`, and SHALL NOT call `onResult` after the rejection.
10. IF a Trial function throws, THEN THE Trial_Pool SHALL reject the `run` with an error that names the `TrialSpec` (app, `reqId`, seed) and keeps the cause, and SHALL stay usable for later `run` calls. Worker crashes are handled by Requirement 18.
11. THE Trial_Pool SHALL accept `run` calls with any number of specs, feeding Workers as they become free under the bounds of Requirement 16.
12. WHEN `run` is called more than once concurrently, THE Trial_Pool SHALL return to each call only the results of its own specs, in that call's input order, and SHALL deliver `onResult` only to the callback of the call that submitted the spec.
13. THE Trial_Pool SHALL accept an injected trial function, so that tests substitute a Synthetic_Robustness_Function for MuJoCo, and SHALL call it once per `TrialSpec` with no other source of randomness than the spec's Seed.

### Requirement 13: In-process pool

**User Story:** As a test author, I want a single-thread pool, so that I can test the Falsifier without workers.

#### Acceptance Criteria

1. THE InProcess_Pool SHALL report `size` equal to 1.
2. THE InProcess_Pool SHALL run Trials sequentially on the calling thread, starting the next Trial only after the previous Trial has returned its `TrialResult`, in input order.
3. WHEN the InProcess_Pool runs a Trial, THE InProcess_Pool SHALL create no Worker and SHALL not call `Math.random()`.
4. WHEN the AbortSignal passed to `run` is aborted, THE InProcess_Pool SHALL not start any further Trial and SHALL reject `run` with an `AbortError`.
5. WHEN `run` rejects because the AbortSignal was aborted, THE InProcess_Pool SHALL have called `onResult` only for the Trials that finished before the abort, and SHALL not call it for the Trial in progress at the abort or for any later Trial.
6. IF the AbortSignal is already aborted when `run` is called, THEN THE InProcess_Pool SHALL reject `run` with an `AbortError` without running any Trial and without calling `onResult`.
7. IF a Trial throws, THEN THE InProcess_Pool SHALL reject `run` with an error that names the `TrialSpec` (app, reqId, scenario and seed) and keeps the original error as its `cause`.
8. IF a Trial throws, THEN THE InProcess_Pool SHALL not start any later Trial of that `run` call, SHALL not call `onResult` for the failed Trial, and SHALL remain usable for a later `run` call.
9. WHEN the same `TrialSpec` is run through the InProcess_Pool with the same injected trial function, THE InProcess_Pool SHALL return a `TrialResult` whose `robustness`, `worstAt` and `unit` are equal to those returned by every other Trial_Pool kind (Requirement 12, criterion 5).

### Requirement 14: Node worker_threads pool

**User Story:** As a CLI user, I want trials spread across CPU cores, so that a campaign finishes in reasonable time.

#### Acceptance Criteria

1. THE Node_Pool SHALL start `size` Workers on `worker_threads`, with a default `size` equal to the number of available CPU cores minus 1, and at least 1.
2. IF a caller supplies a `size` that is not an integer of at least 1, THEN THE Node_Pool SHALL reject construction with an error that names the field and the value, and SHALL start no Worker.
3. THE Node_Pool SHALL load MuJoCo and the app once per Worker, before the Worker accepts its first Trial.
4. IF a Worker fails to load MuJoCo or the app during construction, THEN THE Node_Pool SHALL terminate every Worker it has started, SHALL reject construction with an error that names the failing Worker index and keeps the original error as its cause, and SHALL leave no Worker running.
5. THE Node_Pool SHALL dispatch each Trial to an idle Worker as soon as one is free, under the bounds of Requirement 16.
6. THE Node_Pool SHALL pass a `TrialSpec` to a Worker as structured-clone data, and SHALL transfer `poses.frames` buffers back without copying.
7. IF a Worker exits unexpectedly or raises an uncaught error while running a Trial, THEN THE Node_Pool SHALL apply Requirement 18.
8. THE Node_Pool SHALL not use the network.

### Requirement 15: Browser Web Worker pool

**User Story:** As a visitor to a studio page, I want trials to run off the main thread, so that the page stays responsive while ghosts run.

#### Acceptance Criteria

1. WHEN the Browser_Pool is created without an explicit `size`, THE Browser_Pool SHALL start `size` module Web Workers, where `size` equals `navigator.hardwareConcurrency` minus 1, bounded to the range 1 to 8 inclusive.
2. WHERE `navigator.hardwareConcurrency` is undefined or not a positive integer, THE Browser_Pool SHALL use a default `size` of 1.
3. WHERE an explicit `size` is supplied, THE Browser_Pool SHALL use it and SHALL set `TrialPool.size` to that value.
4. IF an explicit `size` is not an integer in the range 1 to 8 inclusive, THEN THE Browser_Pool SHALL reject construction with an error that names the field and the value, and SHALL start no Worker.
5. THE Browser_Pool SHALL create each Worker as a module Worker, so that the Worker can use ES module `import`.
6. THE Browser_Pool SHALL load MuJoCo and the app once per Worker, before that Worker accepts its first Trial, and SHALL load them from static assets only.
7. WHEN a Trial finishes with `record` set to `'poses'`, THE Browser_Pool SHALL transfer the `poses.frames` buffer from the Worker to the main thread without copying, so that the Worker's reference to the buffer has byte length 0 afterwards.
8. THE Browser_Pool SHALL return a `TrialResult` for a given `TrialSpec` whose `robustness`, `worstAt` and `poses.frames` values are bit-identical to those of the Node_Pool and the InProcess_Pool for the same `TrialSpec`.
9. THE Browser_Pool SHALL share its dispatch, backpressure, cancellation and restart logic with the Node_Pool through one common scheduler, so that both pools produce the same dispatch order, the same rejection errors and the same restart behaviour for the same sequence of events.
10. IF a Worker fails to load MuJoCo or the app, THEN THE Browser_Pool SHALL start no further Trial on that Worker and SHALL reject every pending `run` and every later `run` with an error that includes the load failure message.
11. IF every Worker fails to load, THEN THE Browser_Pool SHALL reject `run` with an error that includes the load failure message of the first Worker that failed.
12. IF a Worker crashes after it has loaded, THEN THE Browser_Pool SHALL handle the crash as specified in Requirement 18 and SHALL NOT treat it as a load failure.
13. WHEN `close` is called, THE Browser_Pool SHALL terminate every Worker and release every MuJoCo handle, as specified in Requirement 12.

### Requirement 16: Backpressure

**User Story:** As a UI developer, I want the pool to hold back work, so that a large batch does not exhaust memory.

#### Acceptance Criteria

1. THE Trial_Pool SHALL hold at most one in-flight Trial per Worker, so that the number of in-flight Trials never exceeds `size`.
2. THE Trial_Pool SHALL keep undispatched `TrialSpec` entries in its own queue and SHALL post a `TrialSpec` to a Worker only when that Worker has no in-flight Trial.
3. WHERE `record` is `'poses'`, THE Trial_Pool SHALL limit the number of completed `TrialResult` entries that are waiting for delivery to `onResult` to a configurable bound. The bound SHALL default to `2 * size` and SHALL be an integer of at least 1.
4. WHILE the number of `TrialResult` entries waiting for delivery equals the bound in criterion 3, THE Trial_Pool SHALL not dispatch any new Trial.
5. WHEN `onResult` returns for a `TrialResult` and the number of entries waiting for delivery falls below the bound, THE Trial_Pool SHALL resume dispatch within the same scheduling turn.
6. IF the configured bound is not an integer of at least 1, THEN THE Trial_Pool SHALL reject construction with an error that names the field and the value.
7. WHEN several `run` calls are in progress, THE Trial_Pool SHALL dispatch Trials in call order and, within a call, in input order. THE Trial_Pool SHALL not dispatch a Trial from a later call while an earlier call still has undispatched Trials.
8. IF `onResult` throws, THEN THE Trial_Pool SHALL count that `TrialResult` as delivered, free its capacity, and reject the `run` call that supplied the callback with an error that keeps the thrown error as its cause.
9. WHEN `close` is called, THE Trial_Pool SHALL discard all undispatched `TrialSpec` entries and all `TrialResult` entries waiting for delivery, so that no `onResult` call happens after `close` resolves.
10. THE Trial_Pool SHALL be the only place that enforces the in-flight and delivery bounds in this spec. Requirements 12 to 15 SHALL reference Requirement 16 for these bounds and SHALL not restate them.

### Requirement 17: Cancellation

**User Story:** As a UI developer, I want to cancel a running search, so that changing a number in the tablet stops stale work immediately.

#### Acceptance Criteria

1. THE Trial_Pool SHALL accept an optional trailing options argument on `run` that carries an `AbortSignal`, as an added field that leaves the `TrialPool` signature in `interfaces.md` otherwise unchanged.
2. WHERE an AbortSignal is supplied to the Trial_Pool or the Falsifier, THE Trial_Pool SHALL stop dispatching new Trials within the same event-loop turn in which the signal aborts.
3. WHEN the AbortSignal aborts during a `run`, THE Trial_Pool SHALL reject that `run` with an error whose `name` is `AbortError`.
4. WHEN the AbortSignal aborts, THE Trial_Pool SHALL discard every undispatched `TrialSpec` in the queue for that `run`, and SHALL ignore the results of Trials still in flight, so that `onResult` is not called for them after the abort.
5. IF the AbortSignal is already aborted when `run` is called, THEN THE Trial_Pool SHALL reject with an `AbortError` without dispatching any Trial and without calling `onResult`.
6. WHEN the AbortSignal aborts, THE Falsifier SHALL stop and reject with an error whose `name` is `AbortError`, SHALL not start a new Generation or Trial, and SHALL not call the progress callback again.
7. WHEN the AbortSignal aborts, THE Falsifier SHALL leave every file in the Seed_Database byte-for-byte unchanged, including when the abort happens during Phase 3.
8. WHEN a `run` is cancelled, THE Trial_Pool SHALL remain usable, so that a later `run` call with no aborted signal resolves with `TrialResult` entries equal to those it would return on a fresh pool.
9. WHEN the AbortSignal aborts, THE Trial_Pool SHALL not reject or reorder a `run` call that was queued behind the cancelled `run` (Requirement 16, criterion 7), unless its own signal aborts.
10. WHEN a Worker is still running a cancelled Trial 2 s after the abort, or after a configurable limit in the range 0.1 s to 60 s that replaces the 2 s default, THE Trial_Pool SHALL terminate that Worker and start a replacement that loads MuJoCo and the app before accepting its next Trial.
11. WHEN the Trial_Pool terminates a Worker under criterion 10, THE Trial_Pool SHALL release every MuJoCo handle held by that Worker, and SHALL keep `size` equal to its configured value once the replacement is ready.
12. IF a replacement Worker fails to load MuJoCo or the app, THEN THE Trial_Pool SHALL reject later `run` calls with an error that includes the load failure message, as in Requirement 15, criterion 10.
13. WHERE the InProcess_Pool is used, THE InProcess_Pool SHALL check the AbortSignal before starting each Trial, and SHALL reject with an `AbortError` without terminating or restarting anything, since it has no Worker.

### Requirement 18: Worker crash recovery

**User Story:** As a robotics engineer, I want a crashed worker replaced, so that one bad trial does not end a long campaign.

#### Acceptance Criteria

1. WHEN a Worker exits or raises an uncaught error while running a Trial, THE Trial_Pool SHALL start a replacement Worker in the same Worker slot that loads MuJoCo and the app once, and SHALL dispatch no Trial to the replacement until loading completes. An error that the Trial function reports for a Trial is not a crash and does not trigger a restart.
2. WHEN a Worker crashes while running a Trial, THE Trial_Pool SHALL requeue that Trial at the front of its queue exactly once, with an unchanged `TrialSpec`, to run on a Worker other than the crashed one, which may be the replacement Worker.
3. IF the retried Trial also crashes a Worker, THEN THE Trial_Pool SHALL reject `run` with an error that names the `app`, `reqId` and `seed` of the `TrialSpec` and states that the Trial crashed two Workers, and SHALL leave Trials from other `run` calls unaffected.
4. THE Trial_Pool SHALL limit consecutive Worker restarts to a configurable maximum, with a default of 5 per Worker slot. THE Trial_Pool SHALL reset a slot's count to 0 when a Worker in that slot completes a Trial.
5. IF the restart limit is exceeded, THEN THE Trial_Pool SHALL reject all pending `run` calls, and every later `run` call until `close`, with an error that names the Worker slot index and the last failure message. `close` SHALL still resolve normally.
6. IF a replacement Worker fails to load MuJoCo or the app, THEN THE Trial_Pool SHALL count the failure as one restart of that slot toward the limit in criterion 4.
7. WHEN a Worker is restarted, THE Trial_Pool SHALL report `size` unchanged, before, during and after the restart.
8. WHEN a Worker is terminated, THE Trial_Pool SHALL release its MuJoCo handles by terminating the Worker's runtime, and SHALL ignore any result message that arrives from that Worker afterward.

### Requirement 19: Determinism

**User Story:** As a robotics engineer, I want a failure to reproduce exactly, so that "replay" shows what the search saw.

#### Acceptance Criteria

1. THE Falsifier SHALL derive every random choice from the Search_Seed using a seeded PRNG (`mulberry32` or `splitmix32`) and SHALL not call `Math.random()`.
2. WHEN the same `CompiledRequirement`, Budget, Search_Seed, configuration and Trial results are given, THE Falsifier SHALL produce the same sequence of scenarios and the same `Verdict`, where "the same `Verdict`" means every field equal except `Verdict.ms`, with `robustness` values bit-identical (compared as IEEE-754 64-bit values).
3. THE Falsifier SHALL produce the same sequence of scenarios regardless of the pool kind (InProcess_Pool, Node_Pool or Browser_Pool), the pool size (1 to 64 Workers) and the completion order of Trials within a Generation.
4. THE Falsifier SHALL order the Trials of a Generation by their input index when selecting elites, and SHALL break robustness ties by the lower input index.
5. WHEN no maximum wall time is set in the Budget, THE Falsifier SHALL produce a `Verdict` that does not depend on wall-clock time, apart from `Verdict.ms`.
6. WHEN the Falsifier derives a Seed or a Verification_Seed from the Search_Seed, THE Falsifier SHALL compute it as a pure function of the Search_Seed, the phase and the trial index, so that the same inputs give the same unsigned 32-bit integer on every run and platform.
7. WHEN the same `TrialSpec` is run twice, whether in one pool or in different pools, THE Trial_Pool SHALL return `TrialResult` entries with bit-identical `robustness` and `worstAt` values, and, where `record` is `'poses'`, bit-identical `poses.frames` contents.
8. WHERE a maximum wall time is set in the Budget and the wall-time limit ends a run, THE Falsifier SHALL record in the run metadata the number of trials completed in each phase, so that re-running with an equivalent maximum trial count reproduces the same `Verdict`.
9. THE Falsifier SHALL give the same `Verdict` for a run that is repeated after a cancelled run on the same Trial_Pool, so that a prior cancellation, Worker restart or crash retry leaves no state that changes results.

### Requirement 20: Resource and performance constraints

**User Story:** As a maintainer, I want the search and pool code to stay cheap, so that the physics step loop and the browser are not slowed down.

#### Acceptance Criteria

1. THE Falsifier SHALL run in Node 20 or later and in a browser, using no Node-only module in `skeleton/src/falsify`, except through the injected file-system interface of the Seed_Database.
2. THE Falsifier SHALL not add any runtime dependency beyond those in `tech.md`.
3. THE Trial_Pool SHALL perform zero heap allocations per physics step inside the physics step loop of a Worker, and SHALL reuse the same typed arrays for signals and poses across the steps of a Trial and across Trials on that Worker.
4. WHEN a Trial finishes, whether it succeeds, throws or is cancelled, THE Trial_Pool SHALL call `.delete()` on every MuJoCo handle that the Worker created for that Trial before the Worker accepts the next Trial.
5. THE Trial_Pool SHALL make no network request, except fetching static assets for the app, and SHALL make no request at all after the app files are loaded in a Worker.
6. THE Falsifier SHALL accept an optional Synthetic_Robustness_Function as the injected trial function of the Trial_Pool, so that all property tests run with no MuJoCo load.
7. WHILE a Trial_Pool uses a Synthetic_Robustness_Function, THE Trial_Pool SHALL not load MuJoCo or the app files in any Worker.
8. WHEN a Worker has run 100 Trials of the same `TrialSpec` shape, THE Trial_Pool SHALL show a count of live MuJoCo handles in that Worker equal to the count after its first Trial, so that a handle leak is detectable by test.
9. THE Falsifier SHALL not read or write any file other than through the injected file-system interface of the Seed_Database, and SHALL not use any analytics or tracking service.

### Requirement 21: Property tests on synthetic robustness functions

**User Story:** As a maintainer, I want the search logic tested without physics, so that tests are fast and deterministic.

#### Acceptance Criteria

1. THE Falsifier test suite SHALL use Vitest for examples and fast-check for properties, with Synthetic_Robustness_Function instances and no MuJoCo, and SHALL run each property with at least 100 generated cases.
2. THE Falsifier test suite SHALL name each test by the behaviour it states, in the form `it('<behaviour>')`.
3. FOR ALL generated Synthetic_Robustness_Function instances and failing scenarios, THE Shrinker output SHALL be a Failing_Trial under the original Seed, and no Severity_Dimension of the output SHALL be more severe than in the input scenario (shrinker property).
4. FOR ALL generated Synthetic_Robustness_Function instances and failing scenarios, THE Shrinker output SHALL leave every dimension whose `severity` is `'none'` and every Fixed_Dimension equal to its input value (shrinker invariance property).
5. FOR ALL generated Scenario_Space values and counts `n` from 0 to 200, THE LHS_Sampler SHALL place exactly one sample in each of the `n` strata of each non-fixed dimension (coverage property).
6. FOR ALL generated Scenario_Space values with Wrap_Dimension entries, THE LHS_Sampler and THE CEM_Search SHALL return Wrap_Dimension values in `[min, max)` and all other values in `[min, max]` (wrap-range property).
7. FOR ALL generated Synthetic_Robustness_Function instances and Scenarios, THE Falsifier SHALL report `Verdict.status` equal to `'broken'` if and only if some Trial in the run had robustness below zero (verdict soundness property).
8. FOR ALL generated Synthetic_Robustness_Function instances of the form `margin = signal - threshold`, THE Falsifier SHALL give a robustness whose sign flips when the threshold crosses the signal, and raising the threshold of an `above` predicate SHALL never raise robustness (soundness and monotonicity property).
9. FOR ALL generated Search_Seed values, Scenario_Space values and Synthetic_Robustness_Function instances, THE Falsifier SHALL produce the same sequence of scenarios and an equal `Verdict` (ignoring `Verdict.ms`) on two runs, and THE LHS_Sampler SHALL return bit-identical values (determinism property).
10. FOR ALL generated seed-file contents, reading, writing and re-reading through the Seed_Database SHALL produce an equal array (round-trip property).
11. FOR ALL generated counterexample lists with duplicates, THE Seed_Database SHALL store no two equal counterexamples under the equality rule of Requirement 11 (dedupe property).
12. FOR ALL generated trial counts `n` from 1 to 10,000 and failure counts `k` from 1 to `n`, THE Falsifier SHALL compute a Clopper-Pearson upper bound that is at least `k / n` and at most 1 (bound property).
13. FOR ALL generated `n` and pairs `k1 <= k2` of failure counts, THE Falsifier SHALL compute a `failureRateUpper95` for `k2` that is at least the value for `k1`, and for `k = 0` SHALL return `3 / n` (monotonic-bound property).
14. FOR ALL generated Trial_Pool runs with an injected trial function, THE InProcess_Pool, THE Node_Pool (with a fake Worker) and THE Browser_Pool (with a fake Worker) SHALL each return `TrialResult` entries in input order, with `robustness`, `worstAt` and `unit` equal to the InProcess_Pool results, for pool sizes 1 to 8 and any completion order (pool-equivalence property).
15. THE pool tests SHALL cover worker crash with one retry and replacement, the restart limit, cancellation with `AbortError`, and backpressure with at most one in-flight Trial per Worker, using example tests that use an injected trial function and a fake Worker.
16. IF a property fails, THEN THE test suite SHALL report the fast-check seed and the shrunk counterexample, and SHALL NOT weaken the assertion to make the test pass.
17. THE tests that load MuJoCo SHALL use a sim horizon of at most 2 s and a Budget of at most 50 trials, and long campaigns SHALL live in `evidence/` and not in the unit-test run.
