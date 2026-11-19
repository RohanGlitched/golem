# Proposals

Discussion about lines of `.kiro/specs/candy-sorter/requirements.md` goes here. Requirement lines are never edited to make a failing run pass.

## P1. SSM_v1 watches the suction-cup tip only (open, expected)

`controller/ssm.ts` measures the separation from the hand to the tip and nothing else, as the spec says. Lines 1.1 and 8.1 ask that every link stay at least 0.10 m from the hand. A hand that reaches in from the side, near the shoulder or the elbow, while the tip is more than 0.15 m away produces no speed reduction, so the elbow or the wrist can pass within 0.10 m of the hand. GOLEM is expected to find that counterexample. The fix belongs in a later controller spec (a link-aware separation with the Panda collision geoms, or a stop zone around the whole arm) and not in the requirement line, the monitor or the tests.

## P2. golem-ears does not pass dimensions that have no slot (workaround in place)

The compiler turns a slot into a perturbation parameter only when a Dimension name ends with the slot name. `hand.angle`, `hand.entry`, `hand.height`, `tracker.lag` and `candy.<i>.x` have no slot of their own, so `apply` and `begin` would never receive them. `perturbations.ts` adds placeholder slots from inside `dims()` (`exposeDims`) so that the compiler passes them. The same gap exists in `apps/stagger`: `push.angle` never reaches `apply` for `from any direction`. A change in `compile.ts` that passes every Dimension of the trigger as a parameter makes the workaround unnecessary.

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
