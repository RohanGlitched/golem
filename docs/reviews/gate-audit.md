# Expectation-aware gate audit (independent review, 2026-11-20)

**Verdict: FIX.** The core is small, correct and fail-closed by default. A missing row, a typo or a bad header all fall back to `Expected_Hold`, so a mistake turns the gate red rather than green. I found no input that makes a *wrong parse* turn the gate green, except a table inside a fenced code block (defect 6) and a conflicting duplicate row (defect 7). The defects are at the edges. The parser drops mistakes silently, the table's complaints never reach the agent that the Stop hook is steering, the table is a one-line way to turn a red gate green with no trace, and the feature has no spec text. None of them needs a rewrite.

Scope: `skeleton/src/cli/commands/gate.ts`, `commands/gate-kiro.ts`, `expectation.ts`, `exit.ts` (`gateExitCode`), `service.ts:85-91` (`loadExpectations`), `format.ts:119-148` (`expectationBlock`, `gateGroups`), and the tests in `__tests__/expectation.test.ts`. No source or test file was changed. Everything I ran is in `docs/reviews/gate-audit-probes/`.

The module's own tests pass (66 of 66 across `expectation`, `gate-kiro` and `commands`).

## What I ran

| Probe | Run from `skeleton/` | What it shows |
|---|---|---|
| `p1-parser.mts` | `npx tsx ../docs/reviews/gate-audit-probes/p1-parser.mts` | `parseExpectations` on 35 awkward inputs |
| `p2-gate.mts` | `npx tsx ../docs/reviews/gate-audit-probes/p2-gate.mts [A1\|B3\|C1...]` | `golem gate`, `--json` and `--kiro` end to end over the Tiny app (1.1 holds, 1.2 breaks at 200 N, 1.3 holds) |
| `p3-report-override.mts` | same pattern | what `report.json` and `gateOverrides` record |
| `p4-real-specs.mts` | same pattern | table ids against the criterion ids of the committed stagger and candy files |
| `p5-flaky-break.mts` | same pattern | how often a true `Expected_Break` line goes red with no pinned seed |
| `p6-header-and-prose.mts` | same pattern | table shapes and prose marks the parser ignores |
| `mutate.mjs` | `node docs/reviews/gate-audit-probes/mutate.mjs` (repo root) | 17 hand-made mutants applied to a scratch copy, run against the gate tests |

## Results for the cases you listed

| Case | Result | Verdict |
|---|---|---|
| Unknown value (`Expected_Brek`, `Expected_Break (known gap)`, `Expected_Break.`, empty cell) | Row dropped, line becomes `Expected_Hold`, one warning on **stderr only** (`p2` A3, C3) | Defect 2 |
| Missing row, table present | Line is `Expected_Hold`, **no message at all** (`p2` A4) | Defect 1 |
| Duplicated row | First row wins; warning on stderr only. Break-then-Hold is green, Hold-then-Break is red (`p2` A5, A5b) | Defect 7 |
| `Expected_Break` line that holds | Red, exit 2, correct text. In `--kiro` the reason tells the agent to edit the spec (`p2` A6, C1) | Defect 4 |
| Mixed case (`EXPECTED_BREAK`, `expected break`, `ExpectedBreak`, `expected-hold`; header `CRITERION`) | All accepted (`p1`, `p2` A7) | Works; accepts more than the docs say |
| Table after the requirements | Read correctly (`p2` A8, A10) | Works |
| CRLF (whole file, table before or after) | Read correctly (`p2` A9, A10) | Works. A lone `\r` file reads as no table |
| No table at all | Everything `Expected_Hold`, plain output, no mention of `Expected_` (`p2` A1) | Works, documented |

## Defects, ranked

### 1. HIGH: a row for an id that does not exist, or a line with no row, is silent
`expectation.ts:27-57` never compares the table with the compiled requirements, and `judgeOutcomes` (`expectation.ts:100-110`) computes `explicit` and then nothing reads it (dead field, `expectation.ts:93`).

