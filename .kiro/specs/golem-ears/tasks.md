# Implementation Plan: golem-ears

## Overview

The `ears` module lives in `skeleton/src/ears/` (TypeScript strict, ES modules, Vitest, fast-check). The plan builds the independent leaves first (types and diagnostics, unit table, token edit distance, tokenizer, AST, monitor), then the parser, ranges, quantity parsing and matcher, then the compiler, formatter and extractor, and finally the public export through `golem-spec`.

Conventions for every task:
- Source files go in `skeleton/src/ears/`. Tests go in `skeleton/src/ears/__tests__/`.
- Each implementation sub-task includes its own example tests (Vitest), as `testing.md` requires. Each design property is its own sub-task and uses fast-check.
- Property tests run with `numRuns >= 100` and the fixed seed from `__tests__/support.ts` (override with `GOLEM_SEED`). Tag each test with a comment `Feature: golem-ears, Property N: <title>`.
- Tests use only synthetic traces of at most 1000 samples. They never import MuJoCo and never use `Math.random()`, the clock or the network.
- Test names state the behaviour, for example `it('rejects a force without a unit')`. Never weaken an assertion or a requirement to make a test pass.
- Shared shapes from `.kiro/steering/interfaces.md` are used unchanged. Any new field is optional.

## Tasks

- [x] 1. Foundations: shared types, diagnostics and test support
  - [x] 1.1 Create `types.ts` and `diagnostics.ts`
    - In `types.ts`, reuse any existing declaration in `skeleton/src/index.ts` for `Kind`, `Quantity`, `Dimension`, `Trace`, `CompiledRequirement`, `Lexicon` and the template types. Otherwise declare them exactly as in `interfaces.md`.
    - Add the shared ears types: `Token`, `TokenType`, `Span`, `SlotKind`, `CompiledTemplate`, `TemporalWrapper`, `MonitorSpec`, `CompileOptions`.
    - Add optional fields only: `Lexicon.episodeSeconds?` and `PredicateTemplate.dims?`.
    - In `diagnostics.ts`, add `DiagnosticKind`, `Diagnostic`, `makeDiagnostic`, `sortDiagnostics` (ascending `start`, stable) and `hasError`.
    - Write example tests for `sortDiagnostics` stability, `hasError`, and the well-formed fields (`line >= 1`, `column >= 1`, `end >= start`).
    - _Requirements: 8.1, 8.7, 12.14_
  - [x] 1.2 Create test support `__tests__/support.ts`
    - Export `SEED` (constant, overridable by `GOLEM_SEED`), `propConfig` (`numRuns: 100`, the seed, logged on failure) and `deepFreeze`.
    - Confirm `skeleton/vitest.config.ts` includes `src/**/__tests__/**/*.test.ts`. Edit it only if it does not.
    - Add an example test that `propConfig` has `numRuns >= 100` and a numeric seed.
    - _Requirements: 13.1, 13.2, 13.12_

- [x] 2. Unit table
  - [x] 2.1 Implement `units.ts` table and conversions
    - Add `UNIT_TABLE`, `ACCEPTED_UNITS`, `toSI` and `fromSI` with the factors and kinds from the design (N, kN, s, ms, m, cm, mm, m/s, cm/s, deg, °, rad, kg, g, %). Matching is case-sensitive. `fromSI(0, u)` returns exactly 0.
    - Write example tests: every unit's factor and kind, `n` and `M` are not accepted units, 200 kN equals 200000 N.
    - _Requirements: 2.2, 2.3, 2.4_
  - [x] 2.2 Write property test for unit conversion identity
    - **Property 5: Unit conversion is the identity**
    - **Validates: Requirements 2.11, 13.4**

