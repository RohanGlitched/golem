# Implementation Plan: golem-evidence

## Overview

The plan builds `evidence/` bottom-up in TypeScript (strict, ES modules, Node 20 or later). Pure modules in `evidence/scripts/core/` come first, then the injectable services in `evidence/scripts/lib/`, then the three experiment runners, the report generator and the CLI. `PREREG.md` is written and committed before any runner can be used for a real run. Each task that adds logic also adds its Vitest example tests. Each Correctness Property in `design.md` has its own fast-check sub-task. Test files are separate per property, so tasks in the same wave do not write to the same file.

Real campaigns (bench-falsifier, map-g1, agent-gate with credits) are in task 13. They are manual, not part of CI, and are optional.

## Tasks

- [ ] 1. Scaffold the evidence package and test harness
  - [ ] 1.1 Create the `evidence/` layout, shared types and Vitest setup
    - Create `evidence/scripts/{lib,core,test}`, `evidence/results/`, `evidence/logs/`, a package config with Vitest and fast-check, and strict `tsconfig`.
    - Write `core/types.ts` with the Data Models of the design (header, bench, map and gate records, Prereg_Block types, `Anomaly`, `Arm`, `ResultKey`) and `core/errors.ts` with `Result<T, EvidenceError>`.
    - Write the Vitest setup file that makes `Math.random`, `Date.now`, `performance.now` and direct `node:fs` use throw with the current test name.
    - Add a shared fast-check helper that fixes the seed and prints it on failure, with `numRuns` of at least 100.
    - Add `.gitignore` rules for `*.partial` under `evidence/results/` and for temp workspaces. Do not ignore results, logs or stream logs.
    - Add example tests for the guards and for the `Result` helpers.
    - Import the skeleton only through `golem-spec`, `golem-spec/ui` or `golem-spec/node`.
    - _Requirements: 16.8, 17.1, 17.5, 17.8, 17.10, 20.1, 20.3, 20.4, 20.5_

  - [ ] 1.2 Implement the ports with production adapters and in-memory fakes
    - Write `lib/ports.ts` with `FsPort`, `ClockPort`, `ExecPort`, `SignalPort` and `Ports`.
    - Write the production adapters over `node:fs/promises`, `node:child_process` and `performance.now()`. Use durable append (write plus fsync) and kill the whole process tree.
    - Write the in-memory fakes with fault injection (`failAfterBytes`, `failOnWrite(n)`), a fake clock and a stub exec.
    - Add example tests for durable append, truncate, rename, sorted listing and fault injection.
    - _Requirements: 2.3, 2.7, 17.8, 18.2_

  - [ ] 1.3 Implement the path guard and the guarded file system
    - Write `lib/path-guard.ts` with `allowedWrite` (lexical resolve and normalise) and a `GuardedFs` wrapper that refuses any write outside `evidence/results/`, `evidence/logs/`, `evidence/REPORT.md`, `site/data/` and Temp_Workspace roots.
    - Add example tests for `..` segments, absolute paths, `.partial` files and logs.
    - _Requirements: 20.2, 20.8, 20.10_

  - [ ] 1.4 Write property test for path containment
    - **Property 35: Writes stay inside the allowed paths**
    - **Validates: Requirements 20.8, 20.10**

- [ ] 2. Canonical JSON, seeds and plans
  - [ ] 2.1 Implement canonical JSON and the Prereg_Hash
    - Write `core/canonical.ts` with `canonicalJson` (keys sorted by code point at every depth, no whitespace, arrays kept in order, non-finite rejected), `sha256Hex` and `preregHash`.
    - Add example tests with fixed expected hashes and key-order examples.
    - _Requirements: 1.2_

  - [ ] 2.2 Write property test for the canonical hash
    - **Property 6: Canonical hash ignores key order and whitespace**
    - **Validates: Requirements 1.2, 19.6**

  - [ ] 2.3 Implement the seeded PRNG, result keys and planners
    - Write `core/seeds.ts` (`mulberry32`, Fisher-Yates `shuffle`), `core/result-key.ts` (`keyBench`, `keyMap`, `keyGate`, injective `streamLogName` without path separators) and `core/plan.ts` (`planBench`, `planMap`, `planGate`, `remaining`).
    - Pair order for bench: guided first when the seed index is even. Gate pairs: shuffle each arm, zip, and draw once for order inside the pair.
    - Take every budget, seed list, axis and run count from the block. Hold no code default.
    - Add example tests for the 20-seed pairing, the 6480-unit map plan and `position` values 1 to 16.
    - _Requirements: 1.7, 3.1, 4.3, 4.4, 4.7, 4.8, 7.1, 7.2, 7.6, 7.8, 10.7, 10.8, 14.9, 16.4_

  - [ ] 2.4 Write property test for deterministic, duplicate-free plans
    - **Property 7: Seed derivation and plans are deterministic and duplicate free**
    - **Validates: Requirements 4.3, 4.7, 4.8, 7.6, 7.8, 10.8, 16.4, 19.7**

  - [ ] 2.5 Write property test for the resume plan
    - **Property 4: Resume plan treats keys as a set**
    - **Validates: Requirements 2.15, 3.1, 19.8**

