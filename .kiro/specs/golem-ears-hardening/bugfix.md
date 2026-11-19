# Bugfix Requirements Document: golem-ears-hardening

## Introduction

An independent review of `skeleton/src/ears` (`docs/reviews/ears-audit.md`, probes `docs/reviews/ears-probe.ts` and `ears-probe2.ts`) found integration defects that the 318 passing tests did not catch. The tests used generated lexicons and lines that never look like a real robot lexicon or like the requirements Kiro writes, and some example tests used partial `toMatchObject` checks that skipped the wrong fields.

This spec fixes defects 1 to 13 and the minor items of 14, and adds four improvements from the audit: the compiled STL formula on every `CompiledRequirement` (I1), a Kiro-compatibility golden corpus (I3), a lexicon linter (I5) and metamorphic properties (I6).

Each defect lists the current behaviour (what the probe showed), the expected behaviour after the fix, and the behaviour that must not change. Every defect gets a regression test that fails on the code before the fix. "The compiler" means `compileRequirement` / `compileRequirementsFile` in `skeleton/src/ears`.

Decisions taken where the audit left a choice:
- Defects 1 and 10: the compiler builds every `Dimension` itself from the parsed ranges. A template declares, per slot, the dimension name and severity (`PerturbationTemplate.slots`). The old `dims()` function stays as a deprecated compatibility path.
- Defect 2: Kiro markup is blanked out with spaces of equal length before tokenizing, so every offset, line and column stays exact without a separate column map. The extractor also recognises a criterion that starts with markup.
- Defect 4: `within T` means "reach the predicate by T and hold it to the end of the window" (F then G). `worstAt` is the time of the last violation.
- Defect 5: a predicate-state WHILE with `for T` means "whenever the state holds, the response holds for the next T" (`G(ψ → G[0,T] φ)`). A predicate-state WHILE with `within T` has no agreed meaning, so it is rejected with a diagnostic.
- Defect 8: `WHEN x THEN THE robot SHALL ...` (and the same for WHILE and WHERE) is accepted; `THEN` is dropped.
- Defect 11: a template may declare `maxOnset` (seconds between the trigger and the latest start of the perturbation, such as one stride period when the push waits for a gait phase). Windows and horizons add it.

## Defect 1: The push direction never reaches the sim

### Current Behavior (Defect)
1.1 WHEN a perturbation template has a `{direction}` slot and its `dims()` names the angle dimension `push.angle` THEN the compiler drops the angle from `PerturbationCall.params`, because it matches a Dimension to a slot only by the slot's name (`direction`), so `apply()` never receives the direction.
1.2 WHEN the same happens to any slot whose dimension name does not end with `.<slot>` THEN the compiler drops that parameter silently, with no diagnostic.

### Expected Behavior (Correct)
1.3 WHEN a template declares `slots: { direction: { dim: 'push.angle', severity: 'none' } }` THEN the compiler SHALL build the Dimension `push.angle` from the parsed direction range and SHALL set `params.direction` to `'push.angle'` when the range is searched, or to the SI angle when it is fixed.
1.4 WHEN a slot bound to a range (`min < max`) has no declared dimension THEN the compiler SHALL emit an error Diagnostic of kind `BAD_LEXICON` that names the slot and the template, and SHALL return no requirement.
1.5 WHEN a template has only the deprecated `dims()` function THEN the compiler SHALL tie each returned Dimension to a slot by exact name, by `.<slot>` suffix, by equal kind and bounds, or by being the only Dimension of the slot's kind, and SHALL put every tied slot into `params`.
1.6 WHEN a deprecated `dims()` returns a searched Dimension that the compiler cannot tie to a slot THEN the compiler SHALL emit a `BAD_LEXICON` warning that names the Dimension.

### Unchanged Behavior (Regression Prevention)
1.7 WHEN a slot holds a fixed value with no declared dimension (such as `for 0.2 s`) THEN the compiler SHALL CONTINUE TO put its SI value into `params` and add no Dimension.
1.8 WHEN two Dimensions of one requirement have the same name THEN the compiler SHALL CONTINUE TO report `BAD_RANGE` at the second one and return no requirement.

