# Requirements Document

## Introduction

The `ears` module (`skeleton/src/ears/`, package `golem-spec`) is the compiler at the centre of GOLEM. It reads acceptance criteria written in the GOLEM dialect of EARS (see `.kiro/steering/ears-for-robots.md`) and produces `CompiledRequirement` objects (see `.kiro/steering/interfaces.md`). Each compiled requirement carries a scenario space for the falsifier, a list of perturbation calls for the simulator, a horizon, and a monitor with quantitative (robustness) semantics: a positive margin means the requirement held, a negative margin means it broke, and the magnitude is in physical units.

The module covers these stages:

1. Tokenizing a line with source offsets.
2. Parsing the five EARS patterns and requirement IDs, with the comma before THE optional.
3. Parsing quantities with units and converting them to SI.
4. Parsing range phrases in triggers.
5. Matching trigger and response phrases against the app `Lexicon` templates with typed slots.
6. Applying temporal wrappers, anchored at the trigger event time in the `Trace`.
7. Building robustness monitors.
8. Reporting diagnostics with line and column.
9. Formatting an AST back to canonical text.
10. Extracting every EARS acceptance criterion from a Kiro `requirements.md`.

The module is pure, deterministic and allocation-light. It never calls an LLM and never guesses: a line that cannot be matched is a compile error with a suggestion. The cross-module contracts in `interfaces.md` are fixed. This spec may add fields to them but never renames or removes any.

Assumptions made in this document:

- The `Trace` passed to a monitor contains a `trigger` event when the requirement pattern has a trigger. Ubiquitous and state requirements have no trigger and use the start of the trace as their anchor.
- The `Trace` begins after the warm-up. The monitor does not skip warm-up samples itself.
- The WHERE pattern is compiled with a set of enabled feature names passed in compile options. A feature that is not enabled makes the requirement vacuous. A feature must be one of the Lexicon's declared `features` (golem-ears-hardening, defect 6).

## Glossary

- **EARS_Compiler**: The top-level entry point of the `ears` module. It runs the Tokenizer, Parser, Lexicon_Matcher and Monitor_Builder in order and returns a `CompiledRequirement` or a list of Diagnostics.
- **Tokenizer**: The component that splits one EARS line into tokens, each with a start offset, an end offset, a line and a column.
- **Token**: A word, number, unit, punctuation mark or requirement ID, with its source offsets.
- **Parser**: The component that turns tokens into an AST (a `ParsedRequirement`).
- **AST**: The abstract syntax tree of one requirement: ID, pattern, optional condition clause, robot name, response clause.
- **Formatter**: The component that prints an AST as canonical text.
- **Canonical_Text**: The single textual form the Formatter prints for an AST: upper-case keywords, a comma before THE, one space between tokens, quantities printed as written by the unit table's canonical spelling.
- **Unit_Table**: The table of accepted unit spellings, their `Kind` and their SI factor.
- **Quantity**: The `Quantity` interface from `interfaces.md`: `kind`, `si` and `text`.
- **Range_Phrase**: A phrase in a trigger that defines an interval or a set of values for a dimension, such as `up to 200 N`, `150 to 250 N`, `from any direction`, `from behind` or `at any point in its stride`.
- **Lexicon_Matcher**: The component that matches a clause against the `PredicateTemplate` and `PerturbationTemplate` phrases of a `Lexicon` and binds the typed slots.
- **Slot**: A typed placeholder in a template phrase, such as `{force}`, `{duration}`, `{length}`, `{speed}`, `{angle}`, `{mass}`, `{ratio}`, `{range:<kind>}` or `{direction}`.
- **Temporal_Wrapper**: The time qualifier on a response: `for <duration>` (always over a window), `within <duration>` (reach the predicate by the deadline, then hold it to the end of the trace: F then G), or none.
- **Anchor_Time**: The time `t₀` from which a window starts: the time of the `trigger` event in the `Trace`, or the first sample time when the requirement has no trigger.
- **Monitor_Builder**: The component that builds the `monitor` function of a `CompiledRequirement` from a matched predicate and a Temporal_Wrapper.
- **Robustness**: A real number from a monitor. Positive means the requirement held, negative means it broke, zero is the boundary. Its magnitude is in the unit of the predicate.
- **Worst_Time**: The time in the `Trace` at which the margin that determines the Robustness occurs (`worstAt`).
- **Diagnostic**: A structured error or warning with a kind, a message, a line, a column and an optional suggestion.
- **Diagnostic_Kind**: One of `PATTERN_MISMATCH`, `MISSING_UNIT`, `UNKNOWN_PHRASE`, `BAD_RANGE`, `UNKNOWN_ROBOT`, or `NON_EARS_LINE` (warning, used by the Extractor).
- **Token_Edit_Distance**: The Levenshtein distance computed over sequences of tokens, not characters.
- **Closest_Template**: The Lexicon template whose phrase has the smallest Token_Edit_Distance to the unmatched clause.
- **Extractor**: The function that reads a Kiro `requirements.md` and returns every EARS acceptance criterion with its ID and source position.
- **Requirement_ID**: The identifier of a requirement, such as `R2` or `2.1`.
- **Kiro_Requirements_File**: A `requirements.md` written by Kiro, with `### Requirement N` headings and a `#### Acceptance Criteria` list of numbered lines.
- **Compile_Options**: The optional input to the EARS_Compiler: the enabled feature names for WHERE, and the requirement ID context.

## Requirements

### Requirement 1: Tokenize a line with source offsets

**User Story:** As a robotics engineer, I want every token of an EARS line to know where it came from, so that a diagnostic points at the exact character that is wrong.

#### Acceptance Criteria

1. WHEN a string of text is provided, THE Tokenizer SHALL return a list of Tokens in ascending source order, each with a type, its text, a zero-based start offset, a zero-based end offset (exclusive), a one-based line and a one-based column. Offsets and columns SHALL be counted in UTF-16 code units.
2. THE Tokenizer SHALL set each Token's start and end offsets so that `input.slice(start, end)` equals the Token's text, and SHALL return Tokens whose ranges do not overlap.
3. THE Tokenizer SHALL assign each Token exactly one of these types: number, unit, keyword, word, comma, requirement ID.
   - A number is a decimal with an optional leading `+` or `-` sign and an optional fractional part, such as `200`, `0.2`, `-1.5`.
   - A unit is one of the Unit_Table spellings, including `m/s`, `cm/s`, `°` and `%`, when it directly follows a number, with or without whitespace between them.
   - A requirement ID is `R<n>.`, `<n>.` or `<n>.<m>` at the start of the line, where `<n>` and `<m>` are non-negative integers.
