# Bugfix Requirements Document: golem-gate-hardening

## Introduction

An independent review of the Expectation-aware gate (`docs/reviews/gate-audit.md`, probes `docs/reviews/gate-audit-probes/p1` to `p6` and `mutate.mjs`) found eleven defects in `skeleton/src/cli` (`expectation.ts`, `service.ts`, `format.ts`, `commands/gate.ts`, `commands/gate-kiro.ts`, `commands/check.ts`, `commands/test.ts`) and in the specs that describe it. The core is fail-closed: a missing row, a typo or a bad header all fall back to `Expected_Hold`, so a mistake turns the gate red. The defects are at the edges. The parser drops mistakes without a word, its complaints never reach the agent the Stop hook steers, one table row turns a red gate green with no trace, a table inside a code fence counts as data, and no spec describes the feature. This spec fixes defects 1 to 11 in the audit's order and adds the test-quality items the audit asks for (T1 to T6).

Terms:
- **Table**: a Markdown table whose header has an id column (`Criterion`, `Criteria`, `ID` or `#`) and an expectation column (a header cell starting with `Expect`). **Row**: one body line of a Table. **Mark**: the value of a row, `Expected_Hold` or `Expected_Break`.
- **Criterion id**: the id the EARS extractor gives a numbered criterion, such as `1.2` (`### Requirement 1`, item 2).
- **Orphan row**: a row whose id is not the id of any criterion in the Requirements_Files. **Unmarked line**: a criterion with no row, while at least one Table exists.
- **Table issue**: one problem found in the tables, with a severity (`error` or `warning`), the file, the line and a sentence. An orphan row, an unreadable mark, a conflicting duplicate and a header-less id column are table issues.
- **Table error**: a table issue with severity `error`. It makes the gate unable to run, the same way a compile error does.
- **Mark change**: a requirement whose effective expectation (a row, or `Expected_Hold` when it has none) in the working tree differs from the one in `HEAD`.
- **Stop reason**: the `reason` string of the JSON line that `golem gate --kiro` prints when it blocks.
- **Probe n**: `docs/reviews/gate-audit-probes/p<n>-*.mts`; **Mutants**: `mutate.mjs`.

Superseded text (corrected in place by task 12): golem-kit 3.x (`check` reads only EARS lines), 7.3, 7.4, 7.6, 8.2, 8.20, 8.21 and the Red_Gate and Gate_Override glossary entries; stagger-app 17.8 ("in a Glossary table or an Introduction paragraph"). Every other criterion of those specs still holds.

## Defect 1: a row for an id that does not exist, or a line with no row, is silent (HIGH)

### Current Behavior
1.1 WHEN the Table has a row for an id that no criterion has (`R1.2`, `1.20`, `1.2.`, `Req 1.3`, `1.4 and 1.5`) THEN the row is accepted as a key of `byId`, matches nothing, and `golem gate` exits 2 with the ordinary counterexample block and no hint that a mark was seen and discarded (probe 2 B1, B2, C5; probe 1).
1.2 WHEN a Table exists and a criterion has no row THEN the line is `Expected_Hold` with no message at all (probe 2 A4), and `Judged.explicit` is computed and read by nothing.
1.3 `golem check` never reads the Table, and `golem-ears.md` does not mention it.

### Expected Behavior
1.4 THE kit SHALL compare the rows with the criterion ids of the Requirements_Files (`reconcileExpectations(parsed, ids)`) and report every orphan row as a table error: `<file>:<line>: error: the table marks <id>, but no requirement has that id`, with `did you mean <id>?` when an id of the requirements equals the written id after removing a leading `R`/`Req`/`Requirement` word and a trailing period, or is the one id within edit distance 2 (and within half the written length) of it; when two ids are equally near, there is no suggestion.
1.5 WHEN at least one Table exists THEN each unmarked line SHALL be reported as a warning: `<id> has no row in the Expectation table, so it is Expected_Hold`.
1.6 `golem check` SHALL print the table issues next to the Diagnostics (same `file:line:col: severity: message` form, column 1) and count table errors as errors, so that it exits 1 and `--json` reports `ok: false` for them. WHEN a file argument is given THEN check SHALL report only the parse-level issues of that file, not orphans or unmarked lines.
1.7 THE ids used for the comparison SHALL come from the extractor (`extractCriteria`), not from the compiled requirements, so a line that fails to compile does not make its row an orphan.
1.8 `golem-ears.md` SHALL describe the table: where it goes, the exact ids, one row per line, that an unknown id is an error, and that a missing row means `Expected_Hold`.

