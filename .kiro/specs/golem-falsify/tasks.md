# Implementation Plan: golem-falsify

## Overview

Language: TypeScript (strict, ES modules, Node 20 or later), as in `tech.md`. Work goes into `skeleton/src/falsify` and `skeleton/src/pool`. Tasks run in dependency order: pure numeric pieces first (PRNG, normal, circular statistics, LHS, Clopper-Pearson, budget), then CEM, shrinker, classifier and seed database, then the falsifier orchestration on a small direct test pool, then the worker protocol and `TrialScheduler` with `FakeWorker`, then the concrete pools, then cross-pool properties, one short MuJoCo integration test, and public entry points.

Test rules for every task (`testing.md`):

- Vitest for examples, fast-check for properties, at least 100 cases each. Each property is its own sub-task, is not optional, and carries the tag comment `Feature: golem-falsify, Property N: <title>`.
- A logic task writes its example tests in the same task, in an adjacent `*.test.ts`. Test names state behaviour, for example `it('rejects a Budget with neither limit')`.
- All tests use synthetic analytic robustness functions, `FakeWorker` and `memoryFileSystem`. Only task 20 loads MuJoCo, with a horizon of at most 2 s and at most 50 trials.
- Never weaken an assertion or a requirement to make a test pass. If a test is wrong, say why in the commit message.
- No `Math.random()` in engine code. All randomness comes from `mulberry32` streams derived from the Search_Seed.

## Tasks

- [x] 1. Scaffold modules, shared types and error classes
  - [x] 1.1 Create the module layout, shared types and error classes
    - Create the files listed in the design's module layout for `skeleton/src/falsify` and `skeleton/src/pool` with their public type exports: `Budget`, `FalsifyOptions`, `FalsifyResult`, `ProgressEvent`, `RunMetadata`, `PinnedSeedEntry`, `PoolOptions`, `RunOptions`, `TrialFn`.
    - Add error classes with stable `name` and `cause` support: `AbortError`, `PoolClosedError`, `CancelledError`, `TrialError`, `TrialCrashError`, `RestartLimitError`, `LoadError`, `SeedDbError`.
    - Extend `TrialPool.run` with the optional trailing `opts?: RunOptions` and an `onResult` that may return a promise, keeping every `interfaces.md` shape unchanged.
    - Write example tests that each error class has the expected `name`, keeps `cause`, and that types compile under `tsc --noEmit` strict.
    - _Requirements: 12.1, 17.1, 20.1, 20.2_

- [x] 2. Seed derivation and PRNG
  - [x] 2.1 Implement `fmix32`, `mulberry32`, `hashString` and `deriveSeed`
    - Implement `prng.ts` as in the design (bijective mixer, phase salts 1 to 5, verification seed rule).
    - Write example tests with fixed expected values, uint32 range, and that the same inputs give the same output.
    - _Requirements: 4.8, 7.2, 19.1, 19.6_
  - [x] 2.2 Write property test for seed derivation
    - **Property 4: Seed derivation is pure, uint32 and injective per phase**
    - **Validates: Requirements 4.8, 7.2, 19.6**

- [x] 3. Normal distribution helpers
  - [x] 3.1 Implement `erfc`, `normalCdf`, `normalQuantile` and `drawTruncatedNormal`
    - Cody erfc, Wichura AS241 quantile, mirrored lower-tail truncated draw with one uniform per draw and the negligible-mass guard.
    - Write example tests with reference values (`normalCdf(0) = 0.5`, quantile at 0.975, tails near 1e-12) and a mean 8 sigma outside the interval.
    - _Requirements: 5.3_
  - [x] 3.2 Write property test for CDF, quantile and truncated draws
    - **Property 9: Normal CDF and quantile are consistent, truncated draws are monotone in `u`**
    - **Validates: Requirements 5.3**