4. WHEN the input contains leading, trailing or repeated whitespace (space, tab, `\r`, `\n`), THE Tokenizer SHALL skip the whitespace and SHALL report offsets, lines and columns relative to the original input, not to the trimmed input.
5. IF the input contains a character that belongs to no Token type, THEN THE Tokenizer SHALL emit one error Diagnostic for that character with its start offset, end offset, line and column, SHALL NOT emit a Token for it, and SHALL continue tokenizing the remainder of the input.
6. THE Tokenizer SHALL recognise the keywords WHEN, WHILE, IF, THEN, WHERE, THE and SHALL regardless of letter case, and SHALL preserve the input's original spelling in the Token text.
7. WHEN a keyword appears as a substring of a longer word, such as `THEN` inside `THENCE` or `IF` inside `IFFY`, THE Tokenizer SHALL emit one word Token for the whole word and SHALL NOT emit a keyword Token.
8. THE Tokenizer SHALL count a line break as `\n` or `\r\n` (one break each), SHALL start a new line number after each break, and SHALL count columns from 1 at the first UTF-16 code unit after the break.
9. WHEN the input is an empty string or contains only whitespace, THE Tokenizer SHALL return an empty Token list and no Diagnostics.
10. FOR ALL input strings, THE Tokenizer SHALL satisfy coverage: the input equals the concatenation, in order, of the Token texts, the skipped whitespace and the texts of the characters reported by error Diagnostics (tokenization covers the input).
11. THE Tokenizer SHALL be a pure function of its input string, so that tokenizing the same string twice returns equal Token lists and Diagnostics (determinism).
12. WHEN the EARS_Compiler compiles a line, THE EARS_Compiler SHALL first replace Kiro's Markdown markup with spaces of the same length: every `*` and `` ` ``, every run of `_` that does not sit between two word characters, and the last `.` of the line when only whitespace or markup follows it and it does not follow another `.`. Offsets, lines and columns of every Diagnostic SHALL therefore be those of the line as written, and `source` SHALL stay the line as written. The Tokenizer itself SHALL still report these characters under criterion 5. *(Corrected by golem-ears-hardening, defect 2: Kiro ends every criterion with a period and uses inline code and bold, so before this criterion no Kiro-written criterion compiled.)*

### Requirement 2: Parse quantities with units and convert to SI

**User Story:** As a robotics engineer, I want every number in a requirement to carry a unit, so that the compiled requirement is physical and unambiguous.

#### Acceptance Criteria

1. WHEN a decimal number (optional sign, optional fractional part, optional exponent) is immediately followed, after at most one space, by an accepted unit (`N`, `kN`, `m`, `cm`, `mm`, `s`, `ms`, `m/s`, `cm/s`, `deg`, `°`, `rad`, `kg`, `g`, `%`), THE Unit_Table SHALL produce a Quantity with the matching `kind`, the SI value in `si`, and `text` equal to the substring as written, including the original spacing and spelling.
2. THE Unit_Table SHALL convert to SI as follows: N ×1 to newtons, kN ×1000 to newtons, m ×1 to metres, cm ×0.01 to metres, mm ×0.001 to metres, s ×1 to seconds, ms ×0.001 to seconds, m/s ×1 to metres per second, cm/s ×0.01 to metres per second, deg and ° ×π/180 to radians, rad ×1 to radians, kg ×1 to kilograms, g ×0.001 to kilograms, and % ×0.01 to a dimensionless ratio.
3. THE Unit_Table SHALL map each accepted unit to exactly one Kind from `interfaces.md`: N and kN to force; s and ms to duration; m, cm and mm to length; m/s and cm/s to speed; deg, ° and rad to angle; kg and g to mass; % to ratio.
4. THE Unit_Table SHALL match unit spellings case-sensitively (for example `N` is a force and `n` is not an accepted unit, `m` is a length and `M` is not an accepted unit).
5. IF a number appears where a Quantity is required and no accepted unit follows it, THEN THE Parser SHALL emit an error Diagnostic of kind `MISSING_UNIT` at the line and column of the number, and SHALL NOT return a Quantity for it.
6. WHERE a Slot is declared `{count}` in a template, THE Parser SHALL accept an unsigned integer (digits only, no fractional part, no unit) for that Slot and SHALL produce a Quantity with kind `count` and `si` equal to the integer value.
7. WHERE a Slot is declared `{ratio}` in a template, THE Parser SHALL accept either a `%` quantity, or a bare number in the closed interval [0, 1], and SHALL produce a Quantity with kind `ratio`.
8. IF a bare number outside [0, 1] fills a `{ratio}` Slot, THEN THE Parser SHALL emit a `BAD_RANGE` Diagnostic at the number that states the accepted interval.
9. IF a word that follows a number is not in the Unit_Table, THEN THE Parser SHALL emit an error Diagnostic of kind `UNKNOWN_PHRASE` at the unit's line and column, and SHALL list the accepted units in the message.
10. IF a Quantity has a unit whose Kind differs from the Kind of the Slot it fills, THEN THE Lexicon_Matcher SHALL emit an error Diagnostic of kind `UNKNOWN_PHRASE` at the Quantity's line and column, and the message SHALL name the expected Kind and the Kind found.
11. FOR ALL finite values `x` and all accepted units `u`, converting `x u` to SI and converting that SI value back to `u` SHALL return `x` within a relative error of 1e-12 (unit identity), and a value of `0` SHALL return exactly `0`.
12. FOR ALL Quantities produced by the Parser, THE Unit_Table SHALL set `text` to the spelling that was written (for example `°` stays `°` and `deg` stays `deg`), so that parsing `text` returns a Quantity equal in `kind`, `si` and `text` (text round trip).

### Requirement 3: Parse the five EARS patterns and requirement IDs

**User Story:** As a robotics engineer, I want to write requirements in Kiro's EARS patterns, so that the same file Kiro writes is the file GOLEM tests.

#### Acceptance Criteria