### Unchanged Behavior
1.9 A file without a Table SHALL CONTINUE TO give no table message of any kind, `Expected_Hold` for every line and the plain gate output.
1.10 A row for a criterion SHALL CONTINUE TO set that line's expectation; `byId`, `problems` and `mergeExpectations` SHALL CONTINUE TO exist with their current meaning.

## Defect 2: every table complaint goes to stderr, and the Stop hook exits 0 (HIGH)

### Current Behavior
2.1 WHEN the Table has a problem and the gate runs with `--kiro` THEN `gate-kiro.ts` writes the problem with `errLine` and the Stop reason holds nothing about it, so the agent cannot tell (probe 2 C3: 206 characters of ordinary counterexample, the typo on stderr only). Under plain `golem gate` it is a stderr warning, exit code unchanged (M7 and M8 survive).
2.2 WHEN a mark is not `Expected_Hold` or `Expected_Break` THEN it is guessed as `Expected_Hold` ("treated as Expected_Hold"), against the steering rule "Never guess".

### Expected Behavior
2.3 AN unreadable mark, an orphan row and a conflicting duplicate (defect 7) SHALL be table errors. WHEN the gate finds one after compiling THEN it SHALL run no trial.
2.4 Without `--kiro`, `golem gate` SHALL print each table issue to stderr as `golem gate: <error|warning>: <file>:<line>: <message>`, then, for a table error, `golem gate: the Expectation table has <n> error(s); run npx golem-spec check` and exit 1 (the code of a compile error).
2.5 WITH `--kiro`, a table error SHALL be a Red_Gate that the Gate_Counter counts, and while it allows no stop THE CLI SHALL print a Stop reason that begins with the block `The Expectation table has <n> error(s), so the gate cannot run. Fix the rows named here (a wrong id or a misspelt mark). If you may not edit requirements.md, tell the user. Do not change a mark to make the gate pass.` followed by one indented line per table issue.
2.6 WHEN the gate is red for another reason and the table has warnings THEN the Stop reason SHALL end with a block `Expectation table notes:` that lists them, after the counterexample blocks, so that the 4000-character cut removes notes before counterexamples.
2.7 THE issues SHALL still go to stderr under `--kiro` (the log), and a Gate_Override written after the fifth block SHALL carry the id `expectations` in `unmetReqIds`.
2.8 `golem test` SHALL print every table issue (errors too) as a stderr warning, because `test` is not a gate and its exit code SHALL NOT change. The MCP `list_requirements` tool SHALL add `expectationIssues` (an array of `{ severity, file, line, message }`) when there are any.

### Unchanged Behavior
2.9 A usage or Config_File error SHALL CONTINUE TO exit 1 with 0 bytes on stdout; a compile error SHALL CONTINUE TO come before a table error; the 5-block limit, the 2 s dedupe and the state file SHALL CONTINUE TO behave as in golem-kit 8.

## Defect 3: one table row turns a red gate green, and nothing records it (HIGH)

### Current Behavior
3.1 WHEN the same controller runs with no Table (exit 2) and with `| 1.2 | x | Expected_Break |` added (exit 0, `gate GREEN`) THEN nothing shows that a mark moved (probe 2 B5, probe 3 section 3).
3.2 `report.json` carries no expectation: a green gate (`lastGateExitCode: 0`) sits next to `"1.2": "broken"` and a search of the whole report for "expect" finds nothing (probe 3 section 1).
3.3 The guard hook is attached to `golem-tuner` only; any other agent can edit the file.

### Expected Behavior
3.4 EVERY `ReportVerdict` written by `gate`, `test` and the MCP run tools SHALL carry `expectation` (`Expected_Hold` or `Expected_Break`, the default included) and `met` (boolean).
3.5 THE kit SHALL compare the effective expectation of each requirement with the one in the committed version of each Requirements_File (`KitDeps.readCommitted(file)`, which returns the text at `HEAD`, or `undefined` outside a repository, for an untracked file or on any git error) and list each difference as `<id>: <from> -> <to> (uncommitted)`.
3.6 `golem gate` SHALL print the changes on stdout before the result; `--json` SHALL carry them as `expectationChanges: { id, from, to }[]`; the Stop reason SHALL begin with a block `Expectation marks changed since the last commit (a changed mark is a spec change, not a fix):` when the gate blocks; and `report.json` `meta.expectationChanges` SHALL record them. WHEN there is no change THEN no line, field value or block is added (`expectationChanges` is omitted from `meta`, `[]` in `--json`).
3.7 THE gate SHALL stay as strict as before: a changed mark SHALL NOT by itself block or allow a stop. The audit trail is the fix; the kit cannot tell a legitimate edit from gaming.