Repro (`p2` B1, B2, C5): put `| R1.2 | x | Expected_Break |` or `| 1.20 | x | Expected_Break |` in the table. `golem gate` exits 2 with the ordinary "counterexample found" block and no hint that a mark was seen and discarded. Ids written `R1.2`, `1.2.`, `Req 1.3` or `1.4 and 1.5` are all accepted by the parser as ids and match nothing (`p1`). `golem check` never reads the table (`grep loadExpectations` finds `gate`, `test` and the MCP `list` tool only), and the kit's steering for `requirements.md` (`kiro-pack/steering/golem-ears.md`) does not mention it.

Consequence: the author marks 1.2 as a known break, the line breaks, the gate says "fix the controller", and the agent tries to fix something the spec says is unfixable.

Fix:
- Add `reconcile(parsed, requirements)` that returns `orphanRows` (a row id with no requirement; suggest the nearest id) and `unmarkedLines` (a requirement with no row, when a table exists).
- Print both in `gate`, `gate --kiro` (inside `reason`, see defect 2) and `golem check`.
- Make an orphan row an error (exit 1 for `gate`, a Red_Gate with the message for `--kiro`), the same way an uncompilable line is. Make an unmarked line a warning, since it still defaults to `Expected_Hold`.
- Use `Judged.explicit` for the second list, or delete it.
- Add a short "Expectation table" section to `golem-ears.md` so agents write the table correctly.

### 2. HIGH: every table complaint goes to stderr, and the Stop hook exits 0
`gate-kiro.ts:45-46` writes `problems` with `errLine`. Under `--kiro` the kit's own protocol (golem-kit requirements 8.4 and 8.22) makes stdout JSON the only thing the agent is guaranteed to see; stderr on exit 0 is not part of the agent's input. Repro (`p2` C3): `Expected_Brek` on 1.2 gives a `reason` of 206 characters with the usual counterexample block and nothing about the typo. The warning is on stderr only.

An unknown value is also *guessed* as `Expected_Hold` (`expectation.ts:49`, "treated as Expected_Hold"). `ears-for-robots.md` says "Never guess" for exactly this kind of input.

Fix:
- Pass `expectations.problems` into `buildReason` as a first block ("The Expectation table has 1 problem: ...").
- Treat an unreadable value as an error like an unreadable EARS line: `gate` exits 1, `--kiro` blocks with the diagnostic and counts toward the 5-block limit.

### 3. HIGH: one table row turns a red gate green, and nothing records it
Repro (`p2` B5, `p3` section 3): same controller, same code. No table gives exit 2. Adding `| 1.2 | x | Expected_Break |` gives exit 0 and `gate GREEN`.

This is the "edit the requirement to make the test pass" move that `ears-for-robots.md` forbids, and it is now one cell. What stops it:
- The guard hook (`kiro-pack/hooks/golem-guard-requirements.mjs`) is attached to `golem-tuner` only (kiro-pack README). Any other agent, or the user's default agent, can edit the file.
- `report.json` carries no expectation. `p3` section 1: a green gate (`lastGateExitCode: 0`) sits next to `"1.2": "broken"` and a regexp for "expect" over the whole report finds nothing. Anyone reading the report afterwards (site, evidence scripts, a reviewer) cannot tell why exit 0 and a broken line coexist, or that a mark moved.
- Nothing compares the table with the committed one.

Fix:
- Write `expectation` and `met` into each `ReportVerdict` (`types.ts`, `toReportVerdicts` in `service.ts`), plus a table digest in `meta`. Both are additive.
- In `gate`, when the working tree is a git repo and the file differs from `HEAD`, print the changed marks: `1.2: Expected_Hold -> Expected_Break (uncommitted)`. Put the same line in the Stop `reason`. A mark change then shows up in front of whoever reads the gate output.
- Extend the guard to every agent that has the Stop hook, or at least to the `Expectation` table rows.

