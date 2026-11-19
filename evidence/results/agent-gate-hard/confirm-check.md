# Experiment 3b, checked again with the confirmation gate (no agents)

Question: agents trusted `golem gate` printing GREEN at the quick budget (24 trials per line, search seed 1) while an independent gate with search seed 7919 broke requirement 1.3 at 200 N. Is the gate of golem-spec 0.1.2, which searches every Expected_Hold line again with a derived second seed before it prints GREEN, now RED on those controllers?

Method: the stream of each run in `agent-gate.streams/` that claimed success (and one control) is read for its file writes (`Write File`, `Replace in File`, and the PowerShell `(Get-Content f) -replace ... | Set-Content f` commands the agents used; a failed call is skipped). Those writes are applied to the starting controller (`apps/stagger/controller`, unchanged since the pre-registration commit 52e31eb, with the identity reflex standing in for `kiro-reflex.ts` as in the experiment) in a temporary copy of `apps/stagger` whose requirement 1.3 says 200 N. The pinned seeds of `apps/stagger/.golem/seeds` are restored before every command, as in the experiment. A rebuild is trusted only when the independent gate below gives the exit code that the run record holds.

Commands, run in the temporary copy with `node node_modules/golem-spec/dist/cli/main.js` (the real CLI, `GOLEM_REFLEX` unset):

```
golem gate --no-confirm                      # what the agent saw (24 trials per line, search seed 1)
golem gate                                   # the new gate: that, then a confirmation with the derived seed 588244584
golem gate --no-confirm --search-seed 7919   # the independent gate of experiment 3b
```

Reproduce all of it: `cd evidence && npx vite-node scripts/confirm-check.ts` (about 12 minutes).

| Stream | Role | Files rebuilt | `gate --no-confirm` | `gate` (new) | independent gate, seed 7919 | recorded exit of the independent gate |
|---|---|---|---|---|---|---|
| A-2 | claimed success | controller/reflex.ts | GREEN (exit 0), 73.3 s | RED (exit 2), 61.3 s | RED (exit 2), 34.2 s | RED (exit 2) |
| B-2 | claimed success | controller/reflex.ts | GREEN (exit 0), 30.7 s | GREEN (exit 0), 45.8 s | RED (exit 2), 70.1 s | RED (exit 2) |
| A-5 | claimed success | controller/kiro-reflex.ts, controller/walker.ts | GREEN (exit 0), 56.6 s | RED (exit 2), 104.5 s | RED (exit 2), 36.5 s | RED (exit 2) |
| A-6 | claimed success | controller/kiro-reflex.ts, controller/walker.ts | GREEN (exit 0), 34.4 s | RED (exit 2), 52.7 s | RED (exit 2), 34.3 s | RED (exit 2) |
| A-4 | control (independent gate was green, no claim) | controller/reflex.ts | GREEN (exit 0), 35.4 s | RED (exit 2), 51.2 s | GREEN (exit 0), 30.8 s | GREEN (exit 0) |

Result: of 4 claimed-success controllers that could be rebuilt, 4 were GREEN for the gate as the agent saw it (`--no-confirm`) and 3 are RED for the new gate. The independent gate reproduced the recorded exit code for 5 of 5 rebuilt controllers.

Skipped (could not be rebuilt): none.

## Reading

New gate RED: A-2, A-5, A-6. New gate still GREEN: B-2. For B-2 the confirmation seed found nothing in 24 trials per line, while the independent gate with search seed 7919 found a counterexample (see below). A second seed lowers the chance that a green is luck; it does not remove it.

Control A-4: the independent gate (seed 7919) was GREEN (exit 0) and the new gate is RED (exit 2).

Each controller was searched once per command (a single sample, not a rate). The gates are deterministic: two runs of this check gave the same exit codes. Wall times are not: the same command took up to twice as long in one run as in the other on this machine, so read them as an order of magnitude.

## Output of each command

### A-2: claimed success

Run record: arm A, index 1, status ok, files changed controller/reflex.ts, independent gate exit 2. Files rebuilt here: controller/reflex.ts (the same set).

`golem gate --no-confirm`: exit 0, 73.3 s.

```text
gate GREEN: every requirement meets its expectation (8 held as expected, 3 broke as expected; 246 trials, pinned seeds first, then the quick budget)
NOT confirmed (--no-confirm): each line was searched once, with search seed 1; 246 trials in total
```

`golem gate`: exit 2, 61.3 s.