- [ ] 4. Wrapped normal and circular statistics
  - [~] 4.1 Implement the wrapped draw and the circular fit in `cem.ts`
    - Add `drawWrappedNormal` with the floating-point guard to `[min, max)`, `fitCircular` (atan2 mean, resultant length `R`, `uniformCircle` fallback when `R < 1e-3`, sigma floor 1% of width), and the circular blend helper used by smoothing.
    - Write example tests for elites at 358 deg and 2 deg (mean near 0 deg, not 180 deg), `r === width` mapping to `min`, and `R < 1e-3` giving `uniformCircle`.
    - _Requirements: 5.4, 5.8_
  - [~] 4.2 Write property test for circular fit and seam handling
    - **Property 8: Circular fit respects the seam**
    - **Validates: Requirements 5.4, 5.8**

- [ ] 5. Latin hypercube sampler
  - [~] 5.1 Implement `latinHypercube`
    - Per-dimension streams from `(searchSeed, generation, dimension name)`, Fisher-Yates strata, wrap guard, stratum repair, fixed dimensions with no draws, key order of `space.dims`.
    - Reject invalid `n` and invalid bounds with errors that name the value or dimension. `n = 0` returns `[]`.
    - Write example tests: `n = 0`, `n = -1`, `n = 1.5`, `NaN` bound, all-fixed space, wrap seam, `max` never returned for wrap dimensions.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.10, 4.11, 4.12_
  - [~] 5.2 Write property test for stratum coverage
    - **Property 1: LHS stratum coverage**
    - **Validates: Requirements 4.1, 4.2, 4.7, 4.10, 21.5**
  - [~] 5.3 Write property test for sampling ranges (LHS side)
    - **Property 2: Sampling ranges, wrap-aware** (LHS part: values in `[min, max]`, wrap dimensions in `[min, max)`)
    - **Validates: Requirements 4.3, 4.4, 21.6**
  - [~] 5.4 Write property test for LHS determinism and per-dimension independence
    - **Property 3: LHS determinism and per-dimension independence**
    - **Validates: Requirements 4.5, 4.6, 4.7, 21.9**

- [ ] 6. Failure-rate bound
  - [~] 6.1 Implement `lnGamma`, `regularizedIncBeta`, `clopperPearsonUpper` and `failureRateUpper95`
    - Lanczos log-gamma, modified Lentz continued fraction with the symmetry switch, bisection for the 0.95 quantile, rule of three for `k = 0`, `1` for `k = n`, `undefined` for `n = 0`.
    - Write example tests against committed reference values from `qbeta(0.95, k+1, n-k)` within 1e-6, and `n = 1`, `n = 10000`, `k = n - 1`.
    - _Requirements: 2.6, 2.7, 2.10_
  - [~] 6.2 Write property test for bound validity
    - **Property 21: Failure-rate bound is valid**
    - **Validates: Requirements 2.6, 2.7, 2.10, 21.12**
  - [~] 6.3 Write property test for monotonicity and closed forms
    - **Property 22: Failure-rate bound is monotone and matches closed forms**
    - **Validates: Requirements 2.6, 2.7, 21.13**

- [ ] 7. Budget validation and accounting
  - [~] 7.1 Implement `BudgetClock` and budget validation
    - Validation errors name the field and value (both missing fields, non-integer `maxTrials`, fractions outside [0, 1], fractions summing above 1 with both fractions and their sum in the message).
    - Phase quotas with Phase 1 carry-forward into Phase 2, no carry from Phase 2, `grant`, injectable clock, wall-time checks before each generation and shrink trial.
    - Write example tests for each rejection, the 40% default split, carry-forward, last-generation shrink to the grant, and the invariant `n0 + n1 + n2 + shrink <= T`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12_
  - [~] 7.2 Write property test for budget and fraction validation
    - **Property 25: Budget validation and fractions**
    - **Validates: Requirements 8.1, 8.6, 8.7, 8.9, 4.11, 4.12**

