# Proposals

Discussion about lines of `.kiro/specs/candy-sorter/requirements.md` goes here. Requirement lines are never edited to make a failing run pass.

## P1. SSM_v1 watches the suction-cup tip only (open, expected)

`controller/ssm.ts` measures the separation from the hand to the tip and nothing else, as the spec says. Lines 1.1 and 8.1 ask that every link stay at least 0.10 m from the hand. A hand that reaches in from the side, near the shoulder or the elbow, while the tip is more than 0.15 m away produces no speed reduction, so the elbow or the wrist can pass within 0.10 m of the hand. GOLEM is expected to find that counterexample. The fix belongs in a later controller spec (a link-aware separation with the Panda collision geoms, or a stop zone around the whole arm) and not in the requirement line, the monitor or the tests.

## P2. golem-ears did not pass dimensions that have no slot (closed)

`hand.angle`, `hand.entry`, `hand.height`, `tracker.lag` and `candy.<i>.x` reached `apply` only through placeholder slots that `dims()` added (`exposeDims`). golem-ears-hardening builds Dimensions from the ranges written in the line, which removes the workaround for the slots the phrase has (`direction`, `speed`, `duration`). `hand.entry`, `hand.height` and the twelve candy placements are in no phrase, and the requirement lines are never edited, so the skeleton gained one optional field: `SlotDimension.range`, a hidden slot (see `interfaces.md`, "Hidden slots"). The candy lexicon now declares `slots` on every template, no `dims()`, and `test/perturbations.test.ts` proves that every searched dimension of every requirement line appears in the compiled params. The same gap in `apps/stagger` (`push.angle` never reaching `apply`) was fixed by golem-ears-hardening defect 1 for slots the phrase carries.
## P3. Hidden `horizon` slot (open)

`hand.entry` should range over 0 s to the requirement horizon (candy-app Requirement 9.3). golem-ears does not pass the horizon to `PerturbationTemplate.dims`, so the range uses a fixed 3.0 s (`HAND_ENTRY_FALLBACK`). The lines of the file use the default 10 s episode, so the fallback only shortens the entry range.

## P4. Compile warning for `keep every link at least {length}` above 0.6 m (open)

The signal saturates at `distmax = 0.6 m`, so a length above 0.6 m can never hold. `PredicateTemplate` has no way to attach a compile warning. The margin stays `signal - length`, which is negative whatever the arm does.

## P5. `the vacuum weakens to` takes percentages for a range (record)

The phrase is `the vacuum weakens to {range:ratio}`. The golem-ears range parser needs a unit on both ends of a range, so line 7.1 reads `50% to 100%`, not `0.5 to 1`. A single value works either way (`50%`).

## P6. A tracker line needs the hand (record)

Line 8.1 uses the template `the hand tracker lags by {range:duration} and a hand reaches in from {direction} at {range:speed}`. The compiler matches one trigger clause, and a lagging tracker does nothing while no hand moves.

## P7. Tip site position (record)

The first draft of the candy-app design put the `tip` site 8 mm inside the cup, which leaves a candy at rest against the cup face 10 mm to 20 mm from the site, outside the 0.01 m engage radius. The site sits 8 mm beyond the cup face, on the candy side, so a resting candy is 0 mm to 4 mm from it. The design file records the correction.

## P8. A hand from behind passes through the Panda base (open)

The hand path runs in a straight line from the Table edge to the nearest bowl. For rom behind (135 deg to 225 deg) the edge point is on the back edge of the Table, and the line to the purple bowl at (0.72, 0) passes through the base column of the Panda at a height of 0.05 m to 0.25 m. A probe at 180 deg, 0.8 m/s, height 0.15 m gave a signed link-hand distance of -19 mm on link1 while SSM_v1 read a tip separation of 429 mm. Line 1.1 is therefore broken by any direction that crosses the base, with no need for an elbow or wrist subtlety. The candy-app design fixes this path model (Requirement 9.2), so it stays until a decision: keep it (the counterexample is real: a hand cannot be there without touching the base), route the hand around the base, or limit hand.angle to the front half-plane.