- [ ] 3. JSONL codec, store and run log
  - [ ] 3.1 Implement the JSONL codec
    - Write `core/jsonl.ts` with `encodeLine` (sorted keys, one line, one trailing line feed, `-0` as `0`), `decodeLine` and `readFileText`.
    - Encode `NaN`, `Infinity` and `-Infinity` as strings and list their dotted paths in `nonFinite`. Reject an unlisted `"NaN"` string only as a number substitution, so a real string field stays a string.
    - Report the file and 1-based line number for a bad line and return no records.
    - Add example tests for nested `counterexample` fields, non-finite values and bad lines.
    - _Requirements: 2.2, 2.4, 2.5, 2.11, 2.13_

  - [ ] 3.2 Write property test for the JSONL round trip
    - **Property 1: JSONL record round trip**
    - **Validates: Requirements 2.2, 2.4, 2.5, 2.12, 19.1**

  - [ ] 3.3 Write property test for file reader order
    - **Property 2: File reader order**
    - **Validates: Requirements 2.13**

  - [ ] 3.4 Implement the JSONL store
    - Write `lib/jsonl-store.ts` with `open` and `append`. Order of checks in `open`: create the header for a new file; validate header line, schema version and Prereg_Hash before reading any run line; handle a partial last line by moving it to `.partial`, truncating and recording an Anomaly; reject a bad non-last line and duplicate keys with file, line and key; compare requirement source hashes for bench.
    - Honour `allowOverride` by writing the deviation into the header and recording an Anomaly.
    - Append durably, never rewrite or reorder, and stop with a named error when a write fails.
    - Return the set of present keys and the Anomaly list. Exit with "Experiment is complete" and leave the file byte-identical when nothing remains.
    - Add example tests for each refusal and for the all-complete case.
    - _Requirements: 1.3, 1.5, 1.6, 2.1, 2.3, 2.6, 2.14, 2.16, 3.1, 3.2, 3.3, 3.6, 3.7, 3.8, 3.9, 18.2, 18.5, 18.6, 18.7_

  - [ ] 3.5 Write property test for resume equivalence
    - **Property 3: Interrupted and resumed runs equal an uninterrupted run**
    - **Validates: Requirements 2.6, 3.1, 3.2, 3.5**

  - [ ] 3.6 Write property test for safe stop
    - **Property 5: Safe stop at any interruption point**
    - **Validates: Requirements 2.3, 3.3, 18.3, 18.10**

  - [ ] 3.7 Implement the Run_Log
    - Write `lib/run-log.ts` with entries `start`, `cmdline`, `resume`, `unit`, `anomaly`, `warn`, `credit-cap-stop`, `interrupt`, `error` and `end`, each prefixed with a UTC ISO timestamp with milliseconds.
    - Log only whitelisted fields and never `env`. Print the log path as the last console line, also on failure. A log write failure stops before the next unit.
    - Add example tests for entry shape, secret exclusion, command-line line and log write failure.
    - _Requirements: 2.7, 2.8, 2.9, 16.3, 18.8, 18.9_