1. WHEN a line has the form `THE <robot> SHALL <response>`, THE Parser SHALL produce an AST of pattern `ubiquitous` with no condition clause and a non-empty response clause.
2. WHEN a line has the form `WHEN <trigger> THE <robot> SHALL <response>`, THE Parser SHALL produce an AST of pattern `event` whose condition clause is the trigger text and whose response clause is the response text. Both clauses SHALL contain at least one Token.
3. WHEN a line has the form `WHILE <state> THE <robot> SHALL <response>`, THE Parser SHALL produce an AST of pattern `state` whose condition clause is the state text and whose response clause is the response text. Both clauses SHALL contain at least one Token.
4. WHEN a line has the form `IF <fault> THEN THE <robot> SHALL <response>`, THE Parser SHALL produce an AST of pattern `unwanted` whose condition clause is the fault text and whose response clause is the response text. Both clauses SHALL contain at least one Token.
5. WHEN a line has the form `WHERE <feature> THE <robot> SHALL <response>`, THE Parser SHALL produce an AST of pattern `optional` whose condition clause is the feature text and whose response clause is the response text. Both clauses SHALL contain at least one Token.
6. THE Parser SHALL accept an optional comma immediately before THE in the event, state, unwanted and optional patterns, so that `WHEN x, THE robot SHALL y` and `WHEN x THE robot SHALL y` produce equal ASTs when source offsets are ignored.
7. THE Parser SHALL accept an optional comma immediately after THEN in the unwanted pattern, so that `IF x, THEN, THE robot SHALL y` and `IF x, THEN THE robot SHALL y` produce equal ASTs when source offsets are ignored.
8. WHEN a line begins with a Requirement_ID of the form `R<n>.`, `<n>.<m>` or `<n>.`, where `<n>` and `<m>` are unsigned decimal integers of 1 to 6 digits, THE Parser SHALL store the ID text without its trailing period in the AST and SHALL parse the remainder as an EARS line.
9. WHEN a line has no leading Requirement_ID, THE Parser SHALL produce an AST with no ID and SHALL NOT emit a Diagnostic for the missing ID.
10. IF a line does not match any of the five patterns, THEN THE Parser SHALL emit a `PATTERN_MISMATCH` Diagnostic at the line and column of the first Token that cannot continue any pattern, or at the end of the line when the line ends early. The message SHALL name the pattern the line most resembles (the pattern whose leading keyword matches, or `ubiquitous` when none does) and the keyword or clause expected next.
11. IF the words between THE and SHALL are not one of the `robotNames` of the Lexicon, THEN THE Parser SHALL emit an `UNKNOWN_ROBOT` Diagnostic over those words and SHALL list every allowed name in the message. A robot name is one to six word Tokens between THE and SHALL, joined by one space, and SHALL be compared with `robotNames` case-insensitively with whitespace collapsed, so that `THE Unitree G1 SHALL` names the robot `Unitree G1`. *(Corrected by golem-ears-hardening, defect 13: the name was a single word, so multi-word names failed.)*
12. THE Parser SHALL treat keywords, robot names and phrase words as case-insensitive, and SHALL store keywords in the AST in upper case and robot names as written.
13. IF a line contains more than one SHALL keyword, THEN THE Parser SHALL emit a `PATTERN_MISMATCH` Diagnostic at the second SHALL and SHALL NOT produce an AST for that line.
14. THE Parser SHALL record, for each trigger, state, fault, feature or response clause, a start offset equal to the start offset of its first Token and an end offset equal to the end offset of its last Token, so that the substring of the input between the two offsets equals the clause text.
15. IF the condition clause or the response clause of a pattern that requires one is empty (for example `WHEN THE robot SHALL y` or `WHEN x THE robot SHALL`), THEN THE Parser SHALL emit a `PATTERN_MISMATCH` Diagnostic at the position where the clause was expected, and the message SHALL name the missing clause.
16. WHEN an event, state or optional line has `THEN`, `, THEN` or `THEN ,` directly before `THE <robot> SHALL`, as Kiro writes `WHEN x THEN the system SHALL y`, THE Parser SHALL accept the line and SHALL end the condition clause before `THEN`; the AST, and so the Formatter output, SHALL have no THEN. *(Added by golem-ears-hardening, defect 8.)*
16. THE Parser SHALL be a pure function of its tokens and the Lexicon: parsing the same input twice SHALL return equal ASTs and equal Diagnostics.

### Requirement 4: Parse range phrases in triggers

**User Story:** As a robotics engineer, I want to write ranges in a trigger, so that the falsifier knows what to explore.

#### Acceptance Criteria

1. WHEN a trigger contains `up to <quantity>`, THE Parser SHALL produce a Range_Phrase with `kind` equal to the quantity's Kind, `min` equal to 0 and `max` equal to the quantity's SI value, with `min` ≤ `max`, and SHALL treat `up to 0 <unit>` as a valid fixed Range_Phrase with `min` and `max` both 0.
2. WHEN a trigger contains `<quantity> to <quantity>` with the same Kind, THE Parser SHALL produce a Range_Phrase with `kind` equal to that Kind, `min` equal to the SI value of the first quantity and `max` equal to the SI value of the second quantity, and SHALL accept equal values as a valid Range_Phrase with `min` equal to `max`.
3. WHEN a trigger contains `from any direction`, THE Parser SHALL produce an angle Range_Phrase with `min` 0 rad, `max` 2π rad (half-open, so 2π is the same direction as 0) and `wrap` true.
4. WHEN a trigger contains `from behind`, THE Parser SHALL produce an angle Range_Phrase with `min` 3π/4 rad (135°), `max` 5π/4 rad (225°) and `wrap` true.
5. WHEN a trigger contains `at any point in its stride`, THE Parser SHALL produce a phase Range_Phrase with `min` 0, `max` 1 (half-open, so 1 is the same phase as 0) and `wrap` true.
6. WHEN a trigger contains a single quantity without a range word, such as `for 0.2 s`, THE Parser SHALL produce a fixed value with `kind` equal to the quantity's Kind and `min` equal to `max`, and the falsifier SHALL NOT vary it.
7. IF the SI minimum of a Range_Phrase is greater than its SI maximum, THEN THE Parser SHALL emit a `BAD_RANGE` Diagnostic at the line and column of the second quantity, whose message states both values with their units as written.
8. IF the two quantities of a Range_Phrase have different Kinds, THEN THE Parser SHALL emit a `BAD_RANGE` Diagnostic at the line and column of the second quantity, whose message names both Kinds.
9. IF a range contains a quantity with a negative SI value and a Kind of `force`, `duration`, `length`, `speed` or `mass`, THEN THE Parser SHALL emit a `BAD_RANGE` Diagnostic at the line and column of that quantity, whose message names the Kind and the value as written.
10. IF a trigger binds more than one Range_Phrase to the same Slot of the matched perturbation template, THEN THE Parser SHALL emit a `BAD_RANGE` Diagnostic at the line and column of the second Range_Phrase and SHALL NOT produce a Dimension for that Slot.
11. THE Compiler SHALL build each Dimension itself: `kind`, `min` and `max` in SI and `wrap` from the Range_Phrase (or the fixed value, with `min` equal to `max`) bound to the Slot, and `name` and `severity` from the matched template's `slots` declaration for that Slot (`SlotDimension` in `interfaces.md`). The template does not compute Dimensions. *(Corrected by golem-ears-hardening, defects 1 and 10: the template's `dims()` computed them from raw slot text, and the compiler then matched them to Slots by name only, which dropped the direction.)*
12. IF a Slot of a perturbation template is bound to a Range_Phrase with `min` < `max` and the template declares no Dimension for it, THEN THE Compiler SHALL emit a `BAD_LEXICON` error Diagnostic at the Range_Phrase that names the Slot and the template. A Slot with a fixed value and no declaration SHALL add no Dimension.
13. WHEN a `{phase}` Slot follows `at` and the clause gives a percentage (`62%`, `62% of its stride`, `62% into its stride`), THE Parser SHALL bind a fixed phase equal to the ratio; IF the percentage is outside 0 % to 100 %, THEN THE Parser SHALL emit `BAD_RANGE`. *(Added by golem-ears-hardening, defect 9, so that a shrunk counterexample can be written back as a requirement.)*

