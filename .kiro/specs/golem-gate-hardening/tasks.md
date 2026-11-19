# Implementation Plan: golem-gate-hardening

Rules for every task:
- Write the regression test first, run it on the unfixed code, record the failure count in the commit message, then fix.
- Never weaken an assertion to make a test pass. Where an old test encoded a defect or a superseded behaviour, replace it and say why in the commit message.
- Every fix adds a property test (fast-check, at least 100 runs, fixed seed logged on failure) next to its examples. Gate runs use the Tiny app (`test/support/harness.ts`), no MuJoCo, budgets of at most 24 trials.
- Keep the gate fail-closed: when the kit cannot tell what a mark means, the line is `Expected_Hold` or the gate does not run.
- After every task: `npm run typecheck` and `npx vitest run src/cli test` in `skeleton/` pass. Tasks that touch `kiro-pack/` or an agent also run `npm run pack:build` and every `kiro-cli agent validate --path`.
- Commit after each task as `golem-gate-hardening: <n> <what>`, staging only `skeleton/`, `apps/`, `docs/reviews/` and `.kiro/`.

## Tasks

- [x] 1. Spec, baseline and contract additions
  - Write `bugfix.md`, `design.md`, `tasks.md`; record the contract additions in `.kiro/steering/interfaces.md`.
  - Save the output of probes 1 to 6 and `mutate.mjs` on the unfixed code in `docs/reviews/gate-hardening-runs/before-*.txt`.
  - _Bugfix: introduction_

- [ ] 2. Read the table once, from the compiled text (defect 9)
  - `compileAll` returns `texts`; `readExpectations(texts, files)` builds the table; `runGateOnce` builds it before any trial and returns it in `ran`; `gate` and `gate --kiro` stop calling `loadExpectations`. `loadExpectations` ignores only `ENOENT`.
  - Test: a file rewritten while the pool runs (the test pool edits the file on its first trial) gives marks of the version that was compiled; an `EACCES` read error is not swallowed.
  - [ ] 2.1 Property test: for any table text and requirement text, `readExpectations` on `compileAll`'s texts equals `parseExpectations` of the same strings (the table never comes from a different read).
  - _Bugfix: 9.1 to 9.4_

- [ ] 3. Structured table issues and reconciliation (defect 1, core)
  - `ExpectationRow`, `TableIssue`, `rows`, `issues`, `tables` on `ParsedExpectations`; `parseExpectations(text, file?)`; `reconcileExpectations`, `nearestId`; remove the dead `Judged.explicit` or read it for the unmarked list.
  - Tests: orphan with and without a suggestion (`R1.2`, `1.20`, `1.2.`, `Req 1.3`, `1.4 and 1.5`), unmarked warning only when a table exists, ids from the extractor (a line that does not compile has no orphan row).
  - [ ] 3.1 Property test (T.3.5, pure part): adding a row for an id that is not in `ids` always adds exactly one error and never changes `byId` for the other ids; a row for an id in `ids` adds none.
  - [ ] 3.2 Property test: `nearestId(x, ids)` is `undefined` or an element of `ids`, and `nearestId(id, ids) === id` for every id.
  - _Bugfix: 1.4, 1.5, 1.7, 1.9, 1.10_

- [ ] 4. Table errors stop the gate and reach the agent (defects 1 and 2)
  - `runGateOnce` returns `table-error`; `gate` exits 1 and prints the issues; `gate --kiro` blocks with the table block and counts it; the notes block for warnings; `check` prints and counts the issues; `test` warns; MCP `list_requirements` adds `expectationIssues`. Unreadable marks are errors.
  - Tests: every row of the audit's "Stop-hook output" table (typo, orphan, missing row, break held, hold broken, green), M7 and M8 mutants, `check --json`, exit code of `check`, `golem test` exit unchanged.
  - [ ] 4.1 Property test (T.3.5): for random tables over the Tiny app, adding an orphan row never turns exit 2 into 0, always exits 1 with a message that names the id, and runs no trial (`createPool` spy is 0).
  - [ ] 4.2 Property test (T.3.6): `--kiro` stdout is empty or one JSON line with `decision: 'block'`, `reason` of at most 4000 characters, exit 0.
  - _Bugfix: 1.6, 1.8 (check), 2.1 to 2.9_

- [ ] 5. Record the marks and show the moves (defect 3)
  - `ReportVerdict.expectation` and `met`; `meta.expectationChanges`; `KitDeps.readCommitted` with the default `git show HEAD:./<file>`; `markChanges`; changes on stdout, in `--json`, in the Stop reason and in the report; `test` and the MCP run tools write the fields.
  - Tests: no table gives exit 2 and adding one row gives exit 0 plus the change line (probe 2 B5, probe 3 section 3); the report names `Expected_Break` next to `broken`; no `readCommitted` or a throwing one gives no change.
  - [ ] 5.1 Property test: for any two tables over the same ids, the changes listed are exactly the ids whose effective expectation differs, each once, in file order; identical tables give none.
  - [ ] 5.2 Property test (T.3.1): flipping one row between `Expected_Hold` and `Expected_Break` flips `met` of that line and no other line, for a `held` and for a `broken` verdict.
  - _Bugfix: 3.1 to 3.8_