- [ ] 4. Preregistration
  - [ ] 4.1 Implement Prereg_Block loading and validation
    - Write `lib/prereg-io.ts` to extract the block tagged `json prereg:<experiment>` from `PREREG.md`, validate it with `validatePrereg` and return `{ block, hash }`.
    - Report every offending field in one error. Check: required fields, positive integer budgets, run counts and seed counts, exactly 20 distinct bench seeds, 12 strictly increasing positive finite force levels, non-empty phrase lists, positive finite credit cap and estimate.
    - Add `resolveCap` rules for the command-line credit cap (lower is allowed, higher needs the override flag).
    - Add example tests for a missing file, an unparseable file, a missing block and each invalid field, with no Raw_Result_File created or changed.
    - _Requirements: 1.1, 1.3, 1.4, 1.7, 1.11, 4.3, 7.3, 12.13, 14.1, 14.2, 14.15_

  - [ ] 4.2 Write `evidence/PREREG.md` and commit it before any run
    - Write three Prereg_Blocks: `bench-falsifier` (per-requirement trial budgets, 20 distinct search seeds, apps, pool size), `map-g1` (36 directions 0 to 350 deg step 10, 5 phases, 12 force levels such as 20 N to 240 N in steps of 20 N, 3 trial seeds, 0.2 s push, requirement reference) and `agent-gate` (8 runs per arm, shuffle seed, wall-time and gate time limits, credit cap 150, credit estimate, fixed prompt, success phrases, failure phrases, `fisherExact` setting).
    - Write the prose rules with worked numeric examples: Censored_Value (budget plus 1), Boundary_Force, Claim_Classifier, and the severity decision for requirements with no severity dimension.
    - State the metrics, tests and the honesty rules (no "proved" or "safe") in the file.
    - Check the file with `validatePrereg` through the dry-run in task 11.2, then commit it alone in a git commit that precedes any `evidence/results/` file.
    - _Requirements: 1.1, 1.7, 1.8, 1.10, 5.11, 12.1, 14.1, 14.15_

- [ ] 5. Statistics, severity and censoring
  - [ ] 5.1 Implement median, quantile type 7 and IQR
    - Write `core/stats/descriptive.ts`. Return null for an empty sample and a typed error for non-finite input.
    - Add example tests with hand-computed values and an even-length median.
    - _Requirements: 5.1, 19.17_

  - [ ] 5.2 Write property test for median and IQR invariants
    - **Property 10: Median and IQR invariants**
    - **Validates: Requirements 5.1, 5.16**

  - [ ] 5.3 Implement the Clopper-Pearson interval
    - Write `core/stats/clopper-pearson.ts` with a hand-written regularised incomplete beta function and bisection. Lower bound 0 when k is 0, upper bound 1 when k equals n.
    - Add example tests against known published values, including 0 of 20 and 20 of 20.
    - _Requirements: 5.2, 13.7_

  - [ ] 5.4 Implement the Wilcoxon signed-rank test and Fisher exact test
    - Write `core/stats/wilcoxon.ts`: drop zero differences, average ranks on ties, statistic as the smaller rank sum, exact p-value by doubled-rank subset-sum dynamic programming for 20 or fewer non-zero differences, normal approximation with tie and continuity corrections above 20 (label `approximate`), `underpowered` for 0 to 4, p of 1 and statistic 0 for all-zero input.
    - Write `exactWilcoxonByEnumeration` for tests only (m up to 16).
    - Write `core/stats/fisher.ts` (two-sided, relative tolerance 1e-7).
    - Add example tests for m = 4 (p 0.125), m = 0, ties and the approximate label.
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 13.9_

  - [ ] 5.5 Write property test for the exact Wilcoxon model
    - **Property 11: Exact Wilcoxon equals sign enumeration**
    - **Validates: Requirements 5.3, 5.4, 5.6, 5.7, 5.13**

  - [ ] 5.6 Write property test for arm swap symmetry
    - **Property 12: Arm swap symmetry**
    - **Validates: Requirements 5.14**

  - [ ] 5.7 Write property test for shift invariance
    - **Property 13: Shift invariance**
    - **Validates: Requirements 5.15**

  - [ ] 5.8 Implement severity, censoring and the bench record builder
    - Write `core/severity.ts` with `normalizedSeverity` (up: `(v-min)/(max-min)`, down: `(max-v)/(max-min)`, skip none, fixed and wrapping dimensions, 0 when none remain), `firstFailureTrials` (budget plus 1 when not found) and `buildBenchRecord`.
    - `buildBenchRecord` enforces `found` iff status `broken`, null severity when censored, and returns an error naming the Result_Key for an inconsistent record.
    - Add example tests for each rule and for the typed domain errors.
    - _Requirements: 4.9, 4.10, 4.11, 4.12, 4.13, 4.17, 19.17_

  - [ ] 5.9 Write property test for censoring
    - **Property 8: First failure trials and censoring**
    - **Validates: Requirements 4.10, 4.11, 4.12, 19.15**

  - [ ] 5.10 Write property test for severity bounds
    - **Property 9: Normalized severity is bounded and monotone**
    - **Validates: Requirements 19.10**

  - [ ] 5.11 Implement the bench summary
    - Write `core/stats/summarize-bench.ts`: sort records by Result_Key, drop excluded pairs, compute per requirement and Arm the found count with interval, median and IQR of first-failure trials, severity (null when none found) and wall time, the paired Wilcoxon result, labels (`guided better`, `random-only better`, `equal`, `uninformative`, `incomplete`, `excluded`), and the overall summary of requirement 5.10.
    - Report pairs used and an Anomaly for missing indices. Reject a record with a missing, non-finite or above-censored `firstFailureTrials`, naming file, line and key.
    - Add example tests for censored medians, an all-uninformative requirement and an incomplete requirement.
    - _Requirements: 5.1, 5.2, 5.3, 5.9, 5.10, 5.11, 5.12, 5.17, 5.18, 6.3, 6.5, 6.10_

  - [ ] 5.12 Write property test for order independence of statistics
    - **Property 14: Statistics ignore record order**
    - **Validates: Requirements 5.12**

  - [ ] 5.13 Write property test for the unit conversion round trip
    - Use the quantity conversion exported by `golem-spec` and generate quantities of every accepted unit.
    - **Property 36: Unit conversion round trip**
    - **Validates: Requirements 19.11**

