---
inclusion: always
---
# Product: GOLEM

A golem is clay brought to life by a written word. GOLEM is a Kiro skeleton that brings robot code to life the same way: **the EARS acceptance criteria in a Kiro spec become physics property tests**, run in MuJoCo inside the browser or Node.

## What it does
1. Reads EARS lines from `.kiro/specs/*/requirements.md` (the same file Kiro writes), e.g.
   `WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction THE robot SHALL stay upright for 3 s`.
2. Compiles each line, against the app's *lexicon* (its signals and perturbations), into:
   - a **scenario space**: the ranges in the trigger clause, such as force 0–200 N, angle 0–360°, gait phase 0–1;
   - a **monitor** with quantitative (robustness) semantics: positive means it held, negative means it broke, and the magnitude is the margin in physical units.
3. **Falsifies**: random trials first, then cross-entropy search toward the lowest margin, then **shrinking** to the mildest scenario that still fails ("falls from 168 N at 135°, 62% into the stride").
4. Saves each counterexample as a pinned regression seed. Seeds always re-run first, like a property-testing database.
5. **Gates the agent**: a Kiro `agentStop` hook runs `golem gate`. A task can't be called done while any requirement is red.

## Who it is for
Robotics engineers and students who use AI coding agents to write controllers, and anyone who must show evidence that a robot meets its written requirements. Today a robot controller ships with a demo video. GOLEM makes it ship with a falsification report tied, line by line, to the spec.

## Two apps built on the skeleton (Skeleton Crew)
- `apps/stagger`: a Unitree G1 humanoid running Unitree's published walking policy. Visitors shove it. The requirements cover push recovery, speed tracking, slopes, payload, slipping and sensor latency.
- `apps/candy`: a Franka Panda with a suction cup that sorts Halloween candy into bowls while trick-or-treaters' hands reach into the workspace. The requirements cover task success and speed-and-separation safety near hands.

## Voice
Plain, exact and physical. Always give units. Say what broke, by how much, and how to reproduce it. Spooky flavour belongs in names and visuals, never in error messages or numbers.

## Non-goals
- GOLEM does not prove a requirement holds. A pass means "no counterexample found within this search budget", stated with the budget.
- GOLEM never calls an LLM at runtime to decide a verdict. Verdicts come only from deterministic monitors.