- [ ] 8. Cross-entropy search
  - [~] 8.1 Implement `initCem`, `refitCem` and `sampleCem`
    - Elite selection by `(robustness, index)` total order, initial fit from Phase 1 (midpoint and 25% width fallback), exact refit (smoothing `alpha = 1` default), sigma floor, keep previous state when fewer than 2 elites, dimension-major sampling from `deriveSeed(searchSeed, 5, g)`, generation size and elite fraction validation.
    - Write example tests: zero Phase 1 trials, one elite, NaN trials excluded, fixed dimensions unchanged, invalid generation size or elite fraction.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.12, 5.13, 5.15, 19.4_
  - [~] 8.2 Write property test for elite selection
    - **Property 6: Elite selection is a total order with lower-index tie-break**
    - **Validates: Requirements 5.1, 5.5, 19.4**
  - [~] 8.3 Write property test for CEM fit
    - **Property 7: CEM fit clamps and keeps previous state**
    - **Validates: Requirements 5.1, 5.2, 5.8, 5.13**
  - [~] 8.4 Write property test for CEM sampling ranges
    - **Property 2: Sampling ranges, wrap-aware** (CEM part: `sampleCem` for valid states, near-degenerate sigma and mean at the seam)
    - **Validates: Requirements 5.3, 5.4, 21.6**

- [ ] 9. Shrinker
  - [~] 9.1 Implement `shrink`
    - Severity coordinate for `up`, `down` and wrap dimensions, milder-end test first, then bisection, global trial limit, tolerance as a fraction of width, `null` from `runTrial` stops with the mildest failing scenario so far, errors and NaN count as not failing and are logged, `shrunk` flag, no-op when already at the milder end.
    - Write example tests: failure at the milder end accepts at once, non-monotone failing set, budget gone mid-shrink, errored candidate, wrap dimension never crossing the seam.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15_
  - [~] 9.2 Write property test that the shrunk scenario still fails
    - **Property 10: Shrinker output still fails**
    - **Validates: Requirements 6.2, 6.3, 6.4, 21.3**
  - [~] 9.3 Write property test that severity never increases
    - **Property 11: Shrinker never increases severity**
    - **Validates: Requirements 6.1, 6.5, 6.10, 21.3**
  - [~] 9.4 Write property test for untouched dimensions
    - **Property 12: Shrinker leaves none and fixed dimensions**
    - **Validates: Requirements 6.6, 21.4**
  - [~] 9.5 Write property test for limits, flag and no-op
    - **Property 13: Shrinker limits, flag and no-op**
    - **Validates: Requirements 6.7, 6.8, 6.11, 6.12**
  - [~] 9.6 Write property test for shrinker determinism
    - **Property 14: Shrinker determinism**
    - **Validates: Requirements 6.15**

- [ ] 10. Counterexample classification
  - [~] 10.1 Implement `verificationSeeds` and `classify`
    - Three seeds from salt 3 candidates, skipping the original seed, mutually distinct. `classify` returns `robust`, `seed-sensitive` or `undefined` on any error.
    - Write example tests for all-negative, one non-negative, zero as boundary (not failing), a `null` outcome, and the original seed appearing as a candidate.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.9_
  - [~] 10.2 Write property test for the classification rule
    - **Property 15: Classification rule**
    - **Validates: Requirements 7.3, 7.4, 7.5**

