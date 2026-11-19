# Design: golem-ears-hardening

## Overview

The pipeline (tokenizer → parser → matcher → monitor builder → `CompiledRequirement`) stays. The fixes are local to each stage, plus one contract change: perturbation (and predicate) templates declare the dimension name and severity of each slot, and the compiler builds the `Dimension`s from the ranges it parsed. A realistic G1 lexicon fixture (`__tests__/g1Lexicon.ts`) is used by the regression tests, the golden corpus and the metamorphic properties, so the tests finally exercise a lexicon that looks like the apps'.

## Contract change (defects 1 and 10)

```ts
interface SlotDimension { dim: string; severity: 'up' | 'down' | 'none' }

interface PerturbationTemplate {
  phrase: string;
  slots?: Record<string, SlotDimension>;   // slot name → dimension; the compiler builds the Dimension
  maxOnset?: number;                      // s between tTrigger and the latest start of the effect
  /** @deprecated use `slots`; called only when `slots` is absent */
  dims?(slots: Record<string, Quantity | [Quantity, Quantity] | string>, ranges: Record<string, SlotRange>): Dimension[];
  apply(ctx, t, tTrigger, values): void;   // values keyed by slot name
  visual?(values): {...};
}
interface SlotRange { kind: Kind; min: number; max: number; wrap: boolean }   // SI
interface PredicateTemplate { ...; slots?: Record<string, SlotDimension>; dims?(...) }  // same rules
interface Lexicon { ...; features?: string[] }
interface CompiledRequirement { ...; formula?: string }   // always set by golem-ears
```

Slot names are the ones `compileTemplate` gives today: the kind (`force`, `duration`, `direction`, `phase`), with a numeric suffix from 2 for a repeated kind (`length2`).

### Building dimensions (`dimensions.ts`, new)

`buildDimensions(template, compiled, binding)` returns `{ dims, sources, params, diagnostics }`.

New path (`template.slots` present). For every slot of the pattern, in source order:
- Its value is a `SlotRange`: the parsed range, or a fixed quantity as `min === max` (`wrap` false).
- Declared slot: `Dimension { name: spec.dim, kind, min, max, severity: spec.severity, wrap? }` via `rangeToDimension`. `params[slot]` is the dimension name when `min < max`, else the SI value.
- Undeclared slot: fixed → `params[slot] = SI value`, no Dimension. Range with `min < max` → `BAD_LEXICON` error at the range span.

Legacy path (`dims()` only): call `dims(slots, ranges)`. Tie each returned Dimension to a slot, first match wins, each slot used once: (1) name equals the slot, (2) name ends with `.<slot>`, (3) same kind and bounds as the slot's range, (4) the only remaining Dimension of that kind and the only remaining slot of that kind. A tied slot gets `params[slot]` as above (name or `dim.min`). A tied Dimension whose bounds differ from the parsed range gets a `BAD_LEXICON` warning ("the line says …"). A searched Dimension tied to no slot gets a `BAD_LEXICON` warning. An untied fixed slot gets its SI value.

`DiagnosticKind` gains `BAD_LEXICON` (lexicon authoring problems, reported where the line exposes them).

## Kiro markup (defect 2)

`kiroText(line)` (in `tokenizer.ts`) returns the line with these characters replaced by spaces: every `*` and `` ` ``; every run of `_` that touches a word boundary on at least one side and is not inside a word (`__x__` yes, `pelvis_z` no); the last `.` when only whitespace or markup follows it and the character before it is not a `.`. The string length is unchanged, so offsets, lines and columns are exact. `compileRequirement` tokenizes and parses `kiroText(line)`; `source` stays the line as written. `tokenize` itself is unchanged, so its coverage property still holds.

The extractor's EARS-start test skips leading `*`, `_` and `` ` `` characters.

## Parser (defects 8, 13, 14.1)

- Head detection: `THE`, then 1–6 word tokens, then `SHALL`. The robot name is the words joined by one space; the span runs from the first to the last word. Comparison with `robotNames` collapses spaces and lower-cases both sides.
- Event, state, optional: after locating the head at `k`, if the tokens before it are `THEN`, `, THEN` or `THEN ,` the condition ends before them.
- `reorder` builds the ordered object directly.

## Ranges and units (defects 3, 9, 14.2, 14.3)

- `make()` drops a repeated token, so the borrowed-unit case builds its text from `[150, to, 250, N]`.
- `NUMBER_SOURCE` (string) is exported from `units.ts`; the tokenizer and `QUANTITY_TEXT` build their regexes from it.
- `quantityFromTokens`: one branch for "a token follows that is not a known unit".
- `{phase}` after `at`: besides `any point in its stride`, accepts `<q>%`, `<q>% of its stride`, `<q>% into its stride` with `0 ≤ q ≤ 100`, as a fixed phase.

## Matcher (defects 9, 12)

- `Fail` records the template index and the slot element where it failed.
- When the furthest failure is a slot failure (no specific diagnostic) of the closest template: message `'<words as written>' is not accepted by {<slot>} in "<phrase>". It accepts <forms>.`; suggestion = clause text with the rejected words (from the slot start to the next literal of the template, or the end) replaced by the slot's example form. Forms per slot kind: direction `any direction`, `behind` or an angle such as `90 deg`; phase `any point in its stride` or a percentage such as `50%`; range `up to <q>`, `<q> to <q>` or one quantity; a quantity: a number with one of the kind's units.
- Every quoted token is sliced from the clause's source text (`clause.text`), so keywords are quoted as written.

## Compiler (defects 5, 6, 7, 11, I1)