## Defect 2: Real Kiro criteria are rejected

### Current Behavior (Defect)
2.1 WHEN a criterion ends with a period, as Kiro writes them THEN the tokenizer reports `Unexpected character '.'` and the criterion does not compile.
2.2 WHEN a criterion contains `**bold**` or `` `code` `` markup THEN the tokenizer reports one error per markup character.
2.3 WHEN a numbered criterion line starts with markup (`1. **WHEN** ...`) THEN the extractor does not recognise it as EARS.

### Expected Behavior (Correct)
2.4 WHEN a line ends with one period, optionally followed by whitespace or closing markup THEN the compiler SHALL ignore that period.
2.5 WHEN a line contains `*`, `` ` `` or a run of `_` at a word boundary THEN the compiler SHALL ignore those characters and SHALL report every Diagnostic at the same line, column and offset as in the line as written.
2.6 WHEN a numbered criterion starts with markup followed by WHEN, WHILE, IF, WHERE or THE THEN the extractor SHALL return it as a criterion.

### Unchanged Behavior (Regression Prevention)
2.7 WHEN a period appears anywhere except at the end of the line, outside a number and a requirement ID THEN the tokenizer SHALL CONTINUE TO report it as an unexpected character.
2.8 WHEN a word contains an underscore inside it (`pelvis_z`) THEN the tokenizer SHALL CONTINUE TO keep it as one word.
2.9 WHEN `tokenize` is called directly THEN it SHALL CONTINUE TO report every non-token character, so the tokenizer coverage property still holds.

## Defect 3: "150 to 250 N" is stored as "150150 to 250 N"

### Current Behavior (Defect)
3.1 WHEN a range's first number borrows the unit of the second (`150 to 250 N`) THEN the range text and both slot Quantities read `150150 to 250 N`.

### Expected Behavior (Correct)
3.2 WHEN a range is written `150 to 250 N` THEN the range text and the `text` of both slot Quantities SHALL be `150 to 250 N`.

### Unchanged Behavior (Regression Prevention)
3.3 WHEN a range is written `150 N to 250 N` or `up to 200 N` THEN the range text SHALL CONTINUE TO be the source text exactly as written.

## Defect 4: "within 6 s" passes a robot that fell

### Current Behavior (Defect)
4.1 WHEN a response ends with `within T` THEN the monitor returns the maximum margin over `[t0, t0+T]`, so a robot that is upright at the trigger instant and then falls passes.
4.2 WHEN the eventually monitor reports `worstAt` THEN it reports the time of the best sample.

### Expected Behavior (Correct)
4.3 WHEN a response ends with `within T` THEN the monitor SHALL compute `F[t0, t0+T] G[·, t_end] φ`: the predicate must become true no later than `t0 + T` and stay true until the last sample of the trace. Its robustness SHALL be the minimum margin over the samples from the last sample at or before `t0 + T` to the last sample.
4.4 WHEN some sample of the window has a margin of 0 or less THEN `worstAt` SHALL be the time of the last such sample; otherwise it SHALL be the time of the smallest margin after the deadline.
4.5 WHEN an event or unwanted requirement uses `within T` THEN its horizon SHALL be `maxOnset + triggerDuration + 2·T`, so at least T of hold follows the deadline. WHEN a ubiquitous, optional or perturbation-state requirement uses `within T` THEN its horizon SHALL be the larger of the episode length and `2·T`.

### Unchanged Behavior (Regression Prevention)
4.6 WHEN a response ends with `for T` or has no wrapper THEN the monitor SHALL CONTINUE TO return the minimum margin over the window and the time of its first minimum.
4.7 WHEN an event requirement's trace has no `trigger` event THEN the monitor SHALL CONTINUE TO return `NaN`, unit `trace`, `worstAt` 0.

## Defect 5: WHILE drops the "for T" window

### Current Behavior (Defect)
5.1 WHEN a predicate-state requirement ends with `for T` THEN the compiler accepts it and the monitor ignores T.

### Expected Behavior (Correct)
5.2 WHEN a predicate-state requirement ends with `for T` THEN the monitor SHALL compute `G(ψ → G[t, t+T] φ)`: at every sample where the state holds, the response must hold over the next T seconds of the trace.
5.3 WHEN a predicate-state requirement ends with `within T` THEN the compiler SHALL emit a `PATTERN_MISMATCH` error at `within` that says a WHILE response takes `for` or no wrapper.

### Unchanged Behavior (Regression Prevention)
5.4 WHEN a predicate-state requirement has no wrapper THEN the monitor SHALL CONTINUE TO return the minimum over samples of `max(−ψ, φ)`.

## Defect 6: A typo in a WHERE feature silently passes

### Current Behavior (Defect)
6.1 WHEN a WHERE feature is misspelt THEN the compiler accepts it, the feature is never enabled, and the monitor returns `+Infinity` with no diagnostic.
6.2 WHEN a result with `NaN` or `±Infinity` robustness is serialised with `JSON.stringify` THEN both become `null`.

### Expected Behavior (Correct)
6.3 WHEN a WHERE feature is not one of `Lexicon.features` (compared after trimming, collapsing spaces and lower-casing) THEN the compiler SHALL emit `UNKNOWN_PHRASE` at the feature clause, with the closest feature as `suggestion` when one is close.
6.4 WHEN a Lexicon declares no features THEN every WHERE line SHALL get `UNKNOWN_PHRASE` that says the Lexicon declares no features.
6.5 THE ears module SHALL export `encodeRobustness`, `decodeRobustness` and `monitorResultToJSON`, which keep `NaN`, `Infinity` and `-Infinity` distinct as the strings `"NaN"`, `"Infinity"` and `"-Infinity"`.

### Unchanged Behavior (Regression Prevention)
6.6 WHEN a declared feature is not enabled in the compile options THEN the monitor SHALL CONTINUE TO return `+Infinity`, `worstAt` 0 and the response unit.

## Defect 7: WHILE accepts only predicates

### Current Behavior (Defect)
7.1 WHEN a WHILE state is a perturbation phrase (`WHILE walking on a slope of up to 10 deg`) THEN the compiler reports `'walking' does not continue any predicate phrase. No close phrase exists.`

### Expected Behavior (Correct)
7.2 WHEN a WHILE state matches exactly one perturbation template and no predicate template THEN the compiler SHALL compile it as a perturbation applied for the whole episode: the trigger's Dimensions and `PerturbationCall` are added, and the response is monitored like a ubiquitous response.
7.3 WHEN a WHILE state matches both a predicate and a perturbation THEN the compiler SHALL report an ambiguous phrase.
7.4 WHEN a WHILE state matches neither THEN the compiler SHALL report the diagnostic of the class that matched further into the clause.

### Unchanged Behavior (Regression Prevention)
7.5 WHEN a WHILE state matches a predicate THEN the compiler SHALL CONTINUE TO compile it as a predicate state.

## Defect 8: "WHEN x THEN the robot SHALL" gives a misleading error

### Current Behavior (Defect)
8.1 WHEN an event line writes `THEN` before `THE <robot> SHALL` THEN the matcher reports `'THEN' does not continue any perturbation phrase`.

### Expected Behavior (Correct)
8.2 WHEN an event, state or optional line has `THEN` (optionally with a comma before or after it) directly before `THE <robot> SHALL` THEN the parser SHALL accept the line and drop `THEN` from the condition.

### Unchanged Behavior (Regression Prevention)
8.3 WHEN an unwanted (IF) line has no THEN THEN the parser SHALL CONTINUE TO report `expected THEN before THE`.
8.4 WHEN `format` prints an event AST THEN it SHALL CONTINUE TO print no THEN.

## Defect 9: Suggestions repeat the template the user already wrote

### Current Behavior (Defect)
9.1 WHEN the clause follows a template but a slot holds a value the slot does not accept (`from the left`) THEN the message is `'the' does not continue any perturbation phrase. Did you mean "<the same template>"?`.
9.2 WHEN a line pins the gait phase (`at 50%`) THEN no template slot accepts it, so a shrunk counterexample ("62% into the stride") cannot be written back as a requirement.

### Expected Behavior (Correct)
9.3 WHEN the furthest failure is inside a slot of the closest template THEN the message SHALL name the slot and its accepted forms, and the `suggestion` SHALL be the clause rewritten with an accepted form in place of the rejected words, which matches that template.
9.4 WHEN a `{phase}` slot follows `at` and the clause gives a percentage (`50%`, `50% of its stride`, `50% into its stride`) from 0 % to 100 % THEN the matcher SHALL bind a fixed phase equal to the ratio; a value outside that interval SHALL give `BAD_RANGE`.

### Unchanged Behavior (Regression Prevention)
9.5 WHEN the furthest failure is at a literal word, or the closest template is not the one that failed furthest THEN the message SHALL CONTINUE TO end with `Did you mean "<closest phrase>"?` and the suggestion SHALL CONTINUE TO be the closest phrase.

## Defect 10: dims() receives "any direction" as a raw string

### Current Behavior (Defect)
10.1 WHEN a template's `dims()` is called THEN `{direction}` and `{phase}` slots arrive as the words written (`'any direction'`), so the lexicon author must re-derive the radians.

### Expected Behavior (Correct)
10.2 WHEN a template declares `slots` THEN the compiler SHALL build the Dimensions itself and SHALL NOT call `dims()`.
10.3 WHEN the deprecated `dims()` is called THEN it SHALL receive, as a second argument, the parsed SI range of every slot (`{ kind, min, max, wrap }`).

### Unchanged Behavior (Regression Prevention)
10.4 WHEN the deprecated `dims()` is called THEN its first argument SHALL CONTINUE TO be the bound slot values as before.

## Defect 11: Horizons ignore the requirement's own window

### Current Behavior (Defect)
11.1 WHEN a ubiquitous line says `for 3 s` THEN the horizon is the 10 s episode.
11.2 WHEN a push waits for a gait phase THEN the event window and horizon still start counting at the trigger, so a push late in the stride gets less than the stated time.

### Expected Behavior (Correct)
11.3 WHEN a ubiquitous, optional or perturbation-state response says `for d` THEN the window SHALL be `[t_first, t_first + maxOnset + d]` and the horizon SHALL be `maxOnset + d`.
11.4 WHEN an event or unwanted response says `for d` THEN the window SHALL be `[t0, t0 + maxOnset + d]` and the horizon SHALL be `maxOnset + triggerDuration + d`.
11.5 WHEN an event or unwanted response says `within T` THEN the deadline SHALL be `t0 + maxOnset + T`.

### Unchanged Behavior (Regression Prevention)
11.6 WHEN no template declares `maxOnset` THEN event windows and horizons SHALL CONTINUE TO be `[t0, t0 + d]` and `d + triggerDuration`.
11.7 WHEN a ubiquitous or predicate-state line has no wrapper THEN the horizon SHALL CONTINUE TO be the episode length.

## Defect 12: Messages echo "THE" when the user wrote "the"

### Current Behavior (Defect)
12.1 WHEN a diagnostic quotes a keyword token from a clause THEN it quotes the upper-cased form (`'THE'`), not the text as written.

### Expected Behavior (Correct)
12.2 WHEN a diagnostic quotes source text THEN it SHALL quote it as written.

### Unchanged Behavior (Regression Prevention)
12.3 WHEN the parser builds an AST THEN keyword tokens SHALL CONTINUE TO be upper-cased in the AST.

## Defect 13: Multi-word robot names fail

### Current Behavior (Defect)
13.1 WHEN a line names a robot with more than one word (`THE Unitree G1 SHALL`) THEN the parser reports `expected SHALL after the robot name but found 'G1'`.

### Expected Behavior (Correct)
13.2 WHEN one or more word tokens stand between THE and SHALL THEN the parser SHALL take them, joined by one space, as the robot name, and SHALL compare it with `robotNames` case-insensitively with spaces collapsed.

### Unchanged Behavior (Regression Prevention)
13.3 WHEN the robot name is unknown THEN the parser SHALL CONTINUE TO report `UNKNOWN_ROBOT` at the name, listing every allowed name.

## Defect 14: Minor items

### Current Behavior (Defect)
14.1 WHEN `parse` returns THEN `reorder` builds an object it never uses.
14.2 WHEN `quantityFromTokens` gets a `unit` token THEN it has an unreachable branch for a unit missing from the table, separate from the identical word branch.
14.3 WHEN the tokenizer, the unit parser and the generators match a number THEN each has its own copy of the number regex.
14.4 WHEN a signal array is shorter or longer than `Trace.t` THEN the monitor reads past its end or ignores samples, with no error.
14.5 WHEN a user `margin` function receives its signal record or its slot record THEN both are shared across samples, traces and the state and response predicates, so a margin function that writes to them changes later results.
14.6 WHEN `editDistance.ts` is read THEN it starts with a byte-order mark.

### Expected Behavior (Correct)
14.7 THE parser SHALL build the ordered AST without the unused object.
14.8 THE unit parser SHALL handle an unknown unit token and a word unit in one branch.
14.9 THE tokenizer and the unit parser SHALL share one exported number pattern.
14.10 WHEN a signal array's length differs from `Trace.t` THEN the monitor SHALL return `NaN`, unit `signal`, `worstAt` 0.
14.11 WHEN the monitor calls `margin` THEN it SHALL pass a signal record created for that monitor call, separate for the state and the response predicate, and a frozen slot record created at compile time.
14.12 THE file `editDistance.ts` SHALL have no byte-order mark.

### Unchanged Behavior (Regression Prevention)
14.13 THE monitor SHALL CONTINUE TO allocate nothing per sample.

## Improvement I1: Print the compiled STL formula

### Current Behavior
I1.1 WHEN a requirement compiles THEN nothing states the temporal formula it was compiled to.

### Expected Behavior
I1.2 WHEN a requirement compiles THEN `CompiledRequirement.formula` SHALL be a one-line STL formula with its window in seconds and the predicate unit, such as `G[t₀, t₀+3 s] margin("stay upright") > 0 m`.
I1.3 THE formula SHALL be a pure function of the line, the Lexicon and the options.

### Unchanged Behavior
I1.4 THE other `CompiledRequirement` fields SHALL CONTINUE TO have the types in `interfaces.md`.

## Improvement I3: Kiro-compatibility golden corpus

### Expected Behavior
I3.1 THE test suite SHALL compile every `requirements.md` under `.kiro/specs/` of this repository and compare a summary (criterion IDs, patterns, first diagnostic) with a committed golden file.
I3.2 THE test suite SHALL compile a corpus of real Kiro output styles (trailing periods, backticks, bold, `WHEN x THEN the system SHALL`, a comma before THE, multi-line criteria) with a realistic G1 lexicon, and SHALL assert exact IDs, Dimensions and parameters.
I3.3 THE corpus test SHALL assert that no diagnostic in the corpus is caused by a trailing period or by markup.

## Improvement I5: Lexicon linter

### Expected Behavior
I5.1 THE ears module SHALL export `lintLexicon(lexicon, options?)`, which returns findings with a severity, a code, the template phrase and a message, and never throws.
I5.2 THE linter SHALL report: malformed phrases; templates that match the same sample clause (ambiguity); a range, direction or phase slot with no declared dimension; a declared slot that the phrase does not have; duplicate dimension names; use of the deprecated `dims()`; empty or duplicate robot names and features.
I5.3 THE linter SHALL evaluate each predicate's `margin` on deterministic sampled signals and report: a non-finite margin; a margin that reads a signal it does not list; a slot that does not change the margin; and a unit that differs from the SI unit of the slot the margin is linear in.

## Improvement I6: Metamorphic properties

### Expected Behavior
I6.1 THE test suite SHALL check, with fast-check, that equivalent spellings compile to equal spaces, parameters, horizons and monitor results: `200 N` ≡ `0.2 kN`, `0.2 s` ≡ `200 ms`, `150 to 250 N` ≡ `150 N to 250 N`, keyword case, a comma before THE or none, a trailing period, `**bold**` markup, and `THEN` before THE.