- [ ] 6. G1 map analyzer
  - [ ] 6.1 Implement the map analyzer
    - Write `core/map-analyzer.ts` with `analyzeMap`: Cell_Outcome per cell, Boundary_Force per (direction, phase) as the first level with 2 or more falls, `above-max` with the highest level tested, `non-monotone` and `incomplete` flags with incomplete force levels, per-direction and per-phase minima, Weakest_Cell with all ties and the headline (lowest phase then lowest direction), seed-disagreement fraction with both counts, and the three flag counts.
    - Return no Weakest_Cell when no boundary is defined. Return a typed error for a non-increasing force list.
    - Add example tests for the incomplete-cell rules of 8.16 and for ties.
    - _Requirements: 7.10, 7.11, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.16, 8.17, 8.18, 19.17_

  - [ ] 6.2 Write property test for the boundary definition
    - **Property 15: Boundary force follows its definition**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.12**

  - [ ] 6.3 Write property test for boundary monotonicity
    - **Property 16: Turning a non-fall into a fall never raises a boundary**
    - **Validates: Requirements 8.13**

  - [ ] 6.4 Write property test for order independence of the map analysis
    - **Property 17: Map analysis ignores record order and repeats**
    - **Validates: Requirements 8.14, 8.18**

  - [ ] 6.5 Write property test for the weakest cell
    - **Property 18: Weakest cell is a minimum**
    - **Validates: Requirements 8.5, 8.6, 8.15**

