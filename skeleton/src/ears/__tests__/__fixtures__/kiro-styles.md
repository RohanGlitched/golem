# Requirements Document

## Introduction

The G1 walking controller must survive pushes, slopes and payloads. This file is written the way Kiro writes requirements: numbered criteria with trailing periods, inline code and bold, `WHEN x THEN the system SHALL`, a comma before THE, and criteria wrapped onto a second line.

## Glossary

- **G1**: the Unitree G1 humanoid.
- **Stride**: one gait cycle, about 0.8 s.

## Requirements

### Requirement 1: Push recovery

**User Story:** As a robotics engineer, I want the G1 to recover from shoves, so that visitors cannot knock it over.

#### Acceptance Criteria

1. WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride, THE golem SHALL stay upright for 3 s.
2. WHEN the pelvis is pushed with 150 to 250 N for 200 ms from behind at any point in its stride THEN the G1 SHALL keep its pelvis above 0.6 m for 3 s.
3. IF the pelvis is pushed with up to 300 N for 0.1 s from behind at 62% of its stride, THEN THE robot SHALL keep its pelvis above `50 cm` within 6 s.
4. WHEN the pelvis is pushed with up to 200 N for 0.2 s from 90 deg at any point in its stride,
   THE **Unitree G1** SHALL stay upright for 3 s.

### Requirement 2: Walking

**User Story:** As a robotics engineer, I want the G1 to keep walking on slopes and with a payload, so that it can cross the hall.

#### Acceptance Criteria

1. THE G1 SHALL track the commanded speed within 0.15 m/s.
2. WHILE walking on a slope of up to 10°, THE golem SHALL stay upright.
3. WHILE keep its pelvis above 0.4 m, THE golem SHALL track the commanded speed within 15 cm/s for 2 s.
4. WHERE the payload kit is fitted, THE golem SHALL keep its pelvis above 0.55 m.
5. WHILE carrying a payload of up to 5 kg THEN THE golem SHALL stay upright.
