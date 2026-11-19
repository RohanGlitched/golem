# Requirements Document

## Introduction

This file holds the written requirements of the candy sorter: a Franka Panda with a suction cup that sorts six pieces of Halloween candy into three bowls by colour on a doorstep table, while trick-or-treaters' hands may reach in. GOLEM reads every numbered acceptance criterion below, compiles it against the lexicon in `apps/candy/lexicon.ts`, and searches for a counterexample in MuJoCo. `golem check`, `golem test` and `golem falsify` read this file for the app `candy`.

Each trigger states the harshest value we believe the sorter should survive: a hand at up to 1.5 m/s, candies from 0.005 kg to 0.060 kg, a vacuum that falls to 50%, a hand tracker that lags by up to 0.3 s. The falsifier finds the boundary. A held line means "no counterexample found within the stated search budget", never a proof.

Every trial starts with a 1.0 s warm-up in which candies settle and no perturbation acts. Speed-and-separation monitoring version 1 (SSM_v1) measures the distance from the hand to the suction-cup tip only. It watches no other link. Lines 1.1 and 8.1 ask for more than that, and a broken result is a valid outcome.

Lines are never edited to make a failing run pass. A broken line leads to a controller change in a later spec or to an entry in `apps/candy/proposals.md`.

## Glossary

- **arm / robot / Panda**: The simulated Franka Panda with the suction cup.
- **Hand**: A mocap hand with a palm sphere (0.05 m radius) and a forearm capsule (0.04 m radius, 0.30 m long) that collides with nothing.
- **Link**: Any of the Panda links `link0` to `link7` and the suction cup. The distance to the hand is measured from the collision geoms of these links.
- **Doorstep**: The side of the Table that faces away from the Panda base (the edge at x = 1.00 m). Trick-or-treaters stand there, so a Hand enters only through that edge.
- **from any direction**: In this app, every direction a trick-or-treater can come from: an arc of 120° on the Doorstep side, from -60° to +60° about straight out from the base. A Hand enters on the Doorstep edge, reaches toward the bowl nearest to its entry point at 0.05 m to 0.25 m above the Table, and never passes the base column. The compiler gives `from any direction` the range 0° to 360° for `hand.angle`; the app reads it as the position across the arc (0° is the -60° end, 90° is straight on, 180° is the +60° end, 360° is the -60° end again), so a counterexample's `hand.angle` is not a compass bearing. `from behind` has no meaning here and is folded onto the same arc.
- **Tip**: The `tip` site at the end of the suction cup. SSM_v1 reads the distance from the Tip to the hand.
- **Sorted**: A candy that rests (below 0.05 m/s) inside the bowl of its colour.
- **Dropped outside**: A candy that lies low (below 0.04 m) outside every bowl and the tray, including the floor.
- **Expected_Hold**: A line the controller is expected to satisfy within the search budget.
- **Expected_Break**: A line for which the falsifier is expected to find a counterexample.

| Criterion | Topic | Expectation |
|---|---|---|
| 1.1 | Separation from the hand | Expected_Break |
| 2.1 | Fastest link near a hand | Expected_Hold |
| 3.1 | Table contact force | Expected_Hold |
| 4.1 | Candies dropped outside the bowls | Expected_Hold |
| 5.1 | Sorting success | Expected_Hold |
| 6.1 | Heavier candies | Expected_Hold |
| 7.1 | Weaker vacuum | Expected_Hold |
| 8.1 | Lagging hand tracker | Expected_Break |

## Requirements

### Requirement 1: Keep clear of the hand

**User Story:** As a trick-or-treater reaching for candy, I want every part of the arm to stay clear of my hand, so that the arm cannot knock into me.

#### Acceptance Criteria

1. WHEN a hand reaches in from any direction at up to 1.5 m/s THE arm SHALL keep every link at least 0.10 m from the hand

### Requirement 2: Move slowly near a hand

**User Story:** As a trick-or-treater reaching for candy, I want the arm to stay slow while my hand is in the workspace, so that any contact is gentle.

#### Acceptance Criteria

1. WHEN a hand reaches in from any direction at up to 1.5 m/s THE arm SHALL keep its fastest link below 1.0 m/s

### Requirement 3: Do not press on the table

**User Story:** As an owner of the doorstep table, I want the arm to leave the table alone, so that the table and the arm are not damaged when a candy lies close to the edge of the tray.

#### Acceptance Criteria

1. WHEN candies land anywhere on the tray THE arm SHALL never press on the table with more than 20 N

### Requirement 4: Keep candy in the bowls

**User Story:** As a host handing out candy, I want no candy to fall off the table, so that nothing ends up on the floor.

#### Acceptance Criteria

1. WHEN candies land anywhere on the tray THE arm SHALL not drop a candy outside the bowls

### Requirement 5: Sort every candy

**User Story:** As a host handing out candy, I want every candy in the bowl of its colour, so that the sorting is finished without help.

#### Acceptance Criteria

1. WHEN candies land anywhere on the tray THE arm SHALL drop every candy into the bowl of its colour within 45 s

### Requirement 6: Carry heavier candies

**User Story:** As a host with big candy bars in the mix, I want the arm to sort them as well, so that I do not have to sort the heavy ones by hand.

#### Acceptance Criteria

1. WHEN the candies weigh 0.005 kg to 0.060 kg THE arm SHALL drop every candy into the bowl of its colour within 45 s

### Requirement 7: Cope with a weaker vacuum

**User Story:** As a maintainer of the suction cup, I want the arm to keep sorting while the vacuum is weak, so that a worn cup does not stop the show.

#### Acceptance Criteria

1. WHEN the vacuum weakens to 50% to 100% THE arm SHALL drop every candy into the bowl of its colour within 45 s

### Requirement 8: Tolerate a lagging hand tracker

**User Story:** As an installer of the hand tracker, I want the arm to stay clear of the hand even when the tracker reports late, so that a slow camera does not make the arm unsafe.

#### Acceptance Criteria

1. WHEN the hand tracker lags by up to 0.3 s and a hand reaches in from any direction at up to 1.5 m/s THE arm SHALL keep every link at least 0.10 m from the hand