### Requirement 5: Match phrases against the Lexicon with typed slots

**User Story:** As an app author, I want requirement phrases matched against my lexicon templates, so that each phrase maps to a signal and a perturbation with typed values.

#### Acceptance Criteria

1. WHEN a trigger clause is provided, THE Lexicon_Matcher SHALL find the single `PerturbationTemplate` whose `phrase` matches the whole clause, token for token, and SHALL bind each Slot to the parsed Quantity, Range_Phrase or direction.
2. WHEN a response or state clause is provided, THE Lexicon_Matcher SHALL find the single `PredicateTemplate` whose `phrase` matches the whole clause, token for token, after any Temporal_Wrapper has been removed, and SHALL bind each Slot to the parsed Quantity in SI units.
3. THE Lexicon_Matcher SHALL match template literal words case-insensitively and SHALL match Slots by Kind, so that `{force}` accepts only a Quantity of Kind force. A Quantity of another Kind SHALL NOT bind.
4. IF a clause matches no template, THEN THE Lexicon_Matcher SHALL emit an `UNKNOWN_PHRASE` Diagnostic at the first Token that cannot be matched. The Diagnostic SHALL carry the Closest_Template phrase as `suggestion`, chosen as in Requirement 9, and SHALL carry no suggestion when Requirement 9.7 applies. WHEN the clause follows the Closest_Template up to a Slot that rejects what is written there, the Diagnostic SHALL instead cover the rejected words, its message SHALL name the Slot and its accepted forms, and its `suggestion` SHALL be the clause with an accepted form in place of the rejected words. *(Corrected by golem-ears-hardening, defect 9: the message repeated the template the user had already written.)*
5. IF two or more templates match a clause equally well, THEN THE Lexicon_Matcher SHALL emit an `UNKNOWN_PHRASE` Diagnostic that lists every matching phrase in Lexicon order, SHALL NOT bind any Slot, and SHALL NOT pick a template.
6. THE Lexicon_Matcher SHALL NOT match a clause approximately: a clause with a different word order, a missing word, an extra word or a misspelt word SHALL produce an `UNKNOWN_PHRASE` Diagnostic and SHALL bind no Slot.
7. WHEN a template Slot is `{range:<kind>}`, THE Lexicon_Matcher SHALL accept a Range_Phrase of that Kind, from which the Compiler builds the Dimension (Requirement 4.11). IF the Range_Phrase has a different Kind, THEN THE Lexicon_Matcher SHALL emit an `UNKNOWN_PHRASE` Diagnostic that names the expected Kind and the Kind found. WHERE a template has no `slots` but has the deprecated `dims(slots, ranges)`, THE Compiler SHALL call it with the bound values and the SI range of every Slot, SHALL tie each returned Dimension to a Slot (exact name, `.<slot>` suffix, equal kind and bounds, or the only one of its kind), and SHALL emit a `BAD_LEXICON` warning for a searched Dimension it cannot tie or whose bounds differ from the line.
8. THE Compiler SHALL produce exactly one `PerturbationCall` per matched perturbation template, in source order, with `template` equal to the template `phrase` and one `params` entry per bound Slot, keyed by Slot name: the Dimension name (string) for a searched value (`min` < `max`) or the SI number for a fixed value (`min` = `max`). *(Corrected by golem-ears-hardening, defect 1: entries were keyed by Dimension name suffix, so the `{direction}` Slot, whose Dimension is `push.angle`, never reached `apply()`.)*
9. IF a Lexicon contains no template of the clause class (no `PerturbationTemplate` for a trigger, fault or feature clause, or no `PredicateTemplate` for a response or state clause), THEN THE Compiler SHALL emit an `UNKNOWN_PHRASE` Diagnostic that names the missing class, SHALL return no `CompiledRequirement`, and SHALL preserve the Diagnostics already emitted for other clauses of the same line.
10. FOR ALL generated Lexicons and clauses built from a template phrase with Slots filled by Quantities of the matching Kind, THE Lexicon_Matcher SHALL bind each Slot to the SI value of the Quantity written in that position (match soundness).
11. FOR ALL clauses that match a template, THE Lexicon_Matcher SHALL return equal bindings when the clause's literal words are written in any letter case (case-insensitivity).

### Requirement 6: Apply temporal wrappers anchored at the trigger event

**User Story:** As a robotics engineer, I want `for 3 s` and `within 6 s` to mean what they say, so that a requirement checks the right time window after the trigger.

#### Acceptance Criteria