- [ ] 11. Seed database with injected file system
  - [~] 11.1 Implement `FileSystem` and `memoryFileSystem`
    - Map-backed implementation with a call log and a fault hook (fail the Nth call of a method), `ENOENT` on missing files, `remove` ignoring a missing file.
    - Write example tests for the call log, fault injection and missing-file behaviour.
    - _Requirements: 11.12, 20.9_
  - [~] 11.2 Implement `SeedDatabase`, `pinCounterexample`, canonical JSON and id validation
    - Id validation before any file-system call, read errors that name the path and the first invalid entry index or parse position, equality rule ignoring `robustness`, `shrunk` and `foundAfter`, append with dedupe, canonical JSON (sorted keys, 2 spaces, one trailing newline, non-finite numbers rejected), atomic temp-and-rename write with temp cleanup and path in errors.
    - Write example tests: missing file returns `[]` and creates nothing, invalid JSON, non-array, bad entry index, duplicate add leaves the file untouched, failure at `writeFile` and at `rename`.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.7, 11.8, 11.9, 11.10, 11.11_
  - [~] 11.3 Write property test for the seed database round trip
    - **Property 28: Seed database round trip**
    - **Validates: Requirements 11.1, 11.2, 11.6, 21.10**
  - [~] 11.4 Write property test for dedupe and canonical form
    - **Property 29: Seed database dedupe and canonical form**
    - **Validates: Requirements 11.3, 11.4, 11.10, 21.11**
  - [~] 11.5 Write property test for id validation
    - **Property 30: Seed database id validation**
    - **Validates: Requirements 11.11**
  - [~] 11.6 Write property test for atomic writes
    - **Property 31: Atomic writes**
    - **Validates: Requirements 11.8, 11.9**

- [ ] 12. Progress events and falsifier test helpers
  - [~] 12.1 Implement progress event construction and safe callback invocation
    - Deep-frozen copies, callback errors and rejected promises swallowed, promises never awaited, `trialsRemaining` is `null` without `maxTrials`, no event after an observed abort.
    - Write example tests: a callback that throws, a rejecting async callback, mutation of the source after delivery, frozen event.
    - _Requirements: 9.1, 9.2, 9.3, 9.8, 9.9, 9.11, 17.6_
  - [~] 12.2 Implement synthetic robustness functions and a direct test pool
    - In `skeleton/src/falsify/testing.ts` (test-only export): a seeded family of pure `(scenario, seed) -> robustness` functions (half-spaces `signal - threshold`, boxes, unions of boxes for non-monotone cases, seed-dependent noise), a fast-check arbitrary for `ScenarioSpace` (1 to 6 dimensions mixing fixed, `up`, `down`, `none` and wrap), and `directPool(trialFn)`, a minimal in-memory `TrialPool` for falsifier tests with optional shuffled completion order.
    - Write example tests that the functions are pure, that `directPool` returns results in input order with `results[i].spec` equal to `specs[i]`, and that a stubbed `Math.random` that throws is never called.
    - _Requirements: 19.1, 20.6, 20.7, 21.1_