### Unchanged Behavior
3.8 `lastGateExitCode`, the merge rule of `mergeReport`, `gateOverrides` and the guard hook's decision logic SHALL CONTINUE TO behave as before. `readCommitted` SHALL be optional on `KitDeps`, so a test deps object without it reports no change.

## Defect 4: the Stop reason tells the agent to edit the spec, and the tuner cannot (MEDIUM-HIGH)

### Current Behavior
4.1 WHEN an `Expected_Break` line holds THEN its block ends `look further: npx golem-spec falsify 1.2 --budget 200, or move this line to Expected_Hold if the controller now holds it`. The tuner is denied the write, is blocked five times and ends with a Gate_Override (probe 3 section 2). No test pins the text (M9 survives). It contradicts "Never edit a requirement to make a failing test pass".

### Expected Behavior
4.2 THE block of an `Expected_Break` line that held SHALL read: the EARS line; `expected to break but held within budget <n> trials`; the closest margin with scenario and seed; then `This line held, so the controller is better than the spec expects. Look further with npx golem-spec falsify <id> --budget 200. If it still holds, tell the user to move row <id> of the Expectation table to Expected_Hold. Do not edit requirements.md yourself.`
4.3 THE same text SHALL be used with and without `--kiro` (the tuner reads the plain `golem gate` output too).
4.4 THE gate SHALL stay red for a stale `Expected_Break` mark, with and without `--kiro` (no block-once exception).

### Unchanged Behavior
4.5 The block of an `Expected_Hold` line and of an `error` verdict SHALL CONTINUE TO be the gate block of golem-kit 7.6.

## Defect 5: the Gate_Override and the spec describe the wrong thing (MEDIUM)

### Current Behavior
5.1 `GateOverride.brokenReqIds` and the stderr list include lines whose status is `held` (probe 3 section 2: `brokenReqIds: ["1.2"]` while the verdict of 1.2 is `held`). M10 survives.
5.2 No spec covers the feature. golem-kit 7.3, 7.4, 7.6, 8.2, 8.20 and the Red_Gate entry say a gate is red when a requirement is not `held`, which is false for an `Expected_Break` line. stagger-app 17.8 allows "a Glossary table or an Introduction paragraph" and the parser reads tables only (probe 6: prose and bullets give 0 rows and 0 warnings).

### Expected Behavior
5.3 `GateOverride` SHALL gain `unmetReqIds: string[]`, every id that does not meet its expectation (and `compile`, `config`, `run`, `expectations` for a gate that could not run). `brokenReqIds` SHALL stay, and SHALL list the unmet ids whose verdict is not `held` (a stale `Expected_Break` line is no longer listed as broken) plus the pseudo ids.
5.4 THE stderr message of an allowed red stop SHALL name the expectation text of an `Expected_Break` line (`<ears> (expected to break but held within budget <n> trials)`).
5.5 golem-kit SHALL gain Requirement 7A, "Expectation table", with acceptance criteria for the syntax, the default, duplicates, orphans, unreadable marks, exit codes, the Stop reason and the report fields; 7.3, 7.4, 7.6, 8.2, 8.20, 8.21 and the glossary SHALL be corrected; design.md SHALL describe `expectation.ts`.
5.6 stagger-app 17.8 SHALL say "in the Expectation table of the Requirements_File". The kit SHALL NOT read prose marks.

### Unchanged Behavior
5.7 The `GateOverride` fields `sessionId`, `timestamp`, `count` and `brokenReqIds` SHALL CONTINUE TO exist; the override is written only for an allowed stop at count 5.

## Defect 6: table recognition ignores Markdown structure and is exact on the header (MEDIUM)

### Current Behavior
6.1 A table inside a fenced code block counts as data (probe 2 B3, probe 1): a requirements file that documents the format with an example gets the example's marks applied.
6.2 THE header must contain exactly `Criterion` and `Expectation`; `Criteria`, `Expectations`, `ID`, `Requirement` or `Expected` give 0 rows and 0 warnings (probe 6). A table indented 4 spaces (a code block in Markdown) is read.