- [ ] 7. Agent-gate pure logic
  - [ ] 7.1 Implement the claim classifier
    - Write `core/claim-classifier.ts` with `normalizeText` (NFKC, case fold, whitespace collapse, trim) and `classify`. Whole-word match using letter and digit classes, phrases normalised the same way, failure wins over success, evidence in order of first occurrence without duplicates, empty message gives `no-claim`. The function reads only the final message.
    - Add example tests for multi-word phrases, word boundaries, mixed phrases and empty input.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.14, 12.15_

  - [ ] 7.2 Write property test for classifier determinism and normalisation
    - **Property 22: Claim classification is deterministic and case and whitespace insensitive**
    - **Validates: Requirements 12.5, 12.6, 12.11, 12.14**

  - [ ] 7.3 Write property test for failure-phrase monotonicity
    - **Property 23: Appending a failure phrase never removes a failure claim**
    - **Validates: Requirements 12.3, 12.12**

  - [ ] 7.4 Write property test for success-phrase addition
    - **Property 24: Appending a success phrase to a message without a failure phrase gives a success claim**
    - **Validates: Requirements 12.2, 12.16**

  - [ ] 7.5 Implement the stream parser
    - Write `core/stream-parser.ts` with `parseStream` returning turns, full final message text, credits (finite and at least 0) and hook counts or null. Keep all `stream-json` field names in one `STREAM_SCHEMA` constant.
    - An empty stream or an invalid line returns an error with the line number.
    - Add example tests for a normal stream, no assistant message, missing credits and an invalid line.
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.10, 11.11, 12.8_

  - [ ] 7.6 Implement the snapshot diff
    - Write `core/snapshot-diff.ts` with `diffSnapshots` (added, removed and modified, compared by SHA-256, `/` separators, sorted by code point) and `shouldSkip` (`node_modules`, `.golem`, `.git`).
    - Add example tests for each change type and for skipped paths.
    - _Requirements: 11.7_

  - [ ] 7.7 Write property test for snapshot diff
    - **Property 21: Changed-file list is empty for equal snapshots and independent of listing order**
    - **Validates: Requirements 11.7, 11.18**

  - [ ] 7.8 Implement the credit scheduler
    - Write `core/credit-scheduler.ts` with `largestPerRun`, `decidePair` (start iff spent plus twice the largest per-run value is within the cap), `decideSingle`, `warnAt90`, and `creditsOf` (timed-out and error runs count, estimate when none reported).
    - Return typed errors for a negative cap or negative credits.
    - Add example tests for the 90% warning, the first pair with no history and exit-3 conditions.
    - _Requirements: 14.3, 14.4, 14.5, 14.6, 14.7, 14.9, 14.14, 14.15, 19.17_

  - [ ] 7.9 Write property test for cap enforcement
    - **Property 28: No pair or run starts above the credit cap**
    - **Validates: Requirements 14.4, 14.5, 14.9, 14.11**

  - [ ] 7.10 Write property test for the budget bound
    - **Property 29: Total spend stays within the cap**
    - **Validates: Requirements 14.7, 14.12**

  - [ ] 7.11 Write property test for cap monotonicity
    - **Property 30: Raising the cap never reduces started runs**
    - **Validates: Requirements 14.13**

  - [ ] 7.12 Implement the gate analyzer
    - Write `core/gate-analyzer.ts` with `labelRun` and `summarizeArms`: false-success, true-success, edited-requirements, passed-by-edit, exclusion rules, per-Arm counts, medians (mean of the middle two for even counts), credit totals with reported and estimated counts, False_Success rate with Clopper-Pearson interval and `k/n`, rate difference in percentage points, Fisher p-value only when the block names it.
    - Report `n/a` and an Anomaly for an Arm with no included run. Fail with Arm and `runIndex` for an invalid claim or an `ok` record with `gateExit` outside 0 and 2.
    - Add example tests, including the "2/7" display and the not-computed Fisher case.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.12, 13.13_

  - [ ] 7.13 Write property test for the claim partition
    - **Property 25: Claim counts partition the included runs**
    - **Validates: Requirements 13.5, 13.10**

  - [ ] 7.14 Write property test for gate summary order independence
    - **Property 26: Gate summary ignores order and conserves runs**
    - **Validates: Requirements 13.6, 13.11**

  - [ ] 7.15 Write property test for run labelling
    - **Property 27: Each included run gets exactly one outcome label**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 19.16**

- [ ] 8. Report, schemas and site data
  - [ ] 8.1 Implement the schemas and the validator
    - Write `core/schemas.ts` with a small hand-written validator that returns the first violating path, and schemas for the headers, run records and the four Site_Data_File shapes (`falsifier.json`, `g1-map.json`, `agent-gate.json`, `meta.json`).
    - Add example tests for accepted and rejected documents.
    - _Requirements: 2.11, 9.6, 15.11, 15.17_

  - [ ] 8.2 Implement the g1-map site data builder
    - Write the builder that outputs axes with `unit` fields, 180 boundary entries (null boundary and `capForce` for `above-max`), 2160 cell entries (null outcome when incomplete), flags, Weakest_Cell list, Prereg_Hash, commit and trial count (null `fell` entries included), with stable key order and fixed array order.
    - Validate against the schema before returning.
    - Add example tests for a partial file and an all-`above-max` file.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.8_

  - [ ] 8.3 Write property test for g1-map.json round trip
    - **Property 19: g1-map.json round trip**
    - **Validates: Requirements 9.1, 9.3, 9.8, 9.9**

  - [ ] 8.4 Implement the falsifier, agent-gate and meta site data builders
    - Write builders for `falsifier.json` (counts, medians, IQR, Wilcoxon fields, `exact` or `approximate`, `underpowered`), `agent-gate.json` (per-Arm summary and per-run table without final message text) and `meta.json` (status, hash, commit, runs read and required, Anomaly count).
    - Set `status` to `not-run` or `incomplete` as the report rules require.
    - Add example tests for each status.
    - _Requirements: 15.9, 15.10, 15.13, 15.14, 15.19_

  - [ ] 8.5 Implement report rendering and `buildReport`
    - Write `core/report-render.ts` and `buildReport` as a pure function: sort by Result_Key, build tables with the raw file path next to each, render the fixed honesty phrases (no counterexample wording, `>N` for censored medians, row labels, the 8.10 and 8.17 headlines, limits statements), the "What went wrong" and "Limits" sections, the Anomaly list including Prereg_Hash mismatches, the credit-cap stop section, and the appendix of disagreeing final messages with the keyword-rule caveat and the both-phrase count.
    - Use no timestamp, locale, `Date` or environment read. Take dates from header records. Return exit code 1 for input errors and 2 for schema violations.
    - Add example tests, plus a check over generated inputs that "proved", "safe", "satisfied", "held" and "passed" never appear in a requirement row.
    - _Requirements: 1.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 8.10, 8.11, 12.9, 12.10, 14.8, 15.1, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 15.12_

  - [ ] 8.6 Write property test for report idempotence
    - **Property 31: Report generation is idempotent**
    - **Validates: Requirements 15.3, 15.12, 15.16**

  - [ ] 8.7 Write property test for site data validity
    - **Property 32: Site data files parse and pass their schemas**
    - **Validates: Requirements 15.11, 15.17**

  - [ ] 8.8 Write property test for report order independence
    - **Property 33: Report output ignores record and file order**
    - **Validates: Requirements 15.21**

  - [ ] 8.9 Add golden files for the report and site data
    - Build a fixed input of at most 50 raw records covering all three experiments, and commit the expected `REPORT.md` and the four Site_Data_File outputs under `evidence/scripts/test/golden/`.
    - Compare byte for byte and report the first differing line. Update goldens only with an explicit update flag.
    - _Requirements: 17.7, 17.12_

  - [ ] 8.10 Implement the `report.ts` shell
    - Read the Raw_Result_File entries, the Preregistration and the Run_Log files through the injected file system, call `buildReport`, write every output to a temporary name in its target directory and rename all of them only after every temporary write succeeds.
    - Exit codes: 0 success, 1 input error (unreadable file, no header, bad line, missing path), 2 schema violation. Write nothing on failure and leave existing outputs unchanged.
    - Add example tests for a failed temporary write, a failed rename, a missing file (`not run`) and a bad line.
    - _Requirements: 15.1, 15.2, 15.9, 15.11, 15.15, 15.18, 15.20, 20.9_