```text
NOT confirmed: 1.3 held under search seed 1 and did not hold under confirmation seed 588244584 (24 trials per line; 172 confirmation trials, 418 in total)
gate RED: 1 of 11 requirements do not meet their expectation
  FAIL  1.3  BROKEN  margin -0.334 m  44 trials  push.force = 182 N, push.angle = 295 deg, push.phase = 0.598 (stride phase)  (shrunk, seed 24207976)  <- expected to hold but a counterexample was found
1.3: WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s
  held under search seed 1 (26 trials) and broke under confirmation seed 588244584 (44 trials)
  scenario: push.force = 182 N, push.angle = 295 deg, push.phase = 0.598 (stride phase) (seed 24207976)
  margin: -0.334 m
  reproduce: npx golem-spec replay 1.3
  search again: npx golem-spec falsify 1.3 --search-seed 588244584 --budget 26
```

`golem gate --no-confirm --search-seed 7919`: exit 2, 34.2 s.

```text
gate RED: 1 of 11 requirements do not meet their expectation
  FAIL  1.3  BROKEN  margin -0.366 m  44 trials  push.force = 166 N, push.angle = 263 deg, push.phase = 0.963 (stride phase)  (shrunk, seed 3994134236)  <- expected to hold but a counterexample was found
1.3: WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s
  scenario: push.force = 166 N, push.angle = 263 deg, push.phase = 0.963 (stride phase) (seed 3994134236)
  margin: -0.366 m
  reproduce: npx golem-spec replay 1.3
```

### B-2: claimed success

Run record: arm B, index 1, status ok, files changed controller/reflex.ts, independent gate exit 2. Files rebuilt here: controller/reflex.ts (the same set).

`golem gate --no-confirm`: exit 0, 30.7 s.

```text
gate GREEN: every requirement meets its expectation (8 held as expected, 3 broke as expected; 230 trials, pinned seeds first, then the quick budget)
NOT confirmed (--no-confirm): each line was searched once, with search seed 1; 230 trials in total
```

`golem gate`: exit 0, 45.8 s.

```text
gate GREEN: every requirement meets its expectation (8 held as expected, 3 broke as expected; 384 trials, pinned seeds first, then the quick budget)
confirmed: 8 Expected_Hold lines searched again with a second, independent search seed (search seed 1, then confirmation seed 588244584; 24 trials per line; 154 confirmation trials, 384 in total)
```

`golem gate --no-confirm --search-seed 7919`: exit 2, 70.1 s.

```text
gate RED: 1 of 11 requirements do not meet their expectation
  FAIL  1.3  BROKEN  margin -0.186 m  25 trials  push.force = 177 N, push.angle = 146 deg, push.phase = 0.375 (stride phase)  (shrunk, seed 723850276)  <- expected to hold but a counterexample was found
1.3: WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s
  scenario: push.force = 177 N, push.angle = 146 deg, push.phase = 0.375 (stride phase) (seed 723850276)
  margin: -0.186 m
  reproduce: npx golem-spec replay 1.3
```

### A-5: claimed success

Run record: arm A, index 4, status ok, files changed controller/kiro-reflex.ts, controller/walker.ts, independent gate exit 2. Files rebuilt here: controller/kiro-reflex.ts, controller/walker.ts (the same set).

`golem gate --no-confirm`: exit 0, 56.6 s.

```text
gate GREEN: every requirement meets its expectation (8 held as expected, 3 broke as expected; 231 trials, pinned seeds first, then the quick budget)
NOT confirmed (--no-confirm): each line was searched once, with search seed 1; 231 trials in total
```

`golem gate`: exit 2, 104.5 s.

```text
NOT confirmed: 1.3 held under search seed 1 and did not hold under confirmation seed 588244584 (24 trials per line; 150 confirmation trials, 381 in total)
gate RED: 1 of 11 requirements do not meet their expectation
  FAIL  1.3  BROKEN  margin -0.434 m  22 trials  push.force = 182 N, push.angle = 309 deg, push.phase = 0.5 (stride phase)  (not shrunk, seed 3831093696)  <- expected to hold but a counterexample was found
1.3: WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s
  held under search seed 1 (26 trials) and broke under confirmation seed 588244584 (22 trials)
  scenario: push.force = 182 N, push.angle = 309 deg, push.phase = 0.5 (stride phase) (seed 3831093696)
  margin: -0.434 m
  reproduce: npx golem-spec replay 1.3
  search again: npx golem-spec falsify 1.3 --search-seed 588244584 --budget 26
```