### 4. MEDIUM-HIGH: the Stop reason tells the agent to edit the spec, and the tuner cannot
`format.ts:128`: `look further: npx golem-spec falsify 1.2 --budget 200, or move this line to Expected_Hold if the controller now holds it`. The mutation run shows no test pins this text (M9 survived).

Repro (`p2` C1, `p3` section 2): a controller that holds an `Expected_Break` line blocks the agent. The agent is told to edit `requirements.md`. The guard denies the write for `golem-tuner`. The agent is blocked five times, the sixth stop is allowed, and a Gate_Override is written (`p3` shows stops 1 to 5 blocked, stop 6 allowed). Nothing the agent can legitimately do clears the block.

This also contradicts the steering "Never edit a requirement to make a failing test pass".

Fix: for `--kiro`, replace the advice with "This line held, so the controller is better than the spec expects. Tell the user to move row 1.2 to Expected_Hold; do not edit requirements.md." Consider letting a stale `Expected_Break` mark block at most once under `--kiro`. It is a spec-maintenance event, not a controller defect. Keep it red for CI (`golem gate` without `--kiro`).

### 5. MEDIUM: the Gate_Override and the spec describe the wrong thing
- `gate-kiro.ts:54` and `:78-79`: `notHeld` and `GateOverride.brokenReqIds` now include lines whose status is `held` (`p3` section 2: `brokenReqIds: ["1.2"]` while 1.2's verdict is `held`). The field name is a contract (`interfaces.md` and golem-kit requirement 8.21), so rename by adding `unmetReqIds` next to it and keep the old field.
- **No spec covers the feature.** `.kiro/specs/golem-kit/requirements.md` still says: 7.3 "every requirement is `held`", 7.4 "any requirement is `broken` ... exit 2", 7.6 "not `held`", 8.2 and 8.20 "not `held`", and the Red_Gate glossary entry "any requirement has status `broken` or `error`". All are now false for an `Expected_Break` line. `grep Expect` over `golem-kit/` finds only tasks.md prose. `stagger-app` requirement 8 says the marks live "in a Glossary table or an Introduction paragraph"; the parser reads tables only (`p6`: prose and bullet marks give 0 rows, 0 warnings).
- Fix: add a requirement "Requirement 7A: Expectation table" with acceptance criteria for the syntax, default, duplicates, orphans, exit codes, the Stop reason and the report fields, update the Red_Gate definition, and either implement the paragraph form or change the stagger-app wording.

### 6. MEDIUM: table recognition ignores Markdown structure and is exact on the header
- A table inside a fenced code block counts as data (`p2` B3, `p1`). A requirements file that documents the format with an example gets the example's marks applied. The only fail-open route that needs no one to mean it. Fix: track ``` and ~~~ fences and indented code in the loop at `expectation.ts:33-57` and skip them.
- The header must contain exactly `Criterion` and `Expectation` (`expectation.ts:39-40`). `Criteria`, `Expectations`, `ID`, `Requirement` or `Expected` give 0 rows and 0 warnings (`p6`). Fix: when a header has a cell starting with `expect` but no `criterion` cell, warn "table at line N has an Expectation column but no Criterion column"; accept `ID`, `Criteria` and `#` as aliases.

### 7. MEDIUM: conflicting duplicate rows pick a winner by position
`expectation.ts:52-53`. Break-first is green, Hold-first is red (`p2` A5 and A5b), with one stderr warning. Also, `1.1 | oops` followed by `1.1 | Expected_Break` takes the second row with no duplicate warning (`p1`). Fix: a duplicate with *different* values is an error (same channel as defect 2). If you want a quiet rule, `Expected_Hold` wins, which keeps the gate fail-closed.

### 8. LOW-MEDIUM: an `Expected_Break` line is a claim about the search, and the quick budget can miss
`p5`, 60 search seeds, no pinned seed, tiny controller that breaks above about 149 N:

| Line range | Gate red although the line breaks |
|---|---|
| up to 160 N | 4 of 60 (6.7%) |
| up to 175 N | 1 of 60 |
| up to 200 N | 1 of 60 |

This repo is protected because the pinned seeds for 1.2, 4.2, 6.2 (stagger) and 1.1, 8.1 (candy) are committed. A new project that adds an `Expected_Break` mark before pinning gets a flaky gate. `evidence/PREREG.md` already records the same effect for 1.3. The message ("held within budget 24 trials") is honest. Fix: when an `Expected_Break` line holds, re-run it once at 4 times the quick budget before declaring it unmet, and say in `golem-ears.md` that a Break mark needs a pinned seed.

### 9. LOW: expectations are read a second time, after the run, and every error is swallowed
`service.ts:85-91` reads each file again after the falsification finished (seconds to minutes later) and ignores any exception (`catch { }`), not only a missing file. The compiled requirements and the table can come from two different versions of the file. Fix: have `compileAll` return the text it read (it already holds it) and parse the table from that.

### 10. LOW: row parsing details
- `cells()` (`expectation.ts:17-22`) splits on every `|`: `A \| B` or `` `a|b` `` in the Topic column shifts the Expectation column; the result is a misleading warning about the value "B" (`p1`).
- A table in a blockquote (`> | ... |`), a pipe-less table, and a lone-CR file give 0 rows and 0 warnings (`p1`).
- Adjacent tables with no blank line read the second header as a row and warn about "Criterion" (`p1`).
- `gate --json` puts `expectation` in `expectations[]` but not in `verdicts[]`, and `test --json` adds it to a verdict only when a row exists (`test.ts:29`). Make both always carry it.

### 11. LOW: hygiene
- `gate-kiro.ts:55` has `}  } else if` on one line (two closing braces, wrong indent). It parses, and nothing in CI would catch it.
- `gateGroups` prints each unmet line twice in a failing run (the `FAIL` row and then the full block). It is readable. Not worth changing.

## Stop-hook output the agent sees (from `p2` C1 to C5)

| Situation | stdout | Agent can tell what is wrong? |
|---|---|---|
| `Expected_Break` line holds | `{"decision":"block","reason":"1.2: <EARS line>\n  expected to break but held within budget 12 trials\n  closest margin: +0.206 m at push.force = 97.6 N (seed ...)\n  look further: ..., or move this line to Expected_Hold if ..."}` (341 characters) | Yes, but the only remedy offered is editing the spec (defect 4) |
| `Expected_Hold` line breaks | The usual block: EARS line, scenario, margin, replay command (206 characters) | Yes |
| Typo `Expected_Brek` on a line that breaks | Same as the row above, nothing about the typo | **No** (defect 2) |
| Orphan id `R1.2` | Same, nothing about the id | **No** (defect 1) |
| `Expected_Break` line breaks, rest hold | empty stdout, stderr `gate GREEN: every requirement meets its expectation (2 Expected_Hold held, 1 Expected_Break broke; 54 trials)` | Stop allowed |

The envelope itself is right: one JSON line, `decision: block`, exit 0, state written first.

## Test quality

I mutated a scratch copy of `skeleton/src` and `skeleton/test` (`mutate.mjs`) and ran the three gate test files against each mutant. The unmutated copy passes; the no-op control mutant survives, as it should.

| Mutant | Result |
|---|---|
| M1 default becomes `Expected_Break` | killed |
| M2 an `error` verdict meets `Expected_Break` | killed |
| M6 duplicate-row warning removed | killed |
| M6b last duplicate wins | killed |
| M11 grouped output never printed | killed |
| M12 merge: last file wins | killed |
| M3 only the canonical spelling accepted (no mixed case) | **survived** |
| M5 a table does not end at the first non-table line | **survived** |
| M7 `gate` prints no table warnings | **survived** |
| M8 `gate --kiro` prints no table warnings | **survived** |
| M9 "move this line to Expected_Hold" removed | **survived** |
| M10 override message drops the expectation text | **survived** |
| M13 separator test loosened | **survived** |
| M14 bold and backtick stripping removed | **survived** |
| M15 header match case-sensitive | **survived** |
| M4 `split('\n')` instead of `split(/\r?\n/)` | survived, but equivalent: `trim()` already removes `\r` |

Six of 15 real mutants die. The tests cover the decision (`meetsExpectation`, default, merge, the first group output). They do not cover the part you asked about, how the table is *read* from real files and what the user is told.

Specific problems:
- **The round-trip property is canonical-only** (`expectation.test.ts:46-60`). It builds rows with the exact template the parser expects, ids `1..9.1..9`, `Expected_Hold` or `Expected_Break` in canonical case, LF. It never generates case, bold, CRLF, whitespace, column order or noise rows, so it cannot fail for the mistakes listed above. It is also not a round trip in the sense of `testing.md` (no `format`).
- **The exit-code property restates the implementation** (`expectation.test.ts:74-82`): its oracle `ok` is `meetsExpectation` written out again. It pins the table of the function and nothing else. It is not wrong, but it cannot catch a wrong *meaning*. It also omits the empty list.
- **No test reads a table from a CRLF file, mixed case, bold cells, a table after the requirements, an orphan row, a missing row, a fenced table, or a wrong header.** The `p1` and `p2` runs above did these by hand.
- **No command-level test checks that table warnings are shown** (M7, M8), or what the Stop reason says about them (defect 2).
- **No test pins `brokenReqIds` or the override text for an `Expected_Break` line** (M10).
- **Nothing parses the committed requirements files.** `p4` does it in one line and finds 11 of 11 rows (stagger) and 8 of 8 (candy) matching compiled ids. That belongs in CI next to the ears Kiro-compatibility corpus.

Properties to add (fast-check, with the Tiny app where a gate run is needed):
1. **Mark flip is an involution on `met`.** For a line with status `held` or `broken`, flipping its row between `Expected_Hold` and `Expected_Break` flips `met`. This does not restate the implementation, and it catches any swap or default error.
2. **Explicit `Expected_Hold` row equals no row.** Adding `Expected_Hold` rows for every id changes neither the exit code nor the verdict list.
3. **Spelling invariance.** For generated tables, LF or CRLF, header case, cell bold and backticks, extra columns and any column order give an equal `byId`.
4. **Row permutation.** Permuting rows with distinct ids gives an equal `byId`.
5. **Orphan soundness (after defect 1 is fixed).** Adding a row for an id that is not compiled never yields exit 0 where exit 2 was returned without it, and always yields a diagnostic.
6. **Stop output shape.** For random tables over the Tiny app, `--kiro` stdout is either empty or exactly one JSON line with `decision: 'block'` and a `reason` of at most 4000 characters, and the exit code is 0.

Test names are good: they state the behaviour (`'uses the first row of an id that appears twice and says so'`).

## What an expert reviewer will notice
- The table is the gate's oracle and it lives in the file the agent edits. Defect 3 is the first thing a skeptical judge will try.
- The `report.json` of a green run contains `broken` verdicts and no reason. A judge who opens the evidence will ask what "green" means.
- The default-to-Hold design deserves credit: no table, a typo and a bad header all fail loud. Say so in the docs, and keep it.
- `golem check` is silent about the table. Checking the table where the lines are checked is the cheapest improvement for the user experience.

## Order of work
1. Defects 1 and 2 together (reconcile, errors, put problems in the Stop `reason`). About 80 lines plus tests.
2. Defect 3 (report fields, uncommitted-mark line) and defect 4 (wording).
3. Defects 6, 7 and 9 (small parser changes), then defect 5 (spec text), then the properties above.
