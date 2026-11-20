# Requirements Document

## Introduction

One requirements file for every robot in the yard. Each robot is a MuJoCo Menagerie model, fetched at a pinned commit by `apps/yard/scripts/fetch-assets.mjs`, standing in its keyframe pose and holding it with its own position servos at their stock gains. There is no balance controller: the yard measures the stance that ships with each model, not the robot's real controller. GOLEM compiles the lines below once per robot, against the lexicon in `apps/yard/stand.ts`, and searches each one for a counterexample in MuJoCo.

Forces are written as a share of the robot's weight, so the same line asks the same thing of a 12 kg dog and a 50 kg one. A held line means "no counterexample found within the stated search budget", never a proof.

Every trial starts with a 1.5 s warm-up in which the robot settles onto its feet and nothing acts on it. The push starts at the trigger, after the warm-up.

## Glossary

- **robot**: One yard robot under the stand app in `apps/yard/stand.ts`.
- **Base**: The body with the robot's free joint (the trunk of a quadruped, the pelvis or torso of a humanoid).
- **Weight**: The mass of the whole robot times 9.81 m/s².
- **Push**: A horizontal force on the base for a fixed time. Its direction is the side it comes from, counterclockwise from the robot's front seen from above (0 deg the front, 90 deg its left, 180 deg behind). The force points away from that side. `from any direction` searches 0 deg to 360 deg.
- **Upright**: The base is above 60% of its standing height and tilted less than 45 deg from vertical.
- **Where it stood**: The base's position on the floor at the moment of the push.

## Requirements

### Requirement 1: Stay standing when pushed

**User Story:** As someone choosing a robot model to start from, I want to know how hard a push each one takes before it falls, so that I can compare their stances on the same terms.

#### Acceptance Criteria

1. WHEN the base is pushed with up to 10% of its weight for 0.2 s from any direction THE robot SHALL stay upright for 3 s
2. WHEN the base is pushed with up to 25% of its weight for 0.2 s from any direction THE robot SHALL stay upright for 3 s
3. WHEN the base is pushed with up to 50% of its weight for 0.2 s from any direction THE robot SHALL stay upright for 3 s
4. WHEN the base is pushed with up to 100% of its weight for 0.2 s from any direction THE robot SHALL stay upright for 3 s

### Requirement 2: Stay in place when pushed

**User Story:** As someone placing a robot next to a workbench, I want a light push to leave it where it stood, so that it does not slide into things.

#### Acceptance Criteria

1. WHEN the base is pushed with up to 10% of its weight for 0.2 s from any direction THE robot SHALL not move more than 0.05 m from where it stood for 3 s