- [ ] 13. Falsifier orchestration
  - [~] 13.1 Implement `falsify` option validation, Phase 0, Phase 1, verdict and metadata
    - Validate options before any trial. Phase 0 reads pinned seeds through a read-only handle (range and dimension checks, ordering by stored robustness, `pinnedNotRun`, resolved and skipped lists, errors ignored). Phase 1 runs generations of Latin hypercube batches with derived seeds, including the all-fixed space.
    - Compute `Verdict` (`status`, `trials`, `randomTrials`, `guidedTrials`, `closest`, `counterexample`, `failureRateUpper95` from Phase 1 only, `ms`) and `RunMetadata`. Pool errors and NaN stop the run with `error`, with `broken` taking precedence.
    - Wire `onResult` forwarding and `onProgress` emission per generation.
    - Write example tests: held with the stated trial count, failing Phase 0 pinned seed skipping Phases 1 and 2, pinned seed that now passes is resolved, invalid seed file skipped, rejecting pool gives `error`, budget exhausted before Phase 1, empty space, `onResult` that throws.
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 2.1, 2.2, 2.3, 2.4, 2.5, 2.8, 2.9, 2.11, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 9.1, 9.2, 9.4, 9.5, 9.12, 9.13_
  - [~] 13.2 Add Phase 2, Phase 3, random-only mode and abort to `falsify`
    - Phase 2 CEM generations with refit and last-generation shrink, Phase 3 shrink then three verification trials (run even when the budget is gone, counted in Phase 3), `PinnedSeedEntry` with classification and verification fields, `random-only` mode with the whole budget in Phase 1 and the same Phase 3, mode recorded in metadata, abort rejecting with `AbortError` and writing nothing, invalid CEM parameters giving `error` unless a failing trial was seen.
    - Write example tests: broken verdict with `shrunk` true and `foundAfter`, failing trial in the last generation of an exhausted budget (shrunk false, three verification trials), `seed-sensitive` entry still pinned, random-only has `guidedTrials = 0`, wall-time budget with injected clock, abort during Phase 3.
    - _Requirements: 1.3, 1.11, 1.14, 5.9, 5.10, 5.11, 5.14, 7.1, 7.6, 7.7, 7.8, 8.12, 9.6, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.8, 17.6, 17.7, 19.8_
  - [~] 13.3 Write property test for verdict soundness
    - **Property 16: Verdict soundness**
    - **Validates: Requirements 1.10, 1.11, 2.1, 2.3, 2.4, 2.5, 21.7**
  - [~] 13.4 Write property test for trial accounting
    - **Property 17: Trial accounting**
    - **Validates: Requirements 1.5, 5.14, 6.14, 8.3, 8.10, 8.11, 10.2**
  - [~] 13.5 Write property test for `closest`
    - **Property 18: Closest is the earliest minimum**
    - **Validates: Requirements 1.6**
  - [~] 13.6 Write property test for margin soundness and monotonicity
    - **Property 20: Soundness and monotonicity of margins**
    - **Validates: Requirements 21.8, 2.1**
  - [~] 13.7 Write property test for the Phase 1 failure rate
    - **Property 23: Failure rate uses Phase 1 only**
    - **Validates: Requirements 2.8, 2.9**
  - [~] 13.8 Write property test for Phase 0 ordering and no writes
    - **Property 24: Phase 0 ordering and no writes**
    - **Validates: Requirements 3.1, 3.2, 3.6, 3.9**
  - [~] 13.9 Write property test for progress events
    - **Property 26: Progress events**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.11**
  - [~] 13.10 Write property test for result forwarding
    - **Property 27: Result forwarding**
    - **Validates: Requirements 9.12, 9.13**
  - [~] 13.11 Write property test for the random-only Phase 1 prefix
    - **Property 5: Random-only Phase 1 prefix equals full-mode Phase 1**
    - **Validates: Requirements 10.7, 4.9**

- [ ] 14. Worker protocol, runner and fake workers
  - [~] 14.1 Implement the worker protocol types and `transferList`
    - `HostMessage`, `WorkerMessage`, `WorkerConfig`, and `transferList` returning `[result.poses.frames.buffer]` when present.
    - Write example tests for the transfer list with and without poses and for structured-clone safety of every message type.
    - _Requirements: 12.1, 14.6, 15.7_
  - [~] 14.2 Implement `WorkerRunner` and `HandleTracker`
    - Transport-independent `handle(msg, post)`: load once through `createTrialFn(appId, config)`, post `ready` or `loadError`, run trials and post `result` or `trialError`, `.delete()` every tracked handle in `finally`, answer `probe` with the live handle count, no network use after load, no MuJoCo load when `trialModule` supplies a synthetic function.
    - Write example tests: handles released after success, throw and cancel, probe count equal after the 1st and the 100th trial, a synthetic `trialModule` never loading MuJoCo.
    - _Requirements: 12.10, 14.3, 15.6, 20.3, 20.4, 20.5, 20.7, 20.8_
  - [~] 14.3 Implement `FakeWorker` and `FakeWorkerFactory`
    - In `skeleton/src/pool/testing.ts`: `WorkerLike` over the real `WorkerRunner` and an injected `TrialFn`, with a per-slot and per-job script (completion delay and shuffled order from a seed, crash, load failure, trial error, never answering), transferred buffers marked detached, and fake timers for grace periods.
    - Write example tests for each script action and for detached buffers after transfer.
    - _Requirements: 20.6, 20.7, 21.14, 21.15_