- [ ] 6. The Stop reason offers a remedy the agent may take; override fields (defects 4 and 5)
  - New `Expected_Break` block text; `GateOverride.unmetReqIds`; `brokenReqIds` lists status not `held` plus pseudo ids; the override message carries the miss text.
  - Tests: M9 and M10 mutants die; a stale `Expected_Break` line stays red with and without `--kiro` (4.4); six stops give an override with `unmetReqIds: ['1.2']`, `brokenReqIds: []`.
  - [ ] 6.1 Property test: for any set of verdicts and marks, `unmetReqIds` is exactly the ids with `met === false`, `brokenReqIds` is a subset of it, and a `held` verdict is never in `brokenReqIds`.
  - _Bugfix: 4.1 to 4.5, 5.1, 5.3, 5.4, 5.7_

- [ ] 7. Re-run a held `Expected_Break` line at 4 times the budget (defect 8)
  - `budgetKind: 'gate-retry'`; `runGateOnce` retries; the message states the deciding budget.
  - Tests: a line that holds at 24 trials and breaks at 96 turns green and pins its seed; a line that holds at 96 stays red and says 96; lines without the mark run once (spy counts trials).
  - [ ] 7.1 Property test: over random marks and statuses, the retry set is exactly the lines marked `Expected_Break` whose first verdict is `held`, and the verdicts of every other line are unchanged.
  - _Bugfix: 8.1 to 8.5_

- [ ] 8. Markdown structure: fences, indentation, header aliases (defect 6)
  - Fenced and indented code skipped; aliases `Criterion`, `Criteria`, `ID`, `#`; `Expect*` column; the two warnings.
  - Tests: probe 1 and probe 6 cases, nested fence lengths, `~~~`, an unclosed fence, a tab-indented table.
  - [ ] 8.1 Property test (T.3.7): wrapping a valid table in a fence, or indenting each line 4 spaces, gives no rows and no error; the same table unwrapped gives the same rows as before.
  - [ ] 8.2 Property test: for any header spelling from the alias set in any case, the rows are read; for any header with an `Expect*` cell and no id cell, one warning and no rows.
  - _Bugfix: 6.1 to 6.6_

- [ ] 9. Conflicting duplicates fail closed (defect 7)
  - Conflict is an error naming both lines; `byId` holds `Expected_Hold`; equal duplicates warn; unreadable plus valid is an error and `Expected_Hold`; the same across files. Replace the "merges files, first file wins" test and say why.
  - [ ] 9.1 Property test (T.3.8): two rows of one id with different readable marks give `Expected_Hold` in both orders and in both file orders, and exactly one error.
  - [ ] 9.2 Property test: with no conflicts and no unreadable rows, `byId` holds the single mark of each id (round trip of generated tables, canonical and varied spelling).
  - _Bugfix: 7.1 to 7.5_

- [ ] 10. Row parsing details and JSON (defect 10)
  - `\|`, quote prefix, pipe-less tables, lone CR, a header inside a table; `gate --json` and `test --json` verdicts carry `expectation` and `met`.
  - Tests: probe 1 cases; existing JSON assertions stay and the new fields are added.
  - [ ] 10.1 Property test (T.3.3): LF, CRLF or CR, header case, bold and backticks, extra columns, any column order, a quote prefix and an escaped pipe in the topic give an equal `byId`.
  - [ ] 10.2 Property test (T.3.4): permuting rows with distinct ids gives an equal `byId`.
  - _Bugfix: 10.1 to 10.8_

- [ ] 11. Hygiene, committed-spec corpus and the remaining examples (defect 11, T.1, T.4)
  - Split `}  } else if`; `hygiene.test.ts`; `real-specs.test.ts` over the stagger and candy files; fill any T.1 example not yet written.
  - [ ] 11.1 Property test (T.3.2): adding `Expected_Hold` rows for every id changes neither the exit code nor the verdict list.
  - _Bugfix: 11.1, 11.3, 11.4, T.1, T.4_

- [ ] 12. Spec text, kit steering, reinstall the pack (defects 3 and 5)
  - golem-kit: Requirement 7A, corrected 7.3, 7.4, 7.6, 8.2, 8.20, 8.21 and glossary, design section. stagger-app 17.8. `golem-ears.md`: Expectation table section, "never change a mark to turn the gate green", "a Break mark needs a pinned seed", the gate sentence.
  - `npm run pack:build`, `kiro-cli agent validate --path` on every agent, `golem init --force` into `apps/stagger` and `apps/candy`.
  - _Bugfix: 1.8, 3.3, 5.5, 5.6, 8.4_

- [ ] 13. Final checkpoint
  - Full `skeleton` suite, typecheck, `pack:build`, agent validation; probes 1 to 6 after the fixes in `docs/reviews/gate-hardening-runs/after-*.txt`; the mutants re-run (`mutate-after.mjs`); the section "After golem-gate-hardening" in `docs/reviews/gate-audit.md` with a before/after row per defect.
  - _Bugfix: T.5, T.6_