State clause: try both classes. One match wins; two → ambiguous `UNKNOWN_PHRASE`; none → keep the diagnostics of the class whose first error starts further right (predicate on a tie). A perturbation state is "applied for the whole episode": its dims and call are added and the response is monitored as ubiquitous.

Optional clause: match the normalised clause text against `Lexicon.features`; unknown → `UNKNOWN_PHRASE` with the closest feature by token edit distance (same too-far rule as templates).

Window plan (`onset` = `maxOnset` of the trigger or state template, else 0; `dur` = trigger duration):

| Pattern | Wrapper | Monitor | Horizon |
|---|---|---|---|
| event/unwanted | none | `G[t₀, t_end]` | episode |
| event/unwanted | for d | `G[t₀, t₀+onset+d]` | onset+dur+d |
| event/unwanted | within T | `F[t₀, t₀+onset+T] G[·, t_end]` | onset+dur+2T |
| ubiquitous/optional/perturbation-state | none | `G[t_start, t_end]` | episode |
| same | for d | `G[t_start, t_start+onset+d]` | onset+d |
| same | within T | `F[t_start, t_start+onset+T] G[·, t_end]` | max(episode, onset+2T) |
| predicate-state | none | `G[t_start, t_end](ψ → φ)` | episode |
| predicate-state | for d | `G[t_start, t_end](ψ → G[t, t+d] φ)` | episode |
| predicate-state | within T | rejected (`PATTERN_MISMATCH` at `within`) | — |

The event row "none" keeps today's horizon (episode).

`formula`: the table's monitor column with numbers printed in seconds (12 significant digits, trailing zeros removed) and atoms `margin("<phrase with slots filled as written>") > 0 <unit>`. A disabled WHERE gives `true (feature "<feature>" is not enabled)`. A perturbation state appends `, with "<state clause>" applied throughout`.

## Monitor (defects 4, 5, 14.4, 14.5)

`buildMonitor(spec)` takes a resolved plan:
`{ op: 'G', anchored, len? } | { op: 'FG', anchored, deadline } | { op: 'implies', len } | { op: 'true' }`.

Per call: look up signal arrays (length must equal `t.length`, else `NaN`/`signal`), find the anchor, allocate one signal record per predicate (one object per call, not per sample). The slot records are frozen copies made at build time.

- `G`: unchanged min loop; `worstAt` = first minimum.
- `FG`: one pass over `[lo, n)`: track the last sample with `m ≤ 0` and the minimum over samples from `i*` (the last sample with `t ≤ a + deadline`) to the end. Robustness = that minimum. `worstAt` = last violation if any, else the time of the minimum.
- `implies`: margins of ψ and φ go into two reusable `Float64Array` buffers (grown when a longer trace arrives, never per sample). A forward monotone deque (`Int32Array`) gives `min φ` over `[t_i, t_i+len]`; the term is `max(−ψ_i, that min)`; robustness is the minimum term; `worstAt` is the φ sample that attains it, or `t_i` when `−ψ_i` dominates. With `len = 0` this is today's state monitor.
- `NaN` margins: the first `NaN` in the evaluated range returns `NaN`, the predicate unit, its time.

## Serialisation (defect 6)

`encodeRobustness(x)`: finite → `x`; `NaN` → `"NaN"`; `Infinity` → `"Infinity"`; `-Infinity` → `"-Infinity"`. `decodeRobustness` inverts it. `monitorResultToJSON(r)` encodes `robustness` and `worstAt`.

## Linter (I5): `lint.ts`

`lintLexicon(lexicon, { samples? }) → LintFinding[]` with `{ severity: 'error' | 'warning', code, template?, message }`. Codes: `MALFORMED_PHRASE`, `AMBIGUOUS_TEMPLATES`, `UNDECLARED_SLOT`, `UNKNOWN_SLOT`, `DUPLICATE_DIMENSION`, `DEPRECATED_DIMS`, `ROBOT_NAMES`, `FEATURES`, `MARGIN_NOT_FINITE`, `UNLISTED_SIGNAL`, `SLOT_IGNORED`, `UNIT_MISMATCH`, `MARGIN_THROWS`.
- Ambiguity: build one sample clause per template (slots filled with a canonical example), tokenize it and match it against every other template of the class.
- Margin checks: signal samples are a fixed grid (each listed signal takes −1, 0, 0.5, 1, 2 in a rotating pattern) unless `samples` are given. Signal reads go through a `Proxy` that records names. Slot values are canonical examples in SI. Linearity: if `margin(s, k + δ) − margin(s, k)` equals `±δ` within 1e-9 for every sample, the unit must be the SI unit of the slot's kind.

## Tests

- One regression file per defect, `__tests__/regress.d<N>.test.ts`, written before the fix and observed failing.
- Fixed tests: the `toMatchObject` checks in `compile.test.ts` become exact `toEqual`; the WHERE example declares its feature.
- Updated properties where the spec was wrong: eventually semantics (reference monitor and soundness), horizon property, suggestion property (slot failures).
- New: golden corpus (`kiro.corpus.test.ts` with `__fixtures__/kiro-styles.md` and the golden file `__fixtures__/repo-corpus.golden.json`), linter tests, metamorphic properties (`metamorphic.property.test.ts`).

## Spec text corrections (golem-ears)

Requirements 4.11–4.12, 5.7–5.8, 6.1–6.2, 6.5, 6.9, 7.3–7.4, 7.11, 11.1, 12.5–12.6 and 3.2–3.4, 3.11 change to the behaviour above; the design's Monitor and Matcher sections get the same notes. `interfaces.md` records the contract change.