- [ ] 15. TrialScheduler
  - [~] 15.1 Implement scheduler core: dispatch, ordering, results, trial errors and close
    - Slot state machine, one in-flight job per slot, FIFO queue by run creation then input index, results in input order with `results[i].spec` equal to `specs[i]`, `onResult` once per result in completion order before `run` resolves, per-run isolation with concurrent `run` calls, `TrialError` naming app, `reqId`, seed with `cause`, `ready` promise, shared idempotent `close`, `PoolClosedError`, `CancelledError`, no `onResult` after `close` resolves, `size` validation.
    - Write example tests: empty run resolves with `[]`, trial error leaves the pool usable, `close` twice, `run` after `close`, `close` during a run.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.6, 12.7, 12.8, 12.9, 12.10, 12.11, 12.12, 16.1, 16.2, 16.7_
  - [~] 15.2 Add backpressure to the scheduler
    - Delivery bound (`deliveryBound`, default `2 * size`, integer at least 1) for `record: 'poses'`, results held while `onResult` promises are pending, dispatch resumes in the same turn that capacity frees, throwing `onResult` counts as delivered and rejects its run with `cause`, construction error naming field and value.
    - Write example tests: a slow async `onResult` never exceeds the bound, a throwing `onResult`, `deliveryBound = 0` rejected.
    - _Requirements: 16.3, 16.4, 16.5, 16.6, 16.8, 16.9_
  - [~] 15.3 Add cancellation to the scheduler
    - `AbortSignal` in `run` options: reject with `AbortError` in the same turn, discard undispatched jobs, ignore late results, already-aborted signal dispatches nothing, queued runs keep order, `cancel` message and grace timer (`abortGraceMs`, default 2000, range 100 to 60000), terminate and replace a stuck worker without counting a restart, `size` constant once the replacement is ready, fatal failure when an abort replacement fails to load.
    - Write example tests with fake timers: grace timer replacement, late result before the timer returns the slot to idle, replacement load failure rejects later runs with the message.
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.8, 17.9, 17.10, 17.11, 17.12_
  - [~] 15.4 Add crash recovery and load failure handling to the scheduler
    - Replace a crashed worker in the same slot, requeue its job at the front once, reject with `TrialCrashError` on the second crash, `maxRestarts` per slot (default 5) with reset on a completed trial, `RestartLimitError` naming the slot and last message, load failure at startup failing the scheduler with `LoadError`, crash replacement load failure counted as a restart, stale messages from terminated workers ignored, `size` constant.
    - Write example tests: one crash then success with an identical spec, two crashes reject only that run, restart limit exceeded then `close` still resolves, load failure of the first worker.
    - _Requirements: 14.4, 14.7, 15.10, 15.11, 15.12, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8_
  - [~] 15.5 Write property test for run ordering across concurrent calls
    - **Property 34: Run ordering across concurrent calls**
    - **Validates: Requirements 16.7, 18.2**
  - [~] 15.6 Write property test for close semantics
    - **Property 38: Close semantics**
    - **Validates: Requirements 12.6, 12.7, 12.8, 12.9, 16.9**
  - [~] 15.7 Write property test for backpressure
    - **Property 33: Backpressure**
    - **Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5**
  - [~] 15.8 Write property test for abort leaving the pool reusable
    - **Property 35: Abort leaves pool reusable and database unchanged** (pool part: `AbortError`, no `onResult` after abort, queued run still resolves, later run equals a fresh pool, for the scheduler with `FakeWorker` and for `InProcessPool`)
    - **Validates: Requirements 13.4, 13.5, 13.6, 17.2, 17.3, 17.4, 17.5, 17.8, 17.9**
  - [~] 15.9 Write property test for crash retry
    - **Property 36: Crash retry once, then error**
    - **Validates: Requirements 18.1, 18.2, 18.3, 18.7**
  - [~] 15.10 Write property test for the restart limit
    - **Property 37: Restart limit and reset**
    - **Validates: Requirements 18.4, 18.5, 18.6**