1. WHEN a response ends with `for <duration>`, THE Monitor_Builder SHALL build an always-wrapper over the closed window `[t₀, t₀ + onset + duration]`, where `duration` is the SI value in seconds of the Quantity and `onset` is the matched trigger template's `maxOnset` (0 when it declares none). *(Corrected by golem-ears-hardening, defect 11: a push that waits for a gait phase starts up to one stride after t₀, so without `onset` it got less than the stated time.)*
2. WHEN a response ends with `within <duration>`, THE Monitor_Builder SHALL build `F[t₀, t₀ + onset + duration] G[·, t_last] φ`: the predicate must become true no later than the deadline `t₀ + onset + duration` and stay true until the last sample. Its Robustness SHALL be the minimum margin over the samples from the last sample at or before the deadline to the last sample. *(Corrected by golem-ears-hardening, defect 4: the maximum over `[t₀, t₀ + duration]` passed a robot that was upright at the trigger instant and then fell.)*
3. WHEN a response has no Temporal_Wrapper and the pattern is `event` or `unwanted`, THE Monitor_Builder SHALL build an always-wrapper over `[t₀, t_last]`, where `t_last` is the last sample time of `Trace.t`.
4. WHEN a response has no Temporal_Wrapper and the pattern is `ubiquitous`, THE Monitor_Builder SHALL build an always-wrapper over `[t_first, t_last]`, where `t_first` and `t_last` are the first and last sample times of `Trace.t`.
5. WHILE the pattern is `state` and the state is a predicate, THE Monitor_Builder SHALL build a monitor that returns, over `[t_first, t_last]`, the minimum over samples of `max(−stateMargin, responseMargin)`. A sample where the state does not hold (`stateMargin < 0`) SHALL contribute `−stateMargin`, which is positive. WHEN the response ends with `for d`, the response term of sample `i` SHALL be the minimum response margin over `[t_i, t_i + d]` (`G(ψ → G[t, t+d] φ)`), and `worstAt` SHALL be the response sample that attains it, or `t_i` when a positive `−stateMargin` decides it. IF the response of a predicate state ends with `within`, THEN THE EARS_Compiler SHALL emit a `PATTERN_MISMATCH` error at `within`. *(Corrected by golem-ears-hardening, defect 5: `for d` was dropped silently.)* WHILE the state is a perturbation phrase (Requirement 12.6), THE Monitor_Builder SHALL monitor the response exactly as for the `ubiquitous` pattern, because the perturbation is applied for the whole episode. *(Added by golem-ears-hardening, defect 7.)*
6. WHEN the pattern is `event` or `unwanted` and `Trace.events` contains one or more events named `trigger`, THE Monitor_Builder SHALL set `t₀` to the `t` of the first such event in array order.
7. IF the pattern is `event` or `unwanted` and `Trace.events` contains no event named `trigger`, THEN THE monitor SHALL return `robustness` `NaN`, `unit` `trace` and `worstAt` 0, and SHALL NOT return a positive or negative margin.
8. WHERE the pattern is `optional` and the feature is not in the enabled features of Compile_Options, THE Monitor_Builder SHALL build a monitor that returns `robustness` `+Infinity`, `worstAt` 0 and the `unit` of the response, for every Trace, including a Trace with no `trigger` event. IF the feature is not one of `Lexicon.features` (compared trimmed, with spaces collapsed, case-insensitively), THEN THE EARS_Compiler SHALL emit `UNKNOWN_PHRASE` at the feature clause with the closest declared feature as `suggestion`, and SHALL return no `CompiledRequirement`. *(Corrected by golem-ears-hardening, defect 6: a misspelt feature was never enabled and silently passed.)*
9. THE Compiler SHALL set `horizon`, in seconds, as follows, with `onset` as in criterion 1 and `dur` the trigger duration (0 when the trigger has none). For `event` and `unwanted` requirements: `onset + dur + d` with `for d`, `onset + dur + 2T` with `within T` (the deadline plus at least T of hold), and the episode length with no wrapper. For `ubiquitous`, `optional` and perturbation-state requirements: `onset + d` with `for d`, the larger of the episode length and `onset + 2T` with `within T`, and the episode length with no wrapper. For predicate-state requirements: the episode length. The episode length is Compile_Options `episodeSeconds`, else the Lexicon's, else 10 s. *(Corrected by golem-ears-hardening, defects 4 and 11: a ubiquitous `for 3 s` got the 10 s episode.)*
10. WHEN the window `[t₀, t₀ + duration]` extends beyond `t_last`, THE monitor SHALL evaluate only the samples with `t₀ ≤ t ≤ t_last`, and SHALL NOT read outside the `Trace` arrays.
11. IF the window `[t₀, t₀ + duration]` contains no sample of `Trace.t` (for example, `t₀ > t_last`), THEN THE monitor SHALL return `robustness` `NaN`, `unit` `trace` and `worstAt` 0.
12. THE monitor SHALL include a sample at time `t` in a window `[a, b]` if and only if `a ≤ t ≤ b`, so that both end samples are included. WHEN `a` or `b` falls between two control-rate samples, THE monitor SHALL use only the samples inside the window and SHALL NOT interpolate.
13. FOR ALL traces with a `trigger` event at `t₀`, THE monitor of an `event` requirement with an always-wrapper SHALL return a Robustness that does not depend on the signal values at samples with `t < t₀`.

### Requirement 7: Build robustness monitors

**User Story:** As a robotics engineer, I want each monitor to return a signed margin in physical units, so that I can see how close a requirement came to breaking.

#### Acceptance Criteria

1. WHEN a monitor is called with a `Trace`, THE monitor SHALL return an object with a finite-or-special numeric `robustness`, a `worstAt` in seconds and a `unit` string, as defined in `interfaces.md`, and SHALL NOT throw for any well-formed `Trace`.
2. WHEN the wrapper is always, THE monitor SHALL return the minimum over the window of the predicate margin, and SHALL set `worstAt` to the `Trace.t` value of the sample that attains that minimum.
3. WHEN the wrapper is `within`, THE monitor SHALL return the F-then-G Robustness of Requirement 6.2, and SHALL set `worstAt` to the `Trace.t` value of the last sample from `t0` on whose margin is 0 or less, or, when there is none, to the earliest sample of the hold window that attains the minimum. *(Corrected by golem-ears-hardening, defect 4: `worstAt` reported the best sample.)*
4. WHEN several samples attain the same extreme margin under an always-wrapper, THE monitor SHALL set `worstAt` to the earliest such time.
5. WHEN the window contains no sample (the window starts after the last sample of the `Trace`, or the `Trace` has zero samples), THE monitor SHALL return a `robustness` of `NaN`, a `unit` of `trace` and a `worstAt` of 0.
6. THE monitor SHALL set `unit` to the `unit` of the matched `PredicateTemplate`, except for the `NaN` cases defined in criteria 5 and 9.
7. THE monitor SHALL evaluate the predicate by passing, for each sample in the window, the signal values at that sample index and the bound Slot values in SI to the template's `margin` function.
8. THE monitor SHALL read signals only through the `Trace.signals` arrays and the anchor time only through `Trace.events`, and SHALL NOT read any other state.
9. IF a signal named by the predicate template is absent from `Trace.signals`, THEN THE monitor SHALL return a `robustness` of `NaN`, a `unit` of `signal` and a `worstAt` of 0, and SHALL NOT return a positive or negative margin.
10. IF the `margin` function returns `NaN` for any sample in the window, THEN THE monitor SHALL return a `robustness` of `NaN`, a `unit` equal to the predicate `unit` and a `worstAt` equal to the time of the first such sample, so that a missing measurement is never reported as satisfied.
11. FOR ALL traces and compiled requirements whose margins are not `NaN`, THE monitor SHALL return a `robustness` greater than 0 if and only if the predicate margin is greater than 0 at every sample in the window for an always-wrapper, or, for a `within` wrapper, there is a sample at or before the deadline from which every margin to the last sample is greater than 0 (robustness soundness).
12. FOR ALL traces and compiled requirements whose margins are not `NaN`, THE monitor SHALL return a `robustness` less than 0 if and only if the requirement is violated by direct evaluation of the predicate over the window, and SHALL return exactly 0 only when the extreme margin equals 0 (boundary).
13. FOR ALL traces and `above` predicates, moving the threshold from below the minimum signal value in the window to above it SHALL change the sign of the `robustness` from positive to negative, and moving the threshold back SHALL restore the original sign (sign flip when the threshold crosses the signal).
14. FOR ALL `above` predicates and traces, raising the threshold SHALL NOT raise the `robustness`, and lowering it SHALL NOT lower the `robustness` (monotonicity).
15. THE monitor SHALL be a pure function of its `Trace` argument: calling it twice with the same `Trace` SHALL return bit-identical `robustness`, `worstAt` and `unit` (determinism).
16. THE monitor SHALL NOT allocate an array or object per sample inside the window loop and SHALL NOT mutate `Trace.t`, `Trace.signals` or `Trace.events`.