- [x] 3. Token edit distance
  - [x] 3.1 Implement `tokenEditDistance` in `editDistance.ts`
    - Levenshtein over `WildToken` and string sequences. Words compare case-folded. Equal-kind wildcards cost 0, different-kind wildcards cost 1. Use two rolling `Int32Array` rows.
    - Write example tests: identical sequences, one insertion, one substitution, case folding, wildcard kinds.
    - _Requirements: 9.1, 9.3, 9.4_
  - [x] 3.2 Write reference Levenshtein and property test for metric laws
    - Create `__tests__/refEditDistance.ts` (full-matrix reference) and `arbTokenSeq` over a small alphabet in `__tests__/generators.tokens.ts`.
    - **Property 16: Token edit distance obeys the metric laws**
    - **Validates: Requirements 9.10, 9.11, 13.8**
  - [x] 3.3 Write property test for edit distance against the reference
    - **Property 17: Edit distance matches a reference and handles wildcards** (sequence-level: words and wildcards)
    - **Validates: Requirements 9.1, 9.3, 9.4**

- [x] 4. Tokenizer
  - [x] 4.1 Implement `tokenizer.ts`
    - Scan order from the design: whitespace, requirement ID at start, number, unit by longest match after a number (word boundary required), word or keyword (whole word, case-insensitive, original spelling kept), comma, otherwise one error diagnostic (`PATTERN_MISMATCH` naming the character) and continue.
    - Track line and column incrementally. `\r\n` is one break. Count UTF-16 units.
    - Write example tests: `THENCE` and `IFFY` are words, `m/s` beats `m`, `5 mx` gives a word, empty input gives no tokens, an illegal character gives one diagnostic and scanning continues, ID forms `R3.`, `2.` and `2.1`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.11_
  - [x] 4.2 Write reference line and column calculator and property test
    - Create `__tests__/refTokenize.ts` (independent line and column from the input prefix).
    - **Property 2: Tokenizer line and column agree with an independent calculation**
    - **Validates: Requirements 1.8, 8.9**
  - [x] 4.3 Write property test for tokenizer coverage and offsets
    - **Property 1: Tokenizer coverage and offsets**
    - **Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.10, 13.9**
  - [x] 4.4 Write property test for keyword recognition
    - **Property 3: Keyword recognition ignores case and whole-word only**
    - **Validates: Requirements 1.6, 1.7**

- [x] 5. AST and test generators
  - [x] 5.1 Implement `ast.ts`
    - Add `Pattern`, `Clause`, `ParsedRequirement` and `stripOffsets` (removes `start`, `end`, `line`, `column` and `span` recursively and upper-cases keywords).
    - Write example tests: two ASTs differing only in offsets are equal after `stripOffsets`, and `stripOffsets` does not mutate its input.
    - _Requirements: 3.12, 3.14, 10.8_
  - [x] 5.2 Implement shared generators in `__tests__/generators.ts`
    - `arbUnit`, `arbQuantity(kind?)` (zero or one space), `arbLexicon` (1 to 6 templates per class, unique first words, mixed slot kinds, `above` margin), `arbValidLine(lexicon)` (all five patterns, ID forms, keyword case, optional commas; returns text and expected AST fields), `arbMutation` (swap, delete, insert, misspell).
    - Write example tests that generated lines tokenize without diagnostics.
    - _Requirements: 13.1, 13.2, 13.12_

- [x] 6. Quantity parsing
  - [x] 6.1 Implement `parseQuantity` and `quantityFromTokens` in `units.ts`
    - Quantity `text` is the exact source substring. `{count}` accepts an unsigned integer. `{ratio}` accepts `%` or a bare number in [0, 1], otherwise `BAD_RANGE` stating the interval. Other bare numbers give `MISSING_UNIT`. An unknown word after a number gives `UNKNOWN_PHRASE` listing accepted units. Kind mismatch is reported by the matcher.
    - Write example tests: `rejects a force without a unit` (`MISSING_UNIT` with line and column), `0.20 s` keeps its spelling, ratio 1.5 gives `BAD_RANGE`, count `3`.
    - _Requirements: 2.1, 2.5, 2.6, 2.7, 2.8, 2.9, 2.12_
  - [x] 6.2 Write property test for quantity SI conversion
    - **Property 4: Quantities convert to SI with the table kind and preserve text**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.12**
  - [x] 6.3 Write property test for quantity text round trip
    - **Property 6: Quantity text round trip**
    - **Validates: Requirements 2.12**
  - [x] 6.4 Write property test for bare numbers
    - **Property 7: Bare numbers are accepted only for count and in-range ratio**
    - **Validates: Requirements 2.5, 2.6, 2.7, 2.8**

