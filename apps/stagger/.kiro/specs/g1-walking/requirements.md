# Requirements Document

## Introduction

This file holds the written requirements of the Stagger robot: a Unitree G1 humanoid (12-DOF legs, `g1_12dof`) walking under Unitree's published locomotion policy. GOLEM reads every numbered acceptance criterion below, compiles it against the lexicon in `apps/stagger/lexicon.ts`, and searches for a counterexample in MuJoCo. `golem check`, `golem test` and `golem falsify` read this file for the app `stagger`.

Each trigger states the harshest value we believe the robot should survive, or, for an Expected_Break line, a value we believe it cannot. The falsifier finds the boundary. A held line means "no counterexample found within the stated search budget", never a proof.

Every trial walks with the default command (0.5 m/s forward) unless a line commands another speed. The perturbation starts at the trigger, after a 2 s warm-up.

Lines are never edited to make a failing run pass. Discussion about a line goes in `apps/stagger/proposals.md`.

## Glossary

- **G1 / robot / golem**: The simulated Unitree G1 with the walking policy.
- **Upright**: Pelvis at least 0.5 m above the floor and tilted no more than 60 deg from vertical.
- **Push direction**: The side the push comes from, counterclockwise from the robot's heading at the trigger: 0 deg from the front, 90 deg from its left, 180 deg from behind, 270 deg from its right. `from behind` covers 135 deg to 225 deg. The force points away from that side.
- **Stride point**: The gait phase (0 to 1 over the 0.8 s gait period) at which a push starts.
- **Expected_Hold**: A line the controller is expected to satisfy within the search budget.
- **Expected_Break**: A line for which the falsifier is expected to find a counterexample.

| Criterion | Topic | Expectation |
|---|---|---|
| 1.1 | Push recovery | Expected_Hold |
| 1.2 | Push recovery | Expected_Break |
| 1.3 | Push recovery | Expected_Hold |
| 2.1 | Speed tracking | Expected_Hold |
| 2.2 | Speed tracking | Expected_Hold |
| 3.1 | Slopes | Expected_Hold |
| 4.1 | Payload | Expected_Hold |
| 4.2 | Payload | Expected_Break |
| 5.1 | Slipping | Expected_Hold |
| 6.1 | Sensor latency | Expected_Hold |
| 6.2 | Sensor latency | Expected_Break |

## Requirements

### Requirement 1: Recover from pushes

**User Story:** As a visitor shoving the robot, I want it to stay on its feet after a push, so that it can walk among people.

#### Acceptance Criteria

1. WHEN the pelvis is pushed with up to 60 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s
2. WHEN the pelvis is pushed with up to 250 N for 0.2 s from behind at any point in its stride THE robot SHALL stay upright for 3 s
3. WHEN the pelvis is pushed with up to 100 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s

### Requirement 2: Track the commanded speed

**User Story:** As an operator, I want the robot to walk at the speed I command on level ground, so that its motion is predictable.

#### Acceptance Criteria

1. THE robot SHALL track the commanded speed within 0.15 m/s
2. WHEN commanded to walk at 0 m/s to 0.8 m/s THE robot SHALL stay upright for 5 s

### Requirement 3: Walk on slopes

**User Story:** As an operator, I want the robot to keep walking on ramps, so that it can use ordinary buildings.

#### Acceptance Criteria

1. WHEN walking on a slope of up to 8 deg THE robot SHALL stay upright for 5 s

### Requirement 4: Carry a payload

**User Story:** As an operator, I want the robot to carry a load on its torso, so that it can do useful work.

#### Acceptance Criteria

1. WHEN carrying a payload of up to 10 kg THE robot SHALL stay upright for 5 s
2. WHEN carrying a payload of up to 20 kg THE robot SHALL stay upright for 5 s

### Requirement 5: Keep walking on a slippery floor

**User Story:** As an operator, I want the robot to keep its footing on a polished or wet floor, so that a spill does not knock it over.

#### Acceptance Criteria

1. WHEN the floor friction drops to 30% THE robot SHALL stay upright for 5 s

### Requirement 6: Tolerate sensor latency

**User Story:** As a controls engineer, I want the robot to survive delayed sensor readings, so that it tolerates a slow onboard computer or bus.

#### Acceptance Criteria

1. WHEN the sensor latency rises to up to 40 ms THE robot SHALL stay upright for 5 s
2. WHEN the sensor latency rises to up to 100 ms THE robot SHALL stay upright for 5 s

## Notes

- **1.3 is Expected_Hold (team decision).** 1.3 started as an Expected_Break line: Unitree's walking policy alone breaks it, and the falsifier found the counterexample. Kiro's balance reflex (`GOLEM_REFLEX=kiro`, written by the golem-tuner agent) now exists, so the team treats 1.3 as a real requirement the robot must meet, not a known gap. The line itself is unchanged; only its row in the Expectation table moved from Expected_Break to Expected_Hold.
- With that row, `golem gate` on Unitree's policy alone (the default) is red because 1.3 breaks, and `GOLEM_REFLEX=kiro golem gate` is the configuration expected to be green.
- 1.2, 4.2 and 6.2 stay Expected_Break. `golem gate` passes each of them when the falsifier finds a counterexample and fails it when the line holds within the search budget.