### Requirement 8: Report diagnostics with line and column

**User Story:** As a robotics engineer, I want errors that say what is wrong, where, and what to write instead, so that I can fix a requirement line without reading the compiler.

#### Acceptance Criteria

1. THE Diagnostic SHALL contain a `kind` (one of the Diagnostic_Kind values), a `severity` (`error` or `warning`), a `message` (a non-empty string), a one-based `line`, a one-based `column`, a zero-based start offset, an end offset greater than or equal to the start offset, and an optional `suggestion`.
2. WHEN a line does not fit any of the five patterns, THE EARS_Compiler SHALL emit a `PATTERN_MISMATCH` Diagnostic with severity `error`.
3. WHEN a number that needs a unit has none, THE EARS_Compiler SHALL emit a `MISSING_UNIT` Diagnostic with severity `error`.
4. WHEN a clause matches no template and a Closest_Template exists under Requirement 9, THE EARS_Compiler SHALL emit an `UNKNOWN_PHRASE` Diagnostic with severity `error` and the Closest_Template phrase in `suggestion`.
5. WHEN a range has a minimum greater than its maximum, mixes Kinds, or contains a negative `force`, `duration`, `length`, `speed` or `mass` value, THE EARS_Compiler SHALL emit a `BAD_RANGE` Diagnostic with severity `error`.
6. WHEN the robot name is not in the Lexicon `robotNames`, THE EARS_Compiler SHALL emit an `UNKNOWN_ROBOT` Diagnostic with severity `error` and the allowed names in `suggestion`.
7. WHEN a line has several independent problems, THE EARS_Compiler SHALL report each as its own Diagnostic, ordered by ascending start offset, and SHALL continue parsing later clauses unless the problem makes the remaining text unparseable (for example a missing SHALL), in which case it SHALL still report every problem found before that point.
8. THE EARS_Compiler SHALL set the `line`, `column` and start offset of a Diagnostic to the position of the first character of the offending Token, and the end offset to the position immediately after its last character. WHERE the problem is a missing Token, it SHALL use the position where the Token was expected, with end offset equal to start offset.
9. WHEN an input contains multi-line text, THE Tokenizer SHALL count lines by `\n` and `\r\n` (each counted once, with the next line starting at column 1) and SHALL count columns in UTF-16 code units from the start of the line.
10. THE Diagnostic `message` SHALL state the problem in plain language, SHALL include the value and unit (for example "200 N") wherever a number is involved, and SHALL NOT contain themed wording.
11. IF a line produces at least one Diagnostic of severity `error`, THEN THE EARS_Compiler SHALL return all of its Diagnostics and SHALL NOT return a `CompiledRequirement` for that line.
12. WHEN a line produces only Diagnostics of severity `warning`, THE EARS_Compiler SHALL return the `CompiledRequirement` together with the warnings.
13. WHEN the same input is compiled twice with the same Lexicon and Compile_Options, THE EARS_Compiler SHALL return Diagnostic lists that are equal in length, order and every field (determinism).
14. WHEN a Diagnostic originates from a line extracted from a Kiro_Requirements_File, THE EARS_Compiler SHALL report `line` and `column` relative to the file, using the line number and text column returned by the Extractor.

### Requirement 9: Suggest the closest template by token edit distance

**User Story:** As a robotics engineer, I want an unknown phrase to point to the nearest valid phrase, so that I can correct a typo quickly.

#### Acceptance Criteria

1. THE Edit_Distance function SHALL compute the Levenshtein distance between two token sequences, with a cost of 1 for each insertion, deletion and substitution of a whole token and a cost of 0 for two tokens that are equal after case folding.
2. WHEN a clause is compared with a template phrase, THE Lexicon_Matcher SHALL replace each Slot in the template by a single wildcard token and SHALL replace each Quantity in the clause (a number with its unit, or a bare count or ratio) by a single wildcard token, so that a Quantity counts as one token regardless of how many Tokens it spans.
3. WHEN a clause is compared with a template phrase, THE Lexicon_Matcher SHALL give a cost of 0 to a pair of wildcard tokens whose Kinds are equal and a cost of 1 to a pair of wildcard tokens whose Kinds differ.
4. WHEN a clause is compared with a template phrase, THE Lexicon_Matcher SHALL compare words without regard to letter case.
5. IF a clause matches no template, THEN THE Lexicon_Matcher SHALL choose the template with the smallest Token_Edit_Distance as the Closest_Template and SHALL return its phrase as the `suggestion` of the `UNKNOWN_PHRASE` Diagnostic.
6. WHEN two templates have the same Token_Edit_Distance, THE Lexicon_Matcher SHALL choose the template that appears first in the Lexicon.
7. IF the smallest Token_Edit_Distance is greater than half of the number of tokens of the longer of the two compared sequences, THEN THE Lexicon_Matcher SHALL omit the `suggestion` and SHALL state in the Diagnostic message that no close phrase exists.
8. IF the Lexicon contains no template for the clause class (perturbation or predicate), THEN THE Lexicon_Matcher SHALL omit the `suggestion` and SHALL state in the Diagnostic message that the Lexicon has no template of that class.
9. THE Lexicon_Matcher SHALL compare a trigger clause only with `PerturbationTemplate` phrases, and SHALL compare a response or state clause only with `PredicateTemplate` phrases.
10. FOR ALL token sequences `a`, `b` and `c`, THE Edit_Distance function SHALL satisfy: `d(a, a) = 0`, `d(a, b) = d(b, a)`, `d(a, b) ≥ 0`, `d(a, b) = 0` only when `a` equals `b`, and `d(a, c) ≤ d(a, b) + d(b, c)` (metric laws).
11. FOR ALL token sequences `a` and `b`, THE Edit_Distance function SHALL satisfy `|len(a) − len(b)| ≤ d(a, b) ≤ max(len(a), len(b))`.
12. FOR ALL Lexicons and clauses, THE Lexicon_Matcher SHALL return the same Closest_Template and `suggestion` on repeated calls with equal inputs (determinism).

### Requirement 10: Format an AST back to canonical text

**User Story:** As a tool author, I want to print any parsed requirement as canonical text, so that formatting, rewriting and round-trip tests are possible.

#### Acceptance Criteria

