# Design: golem-gate-hardening

## Overview

All changes stay inside `skeleton/src/cli`, `skeleton/src/mcp/tools/list.ts`, `skeleton/kiro-pack/steering/golem-ears.md` and the specs. The gate keeps its shape: compile, run pinned seeds and the quick budget, judge each verdict against its expectation, count the block, print. Four things change:

1. The table is read once, from the text that was compiled, and checked against the criterion ids before any trial (defects 1, 2, 9).
2. A table error is a gate that cannot run, like a compile error: exit 1, or a counted block whose Stop reason names the problem (defect 2).
3. The report, the override and the output record what the marks were and what changed (defects 3, 5).
4. The parser follows Markdown, and a duplicate or unreadable mark fails closed (defects 6, 7, 10).

Fail-closed rule kept throughout: whenever the kit cannot tell what a mark means, the line is `Expected_Hold` (default, conflict, unreadable) or the gate does not run (table error). Nothing in this spec makes a line less strict.

## Contract additions (add-only)

Recorded in `.kiro/steering/interfaces.md` under "Approved additions":

```ts
// report.json (golem-kit Report_File)
interface ReportVerdict { /* ... */ expectation?: 'Expected_Hold' | 'Expected_Break'; met?: boolean }
interface ReportMeta { /* ... */ expectationChanges?: { id: string; from: Expectation; to: Expectation }[] }
interface GateOverride { /* ... */ unmetReqIds: string[] }      // brokenReqIds stays
// golem-kit
interface KitDeps { /* ... */ readCommitted?(file: string): Promise<string | undefined> }
interface CompileOutcome { /* ... */ texts: Record<string, string> }
```

CLI-level types (`skeleton/src/cli/expectation.ts`, not contract shapes):

```ts
interface ExpectationRow { id: string; expectation: Expectation; file?: string; line: number }
interface TableIssue { severity: 'error' | 'warning'; message: string; file?: string; line: number }
interface ParsedExpectations {
  byId: Map<string, Expectation>;
  rows: ExpectationRow[];            // readable rows, in file order
  issues: TableIssue[];              // parse issues, then reconcile issues
  problems: string[];                // `line <n>: <message>` for every issue (kept for callers that print strings)
  tables: number;                    // tables recognised
}
interface MarkChange { id: string; from: Expectation; to: Expectation }
```

## D9 and D1: one read, then reconcile

`compileAll` already holds each file's text; it returns `texts` (file to text). `readExpectations(texts, files, { reconcile })` is the one entry point the gate and `check` use:

```
parts   = files.map(f => parseExpectations(texts[f], f))
merged  = mergeExpectations(parts)                   // rows concatenated in file order, byId re-derived, cross-file conflicts
ids     = files.flatMap(f => extractCriteria(texts[f]).criteria.map(c => c.id))
result  = reconcile ? reconcileExpectations(merged, ids) : merged
```

`reconcileExpectations` adds to `issues`:
- for each readable row whose id is not in `ids`: an error, with `did you mean <id>?` from `nearestId(id, ids)`: normalise the written id (strip a leading `R`, `Req` or `Requirement` word and a trailing period), return it if it is an id; otherwise the one id at the smallest Levenshtein distance up to 2 and up to half the written length (two ids at the same distance give no suggestion: a hint that is a guess is worse than none);
- when `merged.tables > 0`, for each id with no row and no error row: a warning.

`ids` comes from `extractCriteria`, not from the compiled requirements, so a line that does not compile does not turn its row into an orphan, and `check` can report both kinds of problem in one pass. It is also the only comparison that works in `check` when the compile has errors.

`loadExpectations(app, deps)` (used by `test` and by the MCP tools) reads the files, tolerates `ENOENT` only (D9.3) and calls `readExpectations` with reconcile on. The gate does not call it: `runGateOnce` builds the table from `compiled.texts`.

Why the second read mattered: the table was read after minutes of search, so a file saved during the run gave verdicts for one version of the lines and marks of another. Reading once, before the first trial, makes verdict and mark describe the same text.

## D2: a table error is a gate that cannot run

`runGateOnce` after a clean compile:

```
table   = readExpectations(compiled.texts, files, reconcile)
changes = await markChanges(deps, compiled, table)         // D3
if table.issues has an error: return { kind: 'table-error', issues: table.issues, changes, compiled }
... run, apply pinned rule, retry held Expected_Break lines (D8) ...
return { kind: 'ran', outcomes, expectations: table, changes, ... }
```

Commands:
- `gate` prints issues on stderr, then `the Expectation table has n error(s); run npx golem-spec check`, exits 1. With warnings only, it prints them on stderr and continues.
- `gate --kiro` treats `table-error` as red: blocks (counted) with the reason below, and appends `{ id: 'expectations', ears: 'the Expectation table has n error(s)' }` to the not-met list for the override. Without errors, warnings and changes are added to the reason only when the gate blocks.
- `check` appends the issues to its diagnostics (shape `{ file, line, col: 1, severity, message, suggestion: null }`) and counts the errors.

