# golem-ears audit (independent review, Nov 19 2026)

**Verdict: FIX, not rebuild.**

The pipeline structure is good, the types are strict, the always-window monitor is correct and allocation-free, and all 318 tests pass. But a probe with a realistic G1 lexicon found integration bugs that the tests miss. The cause: the generators never produce realistic lexicons or Kiro-style lines.

## Defects, ranked
1. **The push direction never reaches the sim.** `perturbationCall` matches a Dimension only by its name. The `{direction}` slot's dim is called `push.angle`, so the angle is dropped from the params. compile.test.ts:58 hides this with `toMatchObject`.
   - **Fix:** the compiler builds the Dimensions itself from the parsed ranges (`rangeToDimension`, which is unused today), with the template giving the name and severity for each slot.
2. **Every real Kiro criterion is rejected.** Kiro ends criteria with a period, and the tokenizer treats it as illegal. Backticks and `**bold**` also fail. Only 1 of 7 valid criteria in a sample requirements.md compiled.
   - **Fix:** the extractor strips one trailing period and inline markdown, and keeps the column map.
3. **"150 to 250 N" is stored as text "150150 to 250 N"** (ranges.ts buildText, when the unit is borrowed).
4. **"within 6 s" passes a robot that fell.** The eventually-wrapper takes max over the window, so being upright at the trigger instant counts as a pass. `worstAt` for eventually reports the best time.
   - **Fix:** compile "within T" as "reach the predicate by T and hold it to the end of the window" (F then G). Report the time of the last violation.
5. **WHILE silently drops the "for T" window.**
6. **A typo in a WHERE feature silently passes** (+Infinity, no diagnostic). Infinity and NaN both serialise as null.
   - **Fix:** add `Lexicon.features` and give UNKNOWN_PHRASE with a suggestion; serialise the values distinctly.
7. **WHILE accepts only predicates.** "WHILE walking on a slope of up to 10 deg …" fails with a misleading error.
   - **Fix:** allow a perturbation phrase as a WHILE state (active for the whole episode).
8. **"WHEN x THEN the robot SHALL" gives a misleading error.**
   - **Fix:** accept it, or report "drop THEN".
9. **Suggestions repeat the template the user already wrote.**
   - **Fix:** name the failing slot and its accepted forms.
   - Also, `{phase}` can't take a fixed value, so a shrunk counterexample ("62% into the stride") can't be pinned back as a requirement.
10. **`dims()` receives "any direction" as a raw string.** Lexicon authors must re-derive the radians.
11. **Horizon:** a ubiquitous "for 3 s" line still gets the 10 s horizon. The event horizon ignores the trigger offset from the push phase.
12. **Messages echo "THE" when the user wrote "the".**
13. **Multi-word robot names** ("THE Unitree G1") fail.
14. **Minor:** an unused object in `reorder`, an unreachable branch in units, the number regex copied three times, no check of signal length against t, a shared scratch object passed to user `margin` functions, and a BOM in editDistance.ts.

## Test quality
- No skips or weakened asserts. But partial `toMatchObject` checks hide defects 1 and 3.
- `units.roundtrip` is weak: it uses the same table on both sides.
- The edit-distance and determinism properties are near-tautological.
- No end-to-end compile→monitor property with a realistic lexicon.

## Improvements for expert judges
1. Print the compiled STL formula next to each result, e.g. `G[t₀,t₀+3s](pelvis_z − 0.5 m > 0)`. Support F-then-G for recovery.
2. A streaming monitor with early falsification, plus a per-sample margin series for plots.
3. A Kiro-compatibility golden corpus: snapshot tests over every spec file in the repo and real Kiro output styles.
4. Code-frame diagnostics with a caret, and suggestions as concrete text edits that hooks can apply.
5. A lexicon linter: ambiguous overlapping templates, and checks of margin sign and units on sampled signals.
6. Metamorphic properties ("200 N" ≡ "0.2 kN"; case and comma variants).
7. A mutation-testing score.

Probe scripts: reviews/ears-probe.ts and ears-probe2.ts. Run them with `npx tsx` from skeleton/.