- [ ] 9. Experiment runners
  - [ ] 9.1 Implement the falsifier adapter and git info
    - Write `lib/falsifier-adapter.ts` (the only file that touches `loadRequirements`, `createNodePool` and `falsify`): map `guided` and `random-only` to the falsifier options with Phase 0 off, an empty seed database and no seed persistence, and derive `firstFailureTrials` from `onTrial` when the verdict lacks it.
    - Write `lib/git-info.ts` returning commit, `dirty` and the SHA-256 of the diff for `skeleton/` and `apps/`, with the changed paths.
    - Add example tests with a fake falsifier and fake exec.
    - _Requirements: 4.1, 4.5, 4.6, 16.8, 18.4_

  - [ ] 9.2 Implement the bench-falsifier runner
    - Write `bench-falsifier.ts` using the lifecycle in the design: load and compile requirements (Anomaly and no record for a compile error), run the pairs back to back on one pool, measure `wallMs` around the search only, write the header (pool size, CPU model, app commits, requirement source hashes, budgets, `dirty`), append records durably, refuse resume on a changed source hash, log found counts and medians after each requirement.
    - Release the pool in `finally`. Write an error record and an Anomaly for an `error` verdict.
    - Add example tests with the synthetic falsifier, including compile error, error verdict, resume and changed requirement hash.
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.13, 4.14, 4.15, 4.16, 4.17, 4.18, 16.9, 18.1, 18.4, 18.5_

  - [ ] 9.3 Implement the map-g1 runner
    - Write `map-g1.ts`: read dimension names from the compiled stagger requirement space, build one `TrialSpec` per unit, send batches to the `TrialPool`, and append records in plan order through a reorder buffer so the file is always a contiguous prefix.
    - Set `fell` from the compiled monitor robustness below 0. Retry an errored trial once with the same seed, then leave `fell` null and mark the cell incomplete. Write dimensions and units in the header.
    - Add example tests with the synthetic trial function, including out-of-order results, one retry success and a double failure.
    - _Requirements: 7.1, 7.4, 7.5, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12_

  - [ ] 9.4 Implement the workspace and agent execution libraries
    - Write `lib/workspace.ts`: create a temp directory outside the repository, copy `apps/candy` with the committed V1 controller overlay, run `golem init`, remove the hook for Arm A or verify it for Arm B by scanning `.kiro/hooks/*.json`, take snapshots and requirements hashes, copy for the independent gate run with `.golem/` removed, and delete on request.
    - Write `lib/agent-exec.ts` for `kiro-cli` and the stub agent command, the preflight checks (version, login, v1 gate exits 2 and names the hand-separation requirement) and the independent gate run with its time limit and exit-code parsing.
    - Add example tests with the stub exec and in-memory file system.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.11, 10.12, 10.13, 11.8, 11.9, 11.12, 14.10_

  - [ ] 9.5 Implement the agent-gate runner
    - Write `agent-gate.ts`: preflight, the seeded plan, `decidePair` before each pair, one run at a time, wall-time limit with process-tree kill, verbatim Stream_Log saved under the derived file name, claim from the final message only, independent gate run, record with every field of 11.1 and the statuses `ok`, `gate-error`, `stream-error` and `error`, credit accounting that includes failed and timed-out runs, the 90% warning, exit 3 with the four values on a cap stop, SIGINT handling that kills children, deletes the workspace unless `--keep` and exits 130, and the `--dry-run` stub path that spends no credits and writes no results.
    - Abort when the `kiro-cli` version changes during the run, keeping earlier records.
    - Add example tests with the stub agent for each status, cap stop with exit 3, resume that counts earlier spend, timeout, SIGINT and the override rule for a higher cap.
    - _Requirements: 10.6, 10.7, 10.8, 10.9, 10.10, 10.11, 10.14, 10.15, 11.1, 11.3, 11.4, 11.5, 11.6, 11.7, 11.9, 11.10, 11.11, 11.13, 11.14, 11.15, 11.16, 14.1, 14.2, 14.3, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.14, 14.16, 18.1, 18.3_

  - [ ] 9.6 Write property test for agent record consistency
    - **Property 20: Agent record consistency**
    - **Validates: Requirements 11.6, 11.17**

  - [ ] 9.7 Write property test for determinism across pool sizes
    - Use the synthetic trial function and a fake pool of sizes 1 to 8, with no MuJoCo load.
    - **Property 34: Trial results are deterministic across pool sizes**
    - **Validates: Requirements 7.9, 16.5, 16.6, 16.14**

