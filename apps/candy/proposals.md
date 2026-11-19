# Proposals

Discussion about lines of `.kiro/specs/candy-sorter/requirements.md` goes here. Requirement lines are never edited to make a failing run pass.

## P1. SSM_v1 watches the suction-cup tip only (open, expected)

`controller/ssm.ts` measures the separation from the hand to the tip and nothing else, as the spec says. Lines 1.1 and 8.1 ask that every link stay at least 0.10 m from the hand. A hand that reaches in from the side, near the shoulder or the elbow, while the tip is more than 0.15 m away produces no speed reduction, so the elbow or the wrist can pass within 0.10 m of the hand. GOLEM is expected to find that counterexample. P8 records the measured result against the doorstep hand paths: line 1.1 does break, with link7 and the stop distance as the cause, not a link unmonitored while the tip is far. The fix belongs in a later controller spec (a link-aware separation with the Panda collision geoms, or a stop zone around the whole arm) and not in the requirement line, the monitor or the tests.

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

## P8. Hand paths: a hand enters from the doorstep half only (closed, with a measurement)

The first path model ran the hand in a straight line from the Table edge on the ray at `hand.angle` to the nearest bowl. For `from behind` and for any angle in the half-plane of the base, the line crossed the Panda base column (a probe at 180°, 0.8 m/s, 0.15 m height read -19 mm on link1 while SSM_v1 saw the tip 429 mm away). That counterexample was a hand standing where the robot is, so it said nothing about SSM_v1.

Decision (the user's): trick-or-treaters stand on the doorstep side of the Table, so a hand enters only through the edge that faces away from the base (x = 1.00 m), across an arc of 120° (-60° to +60°), reaches toward the bowl nearest its entry point at 0.05 m to 0.25 m above the Table, and cannot cross the base column. `from any direction` means that arc in this app. It is documented in `lexicon.ts` and the Glossary of the requirements file. The requirement lines are unchanged. `hand.angle` is now the position across the arc (see `doorstepAzimuth` in `geometry.ts`), so a reported `hand.angle` is not a compass bearing: azimuth = -60° + 120° x (1 - |hand.angle / 180° - 1|). Properties in `test/p28-hand-path.test.ts` check the arc, the edge, the path and the base column.

Measurement of SSM_v1 against the new paths (`evidence/candy-p8-doorstep.ts`, raw rows in `evidence/results/candy-p8-doorstep.jsonl`; real runner, line 1.1, hand speed 0.8 m/s, 228 trials: 108 on a grid over the arc ends and middle, 3 heights and 3 entry times, 120 random):

- Line 1.1 breaks in 57 of 228 trials (25%). The worst case is -0.066 m (the hand overlaps link7), with the tip 0.099 m from the hand.
- The closest link at the minimum is link7 in 48 breaks and the cup in 9. link4, link5 and link6 are never the closest link in a break.
- The predicted mechanism did not occur. While the tip was still at least 0.40 m from the hand, so SSM_v1 had not slowed the arm, the smallest link-hand distance in any trial was 0.259 m. SSM_v1 does slow and then stop the arm. The breaks happen at the end of that slowdown. In 40 of the 57 the tip separation is 0.140 m to 0.151 m (the arm has stopped at the 0.15 m stop distance) and the closest link is link7, the wrist flange, in every one; the hand height is 0.15 m to 0.25 m in all of them. The tip works at 0.01 m to 0.10 m above the Table and link7 sits about 0.1 m above the tip, so a hand at 0.15 m to 0.25 m is up to 0.1 m closer to link7 than to the tip, and link7 ends 0.019 m to 0.099 m from the hand while SSM_v1 reads 0.15 m. In the other 17 the hand walks on after the arm has stopped (13 of them with the hand entering at about 3 s) and the tip separation falls to 0.005 m to 0.14 m.
- So the defect is real, and it is a link other than the cup (link7, not the elbow or link4 to link6), but the mechanism is the stop distance, not a link that stays unmonitored while the tip is far. A link-aware separation, or a stop distance of at least 0.15 m plus the height offset of the wrist, would fix the first part. The second part (a hand that keeps coming at a stopped arm) needs a retreat, which no v1 line asks for.

Nothing was forced: the lines, the monitor and SSM_v1 are untouched.