- [x] 7. Range phrases
  - [x] 7.1 Implement `ranges.ts`
    - `parseRangePhrase` for `up to <q>`, `<q> to <q>`, `from any direction` (0 to 2π, wrap), `from behind` (3π/4 to 5π/4, wrap), `at any point in its stride` (phase 0 to 1, wrap) and a lone fixed quantity. `rangeToDimension(name, range, severity)`.
    - `BAD_RANGE` at the second quantity for min > max and mixed kinds, at the quantity for a negative force, duration, length, speed or mass, and at the second range when a slot gets two ranges.
    - Write example tests: the constants for `from behind` and `at any point in its stride`, `up to 0 N` is a valid fixed range, a `BAD_RANGE` example with line and column.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12_
  - [x] 7.2 Write property test for range phrases
    - **Property 12: Range phrases produce the right interval and Dimension**
    - **Validates: Requirements 4.1, 4.2, 4.6, 4.11, 4.12, 5.8**
  - [x] 7.3 Write property test for invalid ranges
    - **Property 13: Invalid ranges are rejected with BAD_RANGE**
    - **Validates: Requirements 4.7, 4.8, 4.9**

- [x] 8. Parser
  - [x] 8.1 Implement `parser.ts`
    - Single pass for the five patterns, ID stripped of its trailing period, optional comma before THE and after THEN, clause boundary at the next `THE <robot> SHALL`, keywords stored in upper case, robot name as written, clause spans from first to last token.
    - Diagnostics: `PATTERN_MISMATCH` (naming the closest pattern and the expected keyword or clause, second SHALL, empty clause) and `UNKNOWN_ROBOT` with allowed names in `suggestion`. No AST when any error is found.
    - Write example tests: one example per pattern, `WHEN x, THE robot SHALL y` equals the line without the comma, empty clause, second SHALL, unknown robot.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16_
  - [x] 8.2 Write property test for generated valid lines
    - **Property 9: Generated valid lines parse to the expected pattern, ID and clauses**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.8, 3.9, 3.12, 3.14**
  - [x] 8.3 Write property test for unknown robot names
    - **Property 11: Unknown robot names are rejected and listed**
    - **Validates: Requirements 3.11, 8.6**

- [x] 9. Monitor builder
  - [x] 9.1 Implement `monitor.ts`
    - `buildMonitor(spec)` as in the design: `+Infinity` for a disabled feature, `NaN` with unit `signal` for a missing signal, `NaN` with unit `trace` for no trigger or an empty window, anchor at the first `trigger` event, binary search for the window start, closed window, no interpolation, always as min and eventually as max with the earliest time on ties, `NaN` margin returns immediately, state pattern as `max(-stateMargin, responseMargin)`.
    - Allocate the scratch record and signal-array list once in `buildMonitor`. The sample loop uses indices and scalar locals only. Never write to `Trace`.
    - Write example tests: always over `[t₀, t₀+3 s]`, eventually within a window, window past the last sample, a tie keeps the earliest time, state pattern example.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.10, 6.11, 6.12, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.16_
  - [x] 9.2 Write reference monitor and trace generators
    - Create `__tests__/refMonitor.ts` (naive loop filtering `a <= t <= b`) and `__tests__/generators.trace.ts` with `arbTrace` (strictly increasing `t`, 1 to 1000 samples, repeated values for ties, optional trigger events).
    - Write example tests that `arbTrace` output satisfies the trace conventions.
    - _Requirements: 13.12_
  - [x] 9.3 Write property test for the trigger anchor
    - **Property 19: First trigger anchors the window**
    - **Validates: Requirements 6.6, 6.13**
  - [x] 9.4 Write property test for unmeasurable cases
    - **Property 20: A trace with no trigger, no window sample or a missing signal is never reported as satisfied**
    - **Validates: Requirements 6.7, 6.11, 7.5, 7.9, 7.10**
  - [x] 9.5 Write property test against the naive reference
    - **Property 21: The monitor equals a naive reference over the closed window**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.10, 6.12, 7.2, 7.3, 7.4, 7.6, 7.7**
  - [x] 9.6 Write property test for robustness soundness
    - **Property 22: Robustness soundness**
    - **Validates: Requirements 7.11, 7.12, 13.5**
  - [x] 9.7 Write property test for the threshold sign flip
    - **Property 23: Sign flips when the threshold crosses the signal**
    - **Validates: Requirements 7.13, 13.5**
  - [x] 9.8 Write property test for threshold monotonicity
    - **Property 24: Raising an above threshold never raises robustness**
    - **Validates: Requirements 7.14, 13.6**
  - [x] 9.9 Write property test for a disabled optional feature
    - **Property 25: A disabled optional feature is vacuously satisfied**
    - **Validates: Requirements 6.8**
  - [x] 9.10 Write property test for monitor purity
    - **Property 27: Monitors are pure and read-only** (deep-frozen trace, bit-identical results with `Object.is`)
    - **Validates: Requirements 7.1, 7.8, 7.15, 7.16**