- [ ] 16. In-process pool
  - [~] 16.1 Implement `InProcessPool`
    - `size = 1`, sequential in input order, yields to the macrotask queue between trials so a timer-fired abort is seen, abort check before each trial, `TrialError` naming app, `reqId`, scenario and seed with `cause`, no later trial and no `onResult` for the failed trial, usable afterwards, no Worker and no `Math.random()`.
    - Write example tests: already-aborted signal runs nothing, abort from a timer mid-run, throwing trial, results equal the injected function's output, closed pool rejects.
    - _Requirements: 12.1, 12.13, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 17.13_

- [ ] 17. Node worker_threads adapter
  - [~] 17.1 Implement `createNodePool` and `node-entry.ts`
    - Adapter in `skeleton/src/pool/node.ts` exported only through `golem-spec/node`: default `size = max(1, os.availableParallelism() - 1)`, size validation naming field and value, `new Worker` per slot mapped to `WorkerLike` (`message`, `error`, `exit`), structured-clone specs, `transferList` for `poses.frames`, construction awaits `ready` and on a load failure terminates every worker and rejects with the worker index and `cause`, no network use.
    - Also export `nodeFileSystem()` (wrapping `node:fs/promises`) from `golem-spec/node`.
    - Write example tests with a real `worker_threads` worker and a synthetic `trialModule`: results match `InProcessPool`, `poses.frames` transferred with byte length 0 in the worker afterwards, bad worker module rejects construction and leaves no worker running, `close` is clean, invalid `size` rejected, `nodeFileSystem` round trips a seed file in a temp directory.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 20.1_

- [ ] 18. Browser Web Worker adapter
  - [~] 18.1 Implement `createBrowserPool` and `browser-entry.ts`
    - Adapter in `skeleton/src/pool/browser.ts`: default `size = clamp(navigator.hardwareConcurrency - 1, 1, 8)` with 1 when the value is not a positive integer, explicit `size` must be an integer in 1 to 8, module `Worker` created per slot, assets fetched by URL from `assetBase` only, buffer transfer through `postMessage`, load failures reject `run` with the message (the pool is returned at once), same `SchedulerOptions` as the Node adapter.
    - Write example tests with a fake `Worker` global and a fake `navigator`: size defaults (`undefined`, 0, 1.5, 2, 32), explicit size 9 rejected, load failure message on `run`, `close` terminates every worker, dispatch order identical to the Node adapter for the same event script.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.9, 15.10, 15.11, 15.12, 15.13_

- [ ] 19. Cross-pool and cross-run properties
  - [~] 19.1 Write property test for pool equivalence
    - **Property 32: Pool results in input order, for every pool kind**
    - **Validates: Requirements 12.2, 12.3, 12.5, 12.11, 12.12, 12.13, 19.7, 21.14**
  - [~] 19.2 Write property test for falsifier determinism across pools
    - **Property 19: Falsifier determinism and independence from pool and completion order** (`InProcessPool` and a `FakeWorker` scheduler of size 1 to 64 with shuffled completion order, with and without callbacks, and after an earlier cancelled run on the same pool)
    - **Validates: Requirements 1.14, 5.12, 9.10, 19.2, 19.3, 19.5, 19.9, 21.9**
  - [~] 19.3 Write property test for falsifier abort
    - **Property 35: Abort leaves pool reusable and database unchanged** (falsifier part: abort before the first dispatch, mid-generation and during Phase 3 rejects with `AbortError`, emits no later progress event, and leaves every `memoryFileSystem` seed file byte-identical)
    - **Validates: Requirements 17.6, 17.7**