1. WHEN the Formatter is given an AST produced by the Parser, THE Formatter SHALL return Canonical_Text as one string that contains no `\n` or `\r` character, no leading or trailing whitespace, and exactly one space between adjacent Tokens except where a comma is printed.
2. THE Formatter SHALL print the keywords WHEN, WHILE, IF, THEN, WHERE, THE and SHALL in upper case, and SHALL print a comma immediately before THE (no space before the comma, one space after it) in the event, state and optional patterns.
3. THE Formatter SHALL print the unwanted pattern in the form `IF <fault>, THEN THE <robot> SHALL <response>`, with the comma before THEN and no comma after THEN.
4. WHERE the AST has a Requirement_ID, THE Formatter SHALL print the ID exactly as stored in the AST, followed by one space, before the pattern keyword, and WHERE the AST has no Requirement_ID THE Formatter SHALL print no ID and no leading space.
5. THE Formatter SHALL print each Quantity using the `text` it was written with, so that the unit spelling and the number's digits are unchanged (for example `0.20 s` stays `0.20 s`, and `200 N` is never printed as `0.2 kN`).
6. THE Formatter SHALL print the robot name, the clause words and the Range_Phrases exactly as they are recorded in the AST's clause text, with no change of letter case, wording or order.
7. THE Formatter SHALL be a pure function of the AST: it SHALL NOT read the Lexicon, the clock, the file system or any state outside its argument, and it SHALL NOT mutate the AST.
8. FOR ALL ASTs produced by the Parser for generated valid lines of all five patterns, THE Parser SHALL parse the Formatter output into an AST equal to the original ignoring source offsets and line and column fields (round trip: `parse(format(parse(line)))` equals `parse(line)`).
9. FOR ALL generated valid lines, THE Parser SHALL produce equal ASTs, ignoring source offsets, for the line written with the comma before THE and for the same line written without it, and THE Formatter SHALL print identical text for both.
10. FOR ALL ASTs produced by the Parser for generated valid lines, THE Formatter SHALL be idempotent: `format(parse(format(ast)))` SHALL equal `format(ast)` character for character.
11. IF the Formatter is given an AST that has a missing or unrecognised `pattern` value, THEN THE Formatter SHALL throw an error that names the invalid field, and SHALL NOT return partial text.

### Requirement 11: Extract EARS criteria from a Kiro requirements.md

**User Story:** As a robotics engineer, I want GOLEM to read the same `requirements.md` that Kiro writes, so that I do not maintain a second copy of my requirements.

#### Acceptance Criteria