### Expected Behavior
6.3 THE parser SHALL skip every line inside a fenced code block (``` or ~~~, opened by a run of at least 3, closed by a run of the same character at least as long, or the end of the file) and every line indented by 4 or more spaces or a tab.
6.4 WHEN a header line (a line with `|` whose cells include one that starts with `Expect`) has no id column THEN the parser SHALL add a warning `the table at line <n> has an Expectation column but no Criterion column; its rows are ignored`. WHEN a table with an id and an expectation header is indented 4 or more spaces THEN it SHALL add the warning `the table at line <n> is indented 4 spaces, which Markdown shows as code; its rows are ignored`.
6.5 THE id column SHALL be matched as `Criterion`, `Criteria`, `ID` or `#`, and the expectation column as any cell starting with `Expect` (`Expectation`, `Expectations`, `Expected`), both case-insensitive.

### Unchanged Behavior
6.6 A table written with the canonical header, in any column order, in any case, with bold or backtick cells, after or before the requirements, with LF or CRLF line ends SHALL CONTINUE TO be read (probe 1, probe 2 A7 to A10).

## Defect 7: conflicting duplicate rows pick a winner by position (MEDIUM)

### Current Behavior
7.1 `Break` first then `Hold` is green, `Hold` first then `Break` is red, with one stderr warning (probe 2 A5, A5b). `1.1 | oops` followed by `1.1 | Expected_Break` takes the second row with no duplicate warning (probe 1). The same holds across files: the first file wins.

### Expected Behavior
7.2 WHEN an id has two rows with different readable marks, in one file or in two, THEN each later row SHALL be a table error (`the table gives 1.2 two marks: Expected_Break at line 5 and Expected_Hold at line 6`), and `byId` SHALL hold `Expected_Hold` for that id, so that any consumer that ignores the error stays fail-closed.
7.3 WHEN an id has two rows with the same mark THEN the later row SHALL be a warning and the mark SHALL be that mark.
7.4 WHEN an id has an unreadable row and any other row THEN `byId` SHALL hold `Expected_Hold` for it; an id with only unreadable rows SHALL be absent from `byId`.

### Unchanged Behavior
7.5 A single row per id SHALL CONTINUE TO set the mark of that id. Superseded test: "merges files, first file wins" (`expectation.test.ts`), which encoded the position rule.

## Defect 8: an Expected_Break line is a claim about the search, and the quick budget can miss (LOW-MEDIUM)

### Current Behavior
8.1 WHEN a line that does break is marked `Expected_Break` and has no pinned seed THEN the 24-trial gate reports it `held` and goes red in 4 of 60 search seeds (up to 160 N), 1 of 60 (up to 175 N, 200 N) (probe 5).

### Expected Behavior
8.2 WHEN a gate run ends with a line marked `Expected_Break` whose verdict is `held`, THEN the gate SHALL run that line once more with 4 times the budget (`4 * flags.budget` or `4 * 24` trials plus its valid pinned seeds, and `4 * flags.time` seconds when a time limit was given), pin a counterexample as every run does, and use the result of the second run as the verdict of the line.
8.3 THE message SHALL state the budget of the run that decided (`held within budget <n> trials`).
8.4 `golem-ears.md` SHALL say that an `Expected_Break` mark needs a pinned seed.

### Unchanged Behavior
8.5 A line without an `Expected_Break` mark, a broken line, an `error` line and every non-gate command SHALL CONTINUE TO run once. The search seed SHALL CONTINUE TO be the same, so the run is deterministic.

## Defect 9: expectations are read a second time, after the run, and every error is swallowed (LOW)

### Current Behavior
9.1 `loadExpectations` reads each file again after the falsification, seconds to minutes later, and ignores any exception (`catch { }`), not only a missing file. The requirements and the table can come from two versions of the file.

### Expected Behavior
9.2 `compileAll` SHALL return the text of each file it read (`CompileOutcome.texts`), and the gate and `check` SHALL parse the table from those texts, once, before any trial.
9.3 `loadExpectations` (used by `test` and MCP) SHALL ignore only a missing file (`ENOENT`) and rethrow any other error.

### Unchanged Behavior
9.4 `compileAll` SHALL CONTINUE TO throw `MissingFileError` for an absent file and to return `requirements`, `diagnostics` and `files` as before.

## Defect 10: row parsing details (LOW)

### Current Behavior
10.1 A cell with an escaped pipe (`A \| B`) is split, which shifts the Expectation column (probe 1).
10.2 A table in a blockquote (`> | ... |`), a table without leading pipes, and a file with lone CR line ends give 0 rows and 0 warnings. Adjacent tables with no blank line read the second header as a row and warn about "Criterion" (probe 1).
10.3 `gate --json` puts `expectation` in `expectations[]` but not in `verdicts[]`; `test --json` adds it to a verdict only when a row exists.

### Expected Behavior
10.4 `\|` SHALL be one literal `|` inside a cell (GitHub's rule: a pipe inside backticks still splits, unless escaped).
10.5 THE parser SHALL read a table behind `>` quote markers and a table whose lines have no leading or trailing pipe (a line with an unescaped `|`), and SHALL split lines on `\r\n`, `\r` and `\n`.
10.6 A header line met inside a table SHALL start a new table instead of being read as a row.
10.7 `gate --json` and `test --json` SHALL give every verdict `expectation` and `met` (the default `Expected_Hold` included). Existing fields SHALL stay.

### Unchanged Behavior
10.8 A table that ends at the first line without a `|` SHALL CONTINUE TO end there (M5), and rows with an empty id SHALL CONTINUE TO be skipped.

## Defect 11: hygiene (LOW)

### Current Behavior
11.1 `gate-kiro.ts:55` has `}  } else if` on one line (two closing braces, wrong indent). It parses, and nothing in CI would catch it.
11.2 `gateGroups` prints each unmet line twice in a failing run (the `FAIL` row, then the full block).

### Expected Behavior
11.3 THE line SHALL be split, and a hygiene test SHALL fail on a source line in `skeleton/src/cli` that has a `}` followed by two or more spaces and more code.

### Unchanged Behavior
11.4 The double print (11.2) SHALL stay: the group lists every line, the block gives the detail, and the audit calls it readable. Not fixed on purpose.

## Item T: test quality

T.1 `expectation.test.ts` SHALL gain examples for: case of header and values, bold and backtick cells, CRLF and lone CR, a table before and after the requirements, an orphan row, a missing row, a fenced table, an indented table, a wrong header, an escaped pipe, a quoted table, adjacent tables, duplicates (conflicting, equal, invalid then valid), and an `Expected_Hold`-only table.
T.2 Command-level tests SHALL pin: the table issues shown by `gate`, `gate --kiro` (stderr and Stop reason), `check` and `test`; the Stop reason of every row of the audit's "Stop-hook output the agent sees" table; `brokenReqIds`, `unmetReqIds` and the override text; the changed-mark line, field and block.
T.3 Properties (fast-check, Tiny app where a gate run is needed), each in its own test:
- T.3.1 **Mark flip**: for a line with status `held` or `broken`, flipping its row between `Expected_Hold` and `Expected_Break` flips `met`.
- T.3.2 **Explicit Hold equals no row**: adding `Expected_Hold` rows for every id changes neither the exit code nor the verdict list.
- T.3.3 **Spelling invariance**: LF, CRLF or CR, header case, bold and backticks, extra columns and column order give an equal `byId`.
- T.3.4 **Row permutation**: permuting rows with distinct ids gives an equal `byId`.
- T.3.5 **Orphan soundness**: adding a row for an id that is not a criterion never turns exit 2 into 0, always gives a table error, and runs no trial.
- T.3.6 **Stop output shape**: for random tables over the Tiny app, `--kiro` stdout is empty or exactly one JSON line with `decision: 'block'` and a `reason` of at most 4000 characters, and the exit code is 0.
- T.3.7 **Fence and indent**: wrapping any valid table in a code fence, or indenting it 4 spaces, gives no rows and never a table error for its ids.
- T.3.8 **Duplicate fail-closed**: for two rows of one id with different readable marks, `byId` holds `Expected_Hold` in both orders.
T.4 A corpus test SHALL parse the committed requirements files of `apps/stagger` and `apps/candy` and assert every row id is a criterion id and every criterion has a row (probe 4 in CI).
T.5 Mutants M3, M5, M7, M8, M9, M10, M13, M14 and M15 SHALL die against the new tests (re-run of `mutate.mjs` with updated anchors); the control M16 SHALL survive.
T.6 Every fix SHALL ship with a regression test that failed on the code before the fix (the commit message records the failing count).