- [ ] 20. MuJoCo integration test
  - [~] 20.1 Add a short MuJoCo integration test for pool equality and handle cleanup
    - Run at most 50 trials with a horizon of at most 2 s through `InProcessPool` and the Node adapter and compare `robustness`, `worstAt`, `unit` and `poses.frames` bit for bit. Probe a worker after the 1st and the 100th trial of one spec shape and assert equal live handle counts, using the shortest horizon the sim supports.
    - The test uses the public trial entry of `skeleton/src/sim` and a small bundled model. Guard it with `describe.skipIf` only for "MuJoCo package or sim trial entry not installed", and print the skip reason so it cannot pass silently.
    - _Requirements: 12.5, 14.6, 19.7, 20.4, 20.8, 21.17_

- [ ] 21. Public entry points and docs
  - [~] 21.1 Wire public exports and add import-graph smoke tests
    - Export from `golem-spec`: `falsify`, `latinHypercube`, `shrink`, `SeedDatabase`, `createSeedDatabase`, `pinCounterexample`, `memoryFileSystem`, `InProcessPool`, `createBrowserPool`, `TrialScheduler` and every type of this spec. Export `createNodePool` and `nodeFileSystem` only from `golem-spec/node`. Export the test helpers from a separate test-only entry.
    - Write smoke tests: the import graph of `skeleton/src/falsify` and of the `golem-spec` entry contains no `node:` module, no deep import of `skeleton/src/...` is needed by an app, the `skeleton/package.json` dependency list matches `tech.md`, and `Math.random` does not appear in engine code (grep-style test).
    - _Requirements: 20.1, 20.2, 20.9_
  - [~] 21.2 Write module docs for the falsifier and pools
    - Add `skeleton/src/falsify/README.md` and `skeleton/src/pool/README.md`: phases, budget split, verdict meaning ("no counterexample found in N trials", never a proof), seed file format, pool options, error types, and how to inject a synthetic trial function. Include examples with units and the reproduction rule.
    - Write a test that every code block marked `ts` in both READMEs type-checks against the public exports.
    - _Requirements: 2.11, 11.1, 12.13, 20.6_

- [~] 22. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Property tests are required (not marked optional) per `testing.md`. Each is its own sub-task with its property number and `Validates` references.
- Property 2 is split across tasks 5.3 (LHS) and 8.4 (CEM), and Property 35 across tasks 15.8 (pools) and 19.3 (falsifier), because the code they test lands in different tasks.
- Property 25 covers budget validation in task 7.2. The falsifier's rejection-before-any-trial behaviour is covered by example tests in task 13.1.
- Tasks 13.x use `directPool` so the falsifier is tested before the scheduler exists. Task 19.2 repeats determinism on the real scheduler.
- Test files per property are separate, so property sub-tasks in the same wave do not touch the same file.
- Long campaigns and the browser Vite smoke page live in `evidence/`, not in these tasks.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "6.1", "7.1", "11.1", "14.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.1", "5.1", "6.2", "6.3", "7.2", "9.1", "10.1", "11.2", "12.1", "14.2", "16.1"] },
    { "id": 3, "tasks": ["4.2", "5.2", "5.3", "5.4", "8.1", "9.2", "9.3", "9.4", "9.5", "9.6", "10.2", "11.3", "11.4", "11.5", "11.6", "12.2", "14.3"] },
    { "id": 4, "tasks": ["8.2", "8.3", "8.4", "13.1", "15.1"] },
    { "id": 5, "tasks": ["13.2", "15.2", "15.5", "15.6"] },
    { "id": 6, "tasks": ["13.3", "13.4", "13.5", "13.6", "13.7", "13.8", "13.9", "13.10", "13.11", "15.3", "15.7"] },
    { "id": 7, "tasks": ["15.4", "15.8"] },
    { "id": 8, "tasks": ["15.9", "15.10", "17.1", "18.1"] },
    { "id": 9, "tasks": ["19.1", "19.2", "19.3", "20.1", "21.1", "21.2"] },
    { "id": 10, "tasks": ["22"] }
  ]
}
```