- [x] 10. Lexicon matcher and suggestions
  - [x] 10.1 Add `toWildcardSequence` and `closestTemplate` to `editDistance.ts`
    - A number with its unit, or a bare count or ratio, collapses to one wildcard of its kind. Templates compare only within their class. Ties go to the earlier template. `tooFar` is true when `distance > max(lenA, lenB) / 2`.
    - Write example tests: a quantity counts as one token, a tie picks the first template, `tooFar` omits the suggestion, an empty class gives no template.
    - _Requirements: 9.2, 9.5, 9.6, 9.7, 9.8, 9.9_
  - [x] 10.2 Write property test for wildcard edit distance from clauses
    - **Property 17: Edit distance matches a reference and handles wildcards** (clause-level: quantities collapse to one wildcard)
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
  - [x] 10.3 Implement `matcher.ts`
    - `compileTemplate` (cached per Lexicon in a `WeakMap`), `matchPerturbation` and `matchPredicate`. Exact token-for-token matching, case-insensitive literals, slots by kind. `{range:<kind>}` passes the Dimension to the template `dims`. Strip a trailing `for <duration>` or `within <duration>` into a `TemporalWrapper`.
    - Diagnostics: `UNKNOWN_PHRASE` at the first unmatched token with the closest phrase as `suggestion` (or none when too far or the class is empty, with the message saying so), a kind mismatch naming both kinds, and one diagnostic listing all phrases in Lexicon order for an ambiguous clause.
    - Write example tests: an ambiguous template pair, an empty Lexicon class, a kind mismatch, a misspelt word gives a suggestion.
    - _Requirements: 2.10, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9, 5.10, 5.11, 9.7, 9.8, 9.9_
  - [x] 10.4 Write property test for template matching
    - **Property 14: Template matching binds the written values**
    - **Validates: Requirements 5.1, 5.2, 5.10, 5.11**
  - [x] 10.5 Write property test for exact matching
    - **Property 15: Matching is exact, never approximate**
    - **Validates: Requirements 5.4, 5.6**
  - [x] 10.6 Write property test for kind mismatch
    - **Property 8: Quantity kind mismatch is rejected with both kinds named**
    - **Validates: Requirements 2.10, 5.3, 5.7**
  - [x] 10.7 Write property test for the suggestion
    - **Property 18: The suggestion is the first closest template of the right class, or absent when too far**
    - **Validates: Requirements 5.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.12**

- [x] 11. Checkpoint - Ensure all tests pass
  - Run `npx vitest --run` in `skeleton/`. Ensure all tests pass, ask the user if questions arise.