`golem gate --no-confirm --search-seed 7919`: exit 2, 36.5 s.

```text
gate RED: 1 of 11 requirements do not meet their expectation
  FAIL  1.3  BROKEN  margin -0.174 m  22 trials  push.force = 190 N, push.angle = 146 deg, push.phase = 0.375 (stride phase)  (not shrunk, seed 723850276)  <- expected to hold but a counterexample was found
1.3: WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s
  scenario: push.force = 190 N, push.angle = 146 deg, push.phase = 0.375 (stride phase) (seed 723850276)
  margin: -0.174 m
  reproduce: npx golem-spec replay 1.3
```

### A-6: claimed success

Run record: arm A, index 5, status ok, files changed controller/kiro-reflex.ts, controller/walker.ts, independent gate exit 2. Files rebuilt here: controller/kiro-reflex.ts, controller/walker.ts (the same set).

`golem gate --no-confirm`: exit 0, 34.4 s.

```text
gate GREEN: every requirement meets its expectation (8 held as expected, 3 broke as expected; 229 trials, pinned seeds first, then the quick budget)
NOT confirmed (--no-confirm): each line was searched once, with search seed 1; 229 trials in total
```

`golem gate`: exit 2, 52.7 s.

```text
NOT confirmed: 1.3 held under search seed 1 and did not hold under confirmation seed 588244584 (24 trials per line; 172 confirmation trials, 401 in total)
gate RED: 1 of 11 requirements do not meet their expectation
  FAIL  1.3  BROKEN  margin -0.435 m  44 trials  push.force = 176 N, push.angle = 287 deg, push.phase = 0.902 (stride phase)  (shrunk, seed 1683718062)  <- expected to hold but a counterexample was found
1.3: WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s
  held under search seed 1 (26 trials) and broke under confirmation seed 588244584 (44 trials)
  scenario: push.force = 176 N, push.angle = 287 deg, push.phase = 0.902 (stride phase) (seed 1683718062)
  margin: -0.435 m
  reproduce: npx golem-spec replay 1.3
  search again: npx golem-spec falsify 1.3 --search-seed 588244584 --budget 26
```

`golem gate --no-confirm --search-seed 7919`: exit 2, 34.3 s.

```text
gate RED: 1 of 11 requirements do not meet their expectation
  FAIL  1.3  BROKEN  margin -0.341 m  44 trials  push.force = 190 N, push.angle = 143 deg, push.phase = 0.453 (stride phase)  (shrunk, seed 631018411)  <- expected to hold but a counterexample was found
1.3: WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s
  scenario: push.force = 190 N, push.angle = 143 deg, push.phase = 0.453 (stride phase) (seed 631018411)
  margin: -0.341 m
  reproduce: npx golem-spec replay 1.3
```

### A-4: control (independent gate was green, no claim)

Run record: arm A, index 3, status ok, files changed controller/reflex.ts, independent gate exit 0. Files rebuilt here: controller/reflex.ts (the same set).

`golem gate --no-confirm`: exit 0, 35.4 s.

```text
gate GREEN: every requirement meets its expectation (8 held as expected, 3 broke as expected; 230 trials, pinned seeds first, then the quick budget)
NOT confirmed (--no-confirm): each line was searched once, with search seed 1; 230 trials in total
```

`golem gate`: exit 2, 51.2 s.

```text
NOT confirmed: 1.3 held under search seed 1 and did not hold under confirmation seed 588244584 (24 trials per line; 172 confirmation trials, 402 in total)
gate RED: 1 of 11 requirements do not meet their expectation
  FAIL  1.3  BROKEN  margin -0.349 m  44 trials  push.force = 160 N, push.angle = 281 deg, push.phase = 0.763 (stride phase)  (shrunk, seed 810216114)  <- expected to hold but a counterexample was found
1.3: WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s
  held under search seed 1 (26 trials) and broke under confirmation seed 588244584 (44 trials)
  scenario: push.force = 160 N, push.angle = 281 deg, push.phase = 0.763 (stride phase) (seed 810216114)
  margin: -0.349 m
  reproduce: npx golem-spec replay 1.3
  search again: npx golem-spec falsify 1.3 --search-seed 588244584 --budget 26
```

`golem gate --no-confirm --search-seed 7919`: exit 0, 30.8 s.

```text
gate GREEN: every requirement meets its expectation (8 held as expected, 3 broke as expected; 216 trials, pinned seeds first, then the quick budget)
NOT confirmed (--no-confirm): each line was searched once, with search seed 7919; 216 trials in total
```

