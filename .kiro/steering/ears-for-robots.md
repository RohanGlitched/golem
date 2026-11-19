---
inclusion: fileMatch
fileMatchPattern: ["**/requirements.md", "skeleton/src/ears/**", "**/lexicon.ts"]
---
# EARS for robots (the GOLEM dialect)

GOLEM accepts Kiro's five EARS patterns. Each must name a quantity with a unit wherever a number appears.

| Pattern | Shape | Compiles to |
|---|---|---|
| Ubiquitous | `THE <robot> SHALL <response>` | response must hold for the whole episode after warm-up |
| Event | `WHEN <trigger> THE <robot> SHALL <response>` | the trigger is injected; the response is checked over the window that follows |
| State | `WHILE <state> THE <robot> SHALL <response>` | at every instant: if the state holds, the response holds |
| Unwanted | `IF <fault> THEN THE <robot> SHALL <response>` | the fault is injected like a trigger |
| Optional | `WHERE <feature> THE <robot> SHALL <response>` | applies only when the app config enables the feature |

## Triggers define the search space
Ranges in a trigger are what the falsifier explores:
- `with up to 200 N`: force ∈ [0, 200] N. Severity rises with force.
- `with 150 to 250 N`: force ∈ [150, 250] N.
- `from any direction`: angle ∈ [0°, 360°). `from behind`: angle ∈ [135°, 225°].
- `at any point in its stride`: gait phase ∈ [0, 1).
- `for 0.2 s`: a fixed value, not searched.

## Responses define the monitor
The response is a temporal phrase over a lexicon predicate:
- `stay upright for 3 s`: always over [t₀, t₀+3 s].
- `drop the candy into its bowl within 6 s`: eventually within [t₀, t₀+6 s].
- `keep every link at least 0.10 m from the hand`: always, over the active window.
- `track the commanded speed within 0.15 m/s`: always, |v − v_cmd| ≤ 0.15 m/s, after a settling time the lexicon defines.

## Lexicon
Each app's `lexicon.ts` lists its phrases as templates with typed slots: `{force}`, `{duration}`, `{length}`, `{speed}`, `{angle}`, `{mass}`, `{ratio}`, `{range:<kind>}`, `{direction}`. A line that matches no template is a **compile error with a suggestion**: the closest template, by token edit distance. Never guess.

## Units
SI internally. Accepted: N, kN, m, cm, mm, s, ms, m/s, cm/s, deg / °, rad, kg, g, %. Reject unitless numbers, except counts ("3 candies") and ratios declared as `{ratio}`.

## Style when writing requirements
- One behaviour per line. Give the requirement ID first: `R3.` or `1.2`, matching Kiro's numbering.
- Put the harshest believable value in the trigger. The falsifier finds the boundary; you don't have to.
- Never edit a requirement to make a failing test pass. Change the controller or open a discussion in `proposals.md`.