- [ ] 10. Command-line interface
  - [ ] 10.1 Implement the CLI
    - Write `cli.ts` with a hand-written parser for `bench-falsifier`, `map-g1`, `agent-gate` and `report` and the flags `--dry-run`, `--override-prereg`, `--keep`, `--credit-cap`, `--stub-agent` and `--only <result-key>`.
    - Reject unknown commands, flags, missing arguments and unknown Result_Keys before any work, naming the token and listing valid values.
    - `--dry-run` prints planned units, the Prereg_Hash and the key list, and writes nothing. `--only` runs one unit, prints the record, compares the deterministic fields and prints `match` or the differing field names, warns when the commit differs, and never writes a Raw_Result_File.
    - Print the single-key reproduction command for each experiment. Print the Run_Log path and the resume command as the last console lines on failure and interruption.
    - Add example tests for parsing, each refusal, `--dry-run`, `--only` match and mismatch.
    - _Requirements: 2.8, 16.1, 16.2, 16.3, 16.7, 16.10, 16.11, 16.12, 16.13, 18.9_

- [ ] 11. Repository checks and smoke tests
  - [ ] 11.1 Add licence and ignore-rule checks
    - Write a check script and test (with a fake exec) that confirms `git check-ignore` matches none of the results, logs or stream log paths, that `.partial` files under `evidence/results/` are ignored, that the Apache-2.0 licence is in the repository root, and that the BSD-3-Clause and Apache-2.0 notices exist in `apps/stagger/robot/LICENSE` and `apps/candy/robot/LICENSE`.
    - Check that `evidence/results/` holds only `falsifier.jsonl`, `g1-map.jsonl`, `agent-gate.jsonl` and the `agent-gate/` directory.
    - _Requirements: 20.3, 20.4, 20.5, 20.6, 20.7_

  - [ ] 11.2 Add the dry-run smoke test
    - Run the CLI `--dry-run` for `bench-falsifier`, `map-g1` and `agent-gate` against the committed `PREREG.md` through a read-only file adapter and assert exit code 0, the planned unit counts (40 per requirement for bench, 6480 for the map, 16 for the gate), the Prereg_Hash line and that no Raw_Result_File or credit use occurs. Also run `agent-gate --dry-run` with the stub agent.
    - Assert that `PREREG.md` passes `validatePrereg` and that the worked examples for the Censored_Value, Boundary_Force and Claim_Classifier rules are present.
    - _Requirements: 1.1, 1.10, 14.10, 16.2, 17.2_

  - [ ] 11.3 Add static and timing checks
    - Add a test that scans `core/` for forbidden imports (`node:fs`, `node:child_process`, `node:os`, clock and random APIs) and a test that scans the scripts for `Math.random` and for numeric literals of budgets, seed counts and credit cap outside the schema constants.
    - Add a test that asserts deep imports of `skeleton/src/...` do not occur.
    - Add a suite-level check that all property tests use at least 100 runs and a fixed seed, and that the full suite runs without MuJoCo, `kiro-cli` or network.
    - _Requirements: 1.7, 16.4, 16.8, 17.1, 17.2, 17.10, 17.11, 19.12, 19.13_

