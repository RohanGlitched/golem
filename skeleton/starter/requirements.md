# Requirements Document

## Introduction

The cart-pole starter robot: a 1 kg cart on a 4 m rail carrying a 0.1 kg pole, balanced by the controller in `app.js` through a motor limited to 15 N. GOLEM compiles each numbered line below against the phrases in `app.js` and searches for a counterexample in MuJoCo. A pass means no counterexample was found within the search budget.

Lines 1.1 and 2.1 are expected to hold. Line 1.2 is expected to break: it asks for a push twice the motor's limit. Lines are never edited to make a failing run pass; change `app.js` instead.

## Requirements

### Requirement 1: Recover from pushes

**User Story:** As someone nudging the cart, I want the pole to stay up after a push, so that the robot can work near people.

#### Acceptance Criteria

1. WHEN the cart is pushed with up to 8 N for 0.2 s THE robot SHALL keep the pole within 30 deg of upright for 3 s
2. WHEN the cart is pushed with up to 30 N for 0.2 s THE robot SHALL keep the pole within 30 deg of upright for 3 s

### Requirement 2: Stay near the centre

**User Story:** As the owner of the rail, I want the cart to stay near the middle, so that it never hits the end stops.

#### Acceptance Criteria

1. THE robot SHALL keep the cart within 0.3 m of the centre