1. WHEN the text of a Kiro_Requirements_File is provided, THE Extractor SHALL return every numbered line under a `#### Acceptance Criteria` heading whose text, after the number and following whitespace, starts with WHEN, WHILE, IF, WHERE or THE (matched case-insensitively as a whole word, after any leading `*`, `` ` `` or `__` emphasis), in file order.
2. THE Extractor SHALL read the requirement number from the nearest preceding `### Requirement <n>` heading, where `<n>` is a decimal integer, and SHALL form the Requirement_ID as `<n>.<m>` where `<m>` is the decimal integer at the start of the criterion line.
3. THE Extractor SHALL stop collecting criteria for a requirement at the next line that starts with one to four `#` characters followed by a space, other than the `#### Acceptance Criteria` heading of the same requirement.
4. THE Extractor SHALL return, for each criterion, the ID, the text of the line without its number and the whitespace that follows it, the one-based line number in the file of the numbered line, and the one-based column of the first character of that text, counted in UTF-16 code units.
5. IF a numbered line under `#### Acceptance Criteria` does not start with WHEN, WHILE, IF, WHERE or THE and does not start with `FOR ALL`, THEN THE Extractor SHALL skip the line, SHALL return no criterion for it, and SHALL emit a `NON_EARS_LINE` warning Diagnostic at the line and column of the first character of its text.
6. WHEN a criterion starts with one of the keywords in criterion 1 but fails to parse, THE Extractor SHALL still return it unchanged, so that the EARS_Compiler reports the specific Diagnostic.
7. IF a numbered line appears under `#### Acceptance Criteria` before any `### Requirement <n>` heading, THEN THE Extractor SHALL use `R0` as the number context, SHALL form the ID as `R0.<m>`, SHALL still return the criterion when it qualifies under criterion 1, and SHALL emit one warning Diagnostic at the line and column of the numbered line.
8. THE Extractor SHALL accept the criterion number formats `<m>.` and `<m>)` followed by at least one space, and SHALL ignore, without a Diagnostic, list items that have no leading number (such as lines starting with `-` or `*`).
9. WHEN a numbered criterion is followed by lines indented by at least one space or tab that are neither blank nor numbered, THE Extractor SHALL join each such line, with its leading whitespace removed, to the criterion text with a single space, and SHALL end the criterion at the first blank line, the next numbered line, or the next heading.
10. THE Extractor SHALL accept `\n` and `\r\n` line endings and SHALL return the same IDs, texts, line numbers and columns for both.
11. WHEN a numbered line under `#### Acceptance Criteria` starts with `FOR ALL`, THE Extractor SHALL skip the line, SHALL return no criterion for it, and SHALL emit a `NON_EARS_LINE` warning Diagnostic at the line and column of the first character of its text.
12. WHEN a file contains no `#### Acceptance Criteria` heading, or an empty input is provided, THE Extractor SHALL return an empty list of criteria and no error Diagnostic.
13. FOR ALL generated Kiro_Requirements_Files, THE Extractor SHALL return IDs that are unique and in the order the criteria appear, provided the generated file has no repeated `<n>` and `<m>` pair.

### Requirement 12: Compile a requirement into a CompiledRequirement

**User Story:** As the falsifier author, I want a compiled requirement with a scenario space and a monitor, so that I can search for counterexamples without knowing how the line was written.

#### Acceptance Criteria

1. WHEN a line produces no error Diagnostic, THE EARS_Compiler SHALL return a `CompiledRequirement` with the fields `id`, `source`, `pattern`, `space`, `perturbations`, `horizon`, `formula` and `monitor`, with the types defined in `interfaces.md`. `formula` SHALL be the STL formula the monitor computes, with its window in seconds and the predicate unit, such as `G[t₀, t₀+3 s] margin("stay upright") > 0 m`. *(Added by golem-ears-hardening, improvement 1.)*
2. WHEN the line begins with a Requirement_ID, THE EARS_Compiler SHALL set `id` to that ID without its trailing period. WHEN the line has no Requirement_ID, THE EARS_Compiler SHALL set `id` to the ID from Compile_Options, or to the empty string if Compile_Options has none.
3. THE EARS_Compiler SHALL set `source` to the input line exactly as written, character for character, including any Requirement_ID, case and whitespace.
4. THE EARS_Compiler SHALL set `pattern` to the pattern of the AST: `ubiquitous`, `event`, `state`, `unwanted` or `optional`.
5. WHEN the pattern is `event` or `unwanted`, THE EARS_Compiler SHALL set `space.dims` to the Dimensions of the matched trigger in source order. Each Dimension name SHALL be unique within `space.dims`.
6. WHEN the pattern is `ubiquitous`, `state` or `optional`, THE EARS_Compiler SHALL set `space.dims` to the Dimensions declared by the matched response or state template, or to an empty list when the template declares none. WHEN the pattern is `state`, THE EARS_Compiler SHALL match the state clause against both the predicate and the perturbation templates: one match wins, a match in both classes SHALL give an ambiguous `UNKNOWN_PHRASE`, and with no match the Diagnostics of the class that matched further into the clause SHALL be reported. A perturbation state SHALL add its Dimensions first and one `PerturbationCall`, so that `WHILE walking on a slope of up to 10 deg` searches the slope. *(Corrected by golem-ears-hardening, defect 7: WHILE accepted only predicates.)*
7. IF two Dimensions in one `space.dims` would have the same name, THEN THE EARS_Compiler SHALL emit an error Diagnostic at the second occurrence and SHALL NOT return a `CompiledRequirement`.
8. THE EARS_Compiler SHALL provide a function that compiles every criterion returned by the Extractor from a Kiro_Requirements_File, and that returns the list of `CompiledRequirement` objects in file order together with every Diagnostic from the Extractor and the compiler, in source order.
9. WHEN one criterion in a file fails to compile, THE file-level compile function SHALL still compile every other criterion and SHALL return their `CompiledRequirement` objects.
10. IF two criteria in one file have the same Requirement_ID, THEN THE file-level compile function SHALL emit one warning Diagnostic at the second criterion's line and column, and SHALL keep both `CompiledRequirement` objects in file order.
11. THE EARS_Compiler SHALL be a pure function of the line, the Lexicon and the Compile_Options. FOR ALL such inputs, compiling twice SHALL produce deeply equal `id`, `source`, `pattern`, `space`, `perturbations` and `horizon`. FOR ALL Traces, the two monitors SHALL return bit-identical `robustness`, `worstAt` and `unit` (determinism).
12. THE EARS_Compiler SHALL NOT call `Math.random()`, the network, the file system or the clock.
13. THE EARS_Compiler SHALL NOT mutate the Lexicon, the Compile_Options or the input text.
14. THE EARS_Compiler SHALL expose its public functions through the `golem-spec` entry point, and SHALL keep every field name and type in `interfaces.md` unchanged. Any field it adds SHALL be optional.

### Requirement 13: Verify the module with property-based tests

**User Story:** As a maintainer, I want the compiler checked by properties and not only by examples, so that parser and monitor bugs are found early.

#### Acceptance Criteria

1. THE test suite SHALL use Vitest for example tests and fast-check for property tests, as set in the `testing` and `tech` steering files.
2. THE test suite SHALL run each fast-check property with at least 100 generated cases and a fixed, logged seed, so that a failing case can be replayed with the same seed.
3. THE test suite SHALL include a round-trip property for the Parser and Formatter over generated valid lines of all five patterns, with and without the comma before THE, asserting that `parse(format(parse(line)))` equals `parse(line)` ignoring source offsets, and that formatting the re-parsed output returns the same text.
4. THE test suite SHALL include a property that converting a Quantity to SI and back returns the original value within a relative error of 1e-12, for every accepted unit (`N`, `kN`, `m`, `cm`, `mm`, `s`, `ms`, `m/s`, `cm/s`, `deg`, `°`, `rad`, `kg`, `g`, `%`).
5. THE test suite SHALL include a robustness soundness property that `robustness > 0` holds if and only if the predicate is satisfied at every sample in the window, on random traces, and a property that the sign of the Robustness flips when the threshold crosses the signal.
6. THE test suite SHALL include a monotonicity property that raising the threshold of an `above` predicate does not raise the Robustness on random traces.
7. THE test suite SHALL include a determinism property that compiling the same line, Lexicon and Compile_Options twice, and monitoring the same Trace twice, gives equal `space`, `perturbations` and `horizon` and bit-identical `robustness` and `worstAt`.
8. THE test suite SHALL include the metric-law properties of Token_Edit_Distance listed in Requirement 9: identity, symmetry, non-negativity, zero only for equal sequences, the triangle inequality, and the length bounds `|len(a) − len(b)| ≤ d(a, b) ≤ max(len(a), len(b))`.
9. THE test suite SHALL include a tokenizer coverage property that the Token texts and the skipped whitespace reproduce the input string, and that each Token's start and end offsets select its text.
10. THE test suite SHALL include one example test for each Diagnostic_Kind (`PATTERN_MISMATCH`, `MISSING_UNIT`, `UNKNOWN_PHRASE`, `BAD_RANGE`, `UNKNOWN_ROBOT`, `NON_EARS_LINE`) that asserts the `kind`, the one-based `line` and the one-based `column`.
11. THE test suite SHALL include an example test that extracts criteria from a Kiro-style `requirements.md` with a comma before THE, and one without the comma, each asserting the returned IDs, texts, line numbers and columns.
12. THE test suite SHALL use only synthetic Traces of at most 1000 samples, SHALL NOT import or start MuJoCo, and SHALL NOT use `Math.random()`, the network or the clock.
13. THE test suite SHALL NOT weaken an assertion or a requirement to make a test pass. IF a test is wrong, THEN the commit message SHALL state why.
14. THE test suite SHALL name each test by the behaviour it checks, such as `it('rejects a force without a unit')`.
15. THE test suite SHALL include, for every defect fixed by golem-ears-hardening, a regression test (`__tests__/regress.d<n>.test.ts`) that failed on the code before the fix, and SHALL compare exact values (`toEqual`) wherever a partial match could hide a wrong field.
16. THE test suite SHALL include a Kiro-compatibility corpus: real Kiro output styles compiled with a realistic G1 lexicon with exact expectations, and every `requirements.md` under `.kiro/specs/` of the repository compared with a committed golden summary, with no Diagnostic caused by a trailing period or markup.
17. THE test suite SHALL include metamorphic properties: equivalent spellings (`200 N` and `0.2 kN`, `200 ms` and `0.2 s`, `150 to 250 N` and `150 N to 250 N`, keyword case, a comma before THE, a trailing period, bold markup, THEN before THE) SHALL compile to equal spaces, parameters, horizons and formulas and bit-identical monitor results.
18. THE ears module SHALL export `lintLexicon`, and THE test suite SHALL check that it finds nothing in the realistic G1 lexicon, no error in generated lexicons, and each of its finding codes in an example.