Reason layout, in this order, joined by one blank line, cut at 4000 characters by the existing `buildReason`:

```
[Expectation marks changed since the last commit ...]     (only when there are changes)
[The Expectation table has n error(s) ...]                (table-error only, then nothing else follows)
[one block per unmet line]                                (ran)
[Expectation table notes: ...]                            (warnings, last: cut first)
```

Why a table error stops the run instead of running and annotating: the counterexample block of a line whose mark is in doubt would be right or wrong depending on the mark, and the agent has one thing to do (fix the table). It also saves the time of a run whose result cannot be used, and it matches how a compile error works, so the Stop hook has one idea ("the spec does not read") for both.

Why the wording tells the agent who may fix it: the tuner cannot edit `requirements.md` (the guard) and a default agent may. "If you may not edit requirements.md, tell the user" is true for both. It also says not to change a mark to get green, which the steering already says for the requirement text.

## D3: record the marks, show the moves

Report: `toReportVerdicts(outcomes, expectations?)` writes `expectation` and `met` per verdict when given the `byId` map (all gate and test runs do; the MCP run tools too). `meta.expectationChanges` is written by the gate when non-empty.

I did not add the table digest the audit proposes. Each verdict now names its own expectation, so the report holds the whole table for the lines it covers, and a digest is not readable by a reviewer; the changes list says what moved.

`markChanges(deps, compiled, table)`: for each file in `files`, `deps.readCommitted?.(file)`. When every call returns `undefined`, there is nothing to compare, and the result is `[]`. Otherwise `committed = readExpectations(committedTexts, files-with-text, reconcile: false)`. For each id in `table.rows` or `committed.rows` (file order, then id order), `from = committed.byId.get(id) ?? Expected_Hold`, `to = table.byId.get(id) ?? Expected_Hold`; a difference is a change. A file with no committed text (new file) contributes no committed rows, so its Break rows show as `Expected_Hold -> Expected_Break (uncommitted)`, which is what happened.

Default `readCommitted` (in `createDefaultDeps`): `git show HEAD:./<basename>` with `cwd` the file's directory, timeout 3 s, `windowsHide`, resolves `undefined` on any error. The existing `gitCommit` shows how.

Guard: I did not extend `golem-guard-requirements.mjs` to other agents. It already denies every write to a `requirements.md` for the one agent that has a Stop hook (`golem-tuner`), table rows included. `golem-scribe` and `golem-skeptic` exist to write and review specs, and a workspace-wide guard would stop spec mode from editing requirements at all. What closes the gap is that a mark move can no longer pass unseen: it is in the output, in the Stop reason, and in the report. Kit steering states the rule for every agent that opens a `requirements.md`.

## D4: one honest remedy

`expectationBlock` for an `Expected_Break` line that held:

```
1.2: <EARS line>
  expected to break but held within budget 96 trials
  closest margin: +0.206 m at push.force = 97.6 N (seed 1234)
  This line held, so the controller is better than the spec expects. Look further with npx golem-spec falsify 1.2 --budget 200. If it still holds, tell the user to move row 1.2 of the Expectation table to Expected_Hold. Do not edit requirements.md yourself.
```

Same text for CI and Stop. The audit also asks to consider letting a stale mark block at most once under `--kiro`. I did not: the instruction for this work is to keep the gate fail-closed, the Gate_Counter is the contract of golem-kit properties 11 to 16, and the new text already gives the agent something legitimate to do (report to the user). After five blocks the stop is allowed and the Gate_Override records it, as for any red gate.

## D5: override fields and spec text

`notHeld` in `gate-kiro.ts` becomes `unmet: { id, ears, status }[]`. `unmetReqIds = unmet.map(id)`, `brokenReqIds = unmet.filter(x => x.status !== 'held').map(id)`, where the pseudo ids (`compile`, `config`, `run`, `expectations`) have status `error`. The stderr message prints `ears` with the miss text for `Expected_Break` lines.

Spec text: golem-kit Requirement 7A; glossary and 7.3, 7.4, 7.6, 8.2, 8.20, 8.21 corrected; the stagger-app wording changed to "table". I did not implement the paragraph form: a sentence such as "1.2 is Expected_Break" is ambiguous (which ids, which words), and a guess would make the gate depend on prose. The table form is the one every committed file uses.

## D6: Markdown structure

`parseExpectations(text, file?)` becomes a line scanner with three states:

```
state: outside | table(idCol, expCol)
fence: null | { char, length }
for each line (split on \r\n|\r|\n):
  strip a quote prefix  ^(\s*>)+\s?  (the quote is part of the table, D10)
  if fence open: closing run of the same char, length >= fence length, nothing else  -> fence = null; continue
  if line starts a fence (up to 3 spaces, then >= 3 backticks or tildes): fence = {...}; state = outside; continue
  indent = leading width (tab = 4)
  if line has no unescaped '|': state = outside; continue
  cells = split on unescaped '|', '\|' -> '|', trim, strip leading/trailing * ` _
  if cells look like a header (id column and Expectation column, D6.5):
      if indent >= 4: warn "indented"; state = outside   else state = table(...)
      continue
  if cells have an Expectation-like cell but no id column: warn once for this line; state = outside; continue
  if state is outside: continue
  if indent >= 4: state = outside; continue
  row handling (separator, empty id, value, duplicate)
```

A header met while inside a table starts a new table (D10.6). A line with no `|` ends the table, as before.

Column matching: id column `^(criterion|criteria|id|#)$`, expectation column `^expect`. If the id column and the expectation column are the same cell index, the line is not a header. Lenient on `Expected` (a header some authors would write) because the same file is a gate oracle and a miss here is silent; strict on the id column because `Requirement` or `Item` would match too many glossary tables.

## D7: conflicts

Rows are collected per id in order. After the scan:

```
for id, rows:
  valid = rows with a readable mark
  if rows.length == 1 and valid.length == 1: byId[id] = mark
  else if valid.length == 0: absent (the unreadable row is already an error)
  else if some row is unreadable: byId[id] = Expected_Hold
  else if all marks equal: byId[id] = mark; each later row: warning
  else: byId[id] = Expected_Hold; each later row: error "gives <id> two marks: <A> at line n and <B> at line m"
```

The issue text names both lines, so the author sees which row to delete. `mergeExpectations` applies the same function to the rows of all files; the first-file-wins rule goes.

## D8: re-run a stale Expected_Break at 4 times the budget

In `runGateOnce`, after the first pass and `applyPinnedRule`:

```
retry = outcomes.filter(o => expectation(o) == Expected_Break && o.verdict.status == 'held')
for each: run runRequirements with { req: id, budgetKind: 'gate-retry', budget: flags.budget, timeS: flags.timeS }
          replace the outcome with the result
```

`toFalsifyOptions` for `gate-retry`: `maxTrials = 4 * (budget ?? 24) + pinnedValid` (pinned seeds are counted inside `maxTrials`, assumption A1), `maxWallMs = 4 * timeS * 1000` when a time limit was given. A held line costs one extra run at 4 times the cost. A counterexample found is pinned by `runRequirements`, so the next gate run re-runs it first and is deterministic, which is the property the audit's probe 5 shows the committed seeds provide. The first pass is not repeated for lines that do not carry the mark.

A bigger change would be to retry every `held` line: no, a held `Expected_Hold` line is what the gate is for, and a larger budget there is `golem test --budget`.

## D10 and D11: parsing details and hygiene

- `cells()` is a small tokenizer: a backslash before `|` yields a literal `|`; a bare `|` splits. GitHub also splits on a pipe inside backticks; so does this parser.
- `test --json` and `gate --json` verdicts: `{ ...verdict, expectation, met }`.
- The split `}  } else if` is fixed, and `test/hygiene` (a test under `skeleton/src/cli/__tests__/hygiene.test.ts`) scans `skeleton/src/cli/**/*.ts` for `}` followed by 2 or more spaces and a non-space on one line.

## Tests

- **Parser examples** (T.1): table-driven, one row per audit probe case.
- **Properties** (T.3.1 to T.3.8): one file each under `skeleton/src/cli/__tests__/`, named `prop-50-...` to `prop-57-...`. The generators share `test/support/table-gen.ts`: ids over a small alphabet (so collisions happen), marks, spelling variants (line ends, header case, bold, backticks, column order, extra columns).
- **Corpus** (T.4): `real-specs.test.ts` reads `apps/stagger/.kiro/specs/g1-walking/requirements.md` and `apps/candy/.kiro/specs/candy-sorter/requirements.md` from the repository.
- **Command tests** (T.2): Tiny app with `createHarness`; `createTestDeps` gains `committed?: Record<string, string>` for `readCommitted`.
- **Mutants** (T.5): `docs/reviews/gate-hardening-runs/mutate-after.mjs`, the audit's script with anchors updated to the new code.

## Error handling

| Situation | Behaviour | Requirement |
|---|---|---|
| Orphan row, unreadable mark, conflicting duplicate | table error: `gate` exit 1, `--kiro` counted block, `check` exit 1, `test` stderr warning | 1.4, 2.3 to 2.8, 7.2 |
| Criterion with no row, table present | warning | 1.5 |
| Table in a fence or indented | not read; indented gets a warning | 6.3, 6.4 |
| `git` missing or not a repository | no mark changes, no message | 3.5 |
| `readCommitted` absent in deps | no mark changes | 3.8 |
| Expectation file unreadable other than ENOENT | `loadExpectations` rethrows | 9.3 |