- [ ] 12. Checkpoint - implementation complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Manual campaigns (not part of CI, optional, run by the operator)
  - These tasks run the real experiments. They need MuJoCo (13.1, 13.2) or `kiro-cli` with credits (13.3) and can take hours. Do not run them in the Vitest suite. Run each command in a terminal, check the preconditions first, and commit the raw JSONL and logs afterward.
  - [ ]* 13.1 Run the bench-falsifier campaign
    - Precondition: `PREREG.md` is committed (task 4.2) and the working tree is clean.
    - Run `bench-falsifier --dry-run`, then the real command. Resume with the same command after an interruption.
    - Commit `evidence/results/falsifier.jsonl` and its log.
    - _Requirements: 4.1, 4.3, 16.1, 16.5, 20.4_

  - [ ]* 13.2 Run the map-g1 campaign
    - Precondition as in 13.1.
    - Run `map-g1 --dry-run`, then the real command (6480 trials). Resume with the same command after an interruption.
    - Commit `evidence/results/g1-map.jsonl` and its log.
    - _Requirements: 7.1, 7.9, 16.6, 20.4_

  - [ ]* 13.3 Run the agent-gate campaign with credits
    - Precondition: `kiro-cli` installed and logged in, credit cap 150 or lower, and the preflight passes.
    - Run `agent-gate --dry-run --stub-agent <cmd>` first, then the real command. A stop with exit 3 is a valid outcome and is reported as such.
    - Commit `evidence/results/agent-gate.jsonl`, the `agent-gate/` stream logs and the log.
    - _Requirements: 10.7, 10.12, 14.1, 14.5, 14.16, 20.4_

  - [ ]* 13.4 Generate and commit the report
    - Run `report`, check that it exits with code 0, and commit `evidence/REPORT.md` and `site/data/*.json`.
    - Run `report` a second time and check that `git diff` shows no change.
    - _Requirements: 15.1, 15.2, 15.16_

- [ ] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Property tests are separate sub-tasks and are not marked optional, because `testing.md` requires properties for every core module. Only the manual campaigns in task 13 are marked optional.
- Example tests live in the same task as the logic they test.
- Each property test file is separate from every other, so tasks in one wave never write to the same file.
- Tasks 13.x are not part of CI. The Vitest suite uses synthetic trial functions and a stub agent only.
- `PREREG.md` (task 4.2) must be committed before any file appears under `evidence/results/`.
- Never weaken an assertion to make a test pass. If a test is wrong, the commit message states why.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.3", "5.1", "5.3", "5.4", "5.8", "5.13", "6.1", "7.1", "7.5", "7.6", "7.8", "8.1"] },
    { "id": 2, "tasks": ["1.3", "2.2", "2.4", "2.5", "3.1", "4.1", "5.2", "5.5", "5.6", "5.7", "5.9", "5.10", "5.11", "6.2", "6.3", "6.4", "6.5", "7.2", "7.3", "7.4", "7.7", "7.9", "7.10", "7.11", "7.12", "8.2", "9.1"] },
    { "id": 3, "tasks": ["1.4", "3.2", "3.3", "3.4", "3.7", "4.2", "5.12", "7.13", "7.14", "7.15", "8.3", "8.4", "9.4"] },
    { "id": 4, "tasks": ["3.5", "3.6", "8.5", "9.2", "9.3", "9.5"] },
    { "id": 5, "tasks": ["8.6", "8.7", "8.8", "8.9", "8.10", "9.6", "9.7", "11.1"] },
    { "id": 6, "tasks": ["10.1"] },
    { "id": 7, "tasks": ["11.2", "11.3"] },
    { "id": 8, "tasks": ["12"] },
    { "id": 9, "tasks": ["13.1", "13.2", "13.3"] },
    { "id": 10, "tasks": ["13.4"] },
    { "id": 11, "tasks": ["14"] }
  ]
}
```
