# Requirements Document

## Introduction

This file holds the written requirements of the hover drone: a Skydio X2 quadrotor that holds a hover point 1.0 m above the floor while wind gusts, a sagging battery and a lagging position estimate act on it. GOLEM reads every numbered acceptance criterion below, compiles it against the lexicon in `apps/hover/lexicon.ts`, and searches for a counterexample in MuJoCo. `golem check`, `golem test` and `golem falsify` read this file for the app `hover`.

Each trigger states the harshest value we believe the drone should survive, or, for an Expected_Break line, a value we believe it cannot. The falsifier finds the boundary. A held line means "no counterexample found within the stated search budget", never a proof.

Every trial starts with a 2 s warm-up in which the drone settles on the hover point and nothing acts on it. The perturbation starts at the trigger, after the warm-up.

Lines are never edited to make a failing run pass. A broken line leads to a controller change in a later spec or to an entry in `apps/hover/proposals.md`.

## Glossary

- **drone / robot / quadrotor / X2**: The simulated Skydio X2 (1.325 kg, four rotors, up to 13 N of thrust each) under the cascaded PD controller in `apps/hover/controller/`.
- **Hover point**: The point 1.0 m above the floor at the origin, drawn as a small marker on the stage.
- **Gust**: A horizontal force on the body for a fixed time. Its direction is the side it comes from, counterclockwise from +x seen from above (0 deg from +x, 90 deg from +y), the same convention as the G1's push direction. The force points away from that side. `from any direction` searches 0 deg to 360 deg.
- **Battery sags to a ratio**: Every rotor makes that fraction of the thrust it was commanded, and its largest thrust falls by the same fraction. The controller is not told.
- **Position estimate lag**: The controller's position and velocity estimate is the true state of that many seconds ago. The orientation and the body rates are not delayed.
- **Tilt**: The angle between the body's up axis and vertical.
- **Expected_Hold**: A line the controller is expected to satisfy within the search budget.
- **Expected_Break**: A line for which the falsifier is expected to find a counterexample.

| Criterion | Topic | Expectation |
|---|---|---|
| 1.1 | Small gusts | Expected_Hold |
| 1.2 | Gust tilt | Expected_Hold |
| 1.3 | Strong gusts | Expected_Break |
| 2.1 | Battery sag | Expected_Hold |
| 3.1 | Short estimate lag | Expected_Hold |
| 3.2 | Long estimate lag | Expected_Break |

## Requirements

### Requirement 1: Hold the hover point in wind

**User Story:** As a pilot filming from a fixed point, I want the drone to stay put when a gust hits it, so that the shot does not drift and the drone does not tip.

#### Acceptance Criteria

1. WHEN a gust of up to 2 N hits it for 0.5 s from any direction THE drone SHALL stay within 0.25 m of its hover point for 4 s
2. WHEN a gust of up to 3 N hits it for 0.5 s from any direction THE drone SHALL keep its tilt below 30 deg for 4 s
3. WHEN a gust of up to 20 N hits it for 0.5 s from any direction THE drone SHALL stay within 1.0 m of its hover point for 4 s

### Requirement 2: Keep flying on a weak battery

**User Story:** As a pilot flying a long mission, I want the drone to keep its height as the battery sags, so that it does not sink toward the people below.

#### Acceptance Criteria

1. WHEN the battery sags to 60% to 100% THE drone SHALL stay above 0.5 m for 4 s

### Requirement 3: Tolerate a late position estimate

**User Story:** As an integrator of the positioning camera, I want the drone to hold its point when the position estimate arrives late, so that a slow camera pipeline does not make it swing.

#### Acceptance Criteria

1. WHEN a gust of up to 2 N hits it for 0.5 s from any direction while the position estimate lags by up to 0.10 s THE drone SHALL stay within 0.35 m of its hover point for 4 s
2. WHEN a gust of up to 2 N hits it for 0.5 s from any direction while the position estimate lags by up to 0.30 s THE drone SHALL stay within 0.35 m of its hover point for 4 s