- [x] 12. Compiler
  - [x] 12.1 Implement `compileRequirement` in `compile.ts`
    - Run tokenizer, parser, matcher and monitor builder. Return no requirement when any diagnostic is an error, and return warnings with the requirement otherwise.
    - Set `id` (AST ID, else `options.id`, else `''`), `source` (input unchanged), `pattern`, `space.dims` (trigger Dimensions in source order for event and unwanted, template `dims` otherwise), one `PerturbationCall` per matched template (Dimension name for a searched value, SI number for a fixed one), and `horizon` (wrapper plus trigger duration, or `episodeSeconds` with a 10 s default). Duplicate Dimension names give an error at the second occurrence.
    - Write example tests: one compiled example per pattern, duplicate Dimension name, WHERE with a disabled feature, `episodeSeconds` override.
    - _Requirements: 6.8, 6.9, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.11, 12.13, 5.8, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.10, 8.11, 8.12_
  - [x] 12.2 Write property test for the horizon
    - **Property 26: Horizon follows the wrapper and trigger durations**
    - **Validates: Requirements 6.9**
  - [x] 12.3 Write property test for diagnostics
    - **Property 28: Diagnostics are well formed, ordered, positioned and decide the outcome**
    - **Validates: Requirements 8.1, 8.7, 8.8, 8.11, 8.12**
  - [x] 12.4 Write property test for determinism and input immutability
    - **Property 29: Compiling is deterministic and does not mutate its inputs**
    - **Validates: Requirements 1.11, 3.16, 8.13, 12.11, 12.13, 13.7**
  - [x] 12.5 Write property test for compiled identity and dimensions
    - **Property 30: Compiled requirements carry the line's identity and ordered unique dimensions**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.7**

- [ ] 13. Formatter
  - [x] 13.1 Implement `format.ts`
    - Print the five canonical shapes, with an optional ID followed by one space, a comma attached to the previous token, and quantity text as written. Throw an `Error` naming the field for a missing or unknown `pattern`. Never mutate the AST.
    - Write example tests: each shape, `0.20 s` stays `0.20 s`, `200 N` is never printed as `0.2 kN`, the invalid pattern throws.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.11_
  - [-] 13.2 Write property test for the parse and format round trip
    - **Property 31: Parse and format round trip**
    - **Validates: Requirements 10.8, 13.3**
  - [-] 13.3 Write property test for comma insensitivity
    - **Property 10: Optional commas do not change the AST or the canonical text**
    - **Validates: Requirements 3.6, 3.7, 10.9**
  - [-] 13.4 Write property test for canonical layout and idempotence
    - **Property 32: Canonical text layout and idempotence**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.10**

- [ ] 14. Extractor
  - [x] 14.1 Implement `extract.ts`
    - `extractCriteria(text)`: split on `\r?\n` with a line-start table, track `### Requirement <n>` and `#### Acceptance Criteria`, accept `<m>.` and `<m>)`, ignore `-` and `*` bullets, join indented continuation lines with one space, end at a blank line, a numbered line or a heading. Return `id`, `text`, `line`, `column` and `offset`.
    - Emit `NON_EARS_LINE` warnings for non-EARS and `FOR ALL` lines. Use `R0` plus one warning for a criterion before any requirement heading.
    - Write example tests: a Kiro-style file with a comma before THE and one without, ids, texts, lines and columns, CRLF equals LF, no acceptance heading gives an empty list.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12, 13.11_
  - [x] 14.2 Add the requirements-file generator
    - Add `arbRequirementsFile` in `__tests__/generators.file.ts`: headings, `.` or `)` numbering, continuation lines, bullets, non-EARS lines, `FOR ALL` lines, LF or CRLF, each file carrying its expected criteria list.
    - Write example tests that the generated expectation matches a hand-written file.
    - _Requirements: 13.2_
  - [~] 14.3 Write property test for extraction
    - **Property 33: Extractor returns qualifying criteria with unique ordered IDs and exact positions**
    - **Validates: Requirements 11.1, 11.2, 11.4, 11.7, 11.13**
  - [~] 14.4 Write property test for skipped lines
    - **Property 34: Extractor skips non-EARS and FOR ALL lines with a warning and ignores bullets**
    - **Validates: Requirements 11.5, 11.8, 11.11, 11.12**
  - [~] 14.5 Write property test for layout insensitivity
    - **Property 35: Extractor is insensitive to line endings, number format and continuation layout**
    - **Validates: Requirements 11.8, 11.9, 11.10**

- [ ] 15. File-level compilation
  - [-] 15.1 Implement `compileRequirementsFile` in `compile.ts`
    - Extract, compile each criterion independently, and keep every valid requirement in file order. Map diagnostic offsets, lines and columns to file coordinates, using a per-criterion offset map for joined continuation lines. A repeated Requirement ID adds one warning at the second criterion and keeps both.
    - Write example tests: one invalid criterion among valid ones, a diagnostic position in file coordinates, a duplicate ID.
    - _Requirements: 8.14, 12.8, 12.9, 12.10_
  - [~] 15.2 Write property test for file compilation
    - **Property 36: File compilation isolates failures and reports in file coordinates**
    - **Validates: Requirements 12.8, 12.9, 12.10, 8.14**

- [ ] 16. Public entry point
  - [~] 16.1 Wire the exports
    - Create `skeleton/src/ears/index.ts` exporting `compileRequirement`, `compileRequirementsFile`, `extractCriteria`, `tokenize`, `parse`, `format`, `parseQuantity`, `toSI`, `fromSI`, `tokenEditDistance` and the public types.
    - Re-export them from `skeleton/src/index.ts` so apps import from `golem-spec`. Do not deep-import `skeleton/src/ears/...` anywhere outside the module.
    - _Requirements: 12.14_
  - [~] 16.2 Write smoke tests for exports and purity
    - Test that `golem-spec` (the `skeleton/src/index.ts` entry) exposes every public function.
    - Test that no file under `ears/` (excluding `__tests__`) mentions `Math.random`, `Date.now`, `performance.now`, `fetch` or `node:fs`.
    - _Requirements: 12.12, 12.14_

- [ ] 17. Diagnostic and Kiro-file example tests
  - [~] 17.1 Write example tests per Diagnostic kind
    - One test for each of `PATTERN_MISMATCH`, `MISSING_UNIT`, `UNKNOWN_PHRASE`, `BAD_RANGE`, `UNKNOWN_ROBOT` and `NON_EARS_LINE`, asserting `kind`, one-based `line` and one-based `column`, going through the public entry point.
    - Add a test that compiles a Kiro-style `requirements.md` containing lines with and without the comma before THE and asserts ids, texts, lines and columns.
    - _Requirements: 13.10, 13.11, 13.14_

- [~] 18. Final checkpoint - Ensure all tests pass
  - Run `npx vitest --run` in `skeleton/`, and run the TypeScript type check. Ensure all tests pass, ask the user if questions arise.

## Notes

- Test sub-tasks are not marked optional, because `testing.md` requires every task that adds logic to add its tests in the same task.
- Each property test references a design property number and the requirements it validates. Properties 16, 17 and 18 span several tasks because the edit distance core and the clause-level wildcard step land in different waves.
- Extra fields on shared shapes (`Lexicon.episodeSeconds`, `PredicateTemplate.dims`) are optional and additive.
- Simulation, the falsifier and MuJoCo are out of scope for this spec.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1", "5.1", "9.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.1", "5.2", "9.2"] },
    { "id": 3, "tasks": ["3.3", "4.2", "4.3", "4.4", "6.1", "8.1", "10.1", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8", "9.9", "9.10"] },
    { "id": 4, "tasks": ["6.2", "6.3", "6.4", "7.1", "8.2", "8.3", "10.2"] },
    { "id": 5, "tasks": ["7.2", "7.3", "10.3"] },
    { "id": 6, "tasks": ["10.4", "10.5", "10.6", "10.7"] },
    { "id": 7, "tasks": ["11"] },
    { "id": 8, "tasks": ["12.1", "13.1", "14.1"] },
    { "id": 9, "tasks": ["12.2", "12.3", "12.4", "12.5", "13.2", "13.3", "13.4", "14.2", "15.1"] },
    { "id": 10, "tasks": ["14.3", "14.4", "14.5", "15.2", "16.1"] },
    { "id": 11, "tasks": ["16.2", "17.1"] },
    { "id": 12, "tasks": ["18"] }
  ]
}
```
