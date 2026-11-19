# Requirements: golem-signature

## Introduction

The signature moments of `.kiro/steering/experience.md` (sections 1 to 5) for the studio in `skeleton/src/ui`: the living sentence, emet → met, bullet time with a timeline scrubber, long exposure, and sonification. Everything is generic: it works for any `RobotApp` (apps/stagger, apps/candy) through `StudioOptions`, and is checked on the ui-demo G1 page (`skeleton/ui-demo/g1.html`).

Out of scope: shove from your phone (6), watch Kiro fix it (7) and aura hover and tap (8).

## Glossary

- **Selected_Line**: the requirement line selected on the tablet.
- **Response_Clause**: the words after `SHALL` in a line.
- **Trial_Playing**: a replay is playing, or the hero is being shoved or is inside the Fuse_Window that follows a shove.
- **Fuse_Window**: the duration quantity of the Response_Clause (`3 s` in `stay upright for 3 s`), measured from the trigger (replay) or from the start of the shove (hero).
- **Fracture_Signal**: the signal with a negative margin whose lowest margin comes first in time, from the per-signal breakdown of the monitor result (`monitor(trace, { margins: true })`).
- **Swarm_Clock**: the virtual clock the ghost swarm plays on. It has a rate (1, 0.1 in bullet time, 0 when frozen) and can be set by the scrubber.
- **Head_Body**: the body named by `StudioOptions.emet.body`, else the body whose drawn geometry reaches highest.

## Requirements

### Requirement 1: The living sentence

**User Story:** As a visitor, I want the selected sentence to move with the robot, so that I see the spec and the physics as one object.

#### Acceptance Criteria

1. THE Studio SHALL set the Response_Clause of the Selected_Line in Gloock, and the rest of the line in B612. In the 380 px Tablet column the Response_Clause is 28 px (off the type scale on purpose: the whole sentence must fit the column and never overflow it) and the Selected_Line's sentence is 20 px; when the Tablet is stacked under the Stage and is at least 600 px wide, the Response_Clause is 39 px to 61 px.
2. WHILE Trial_Playing THE Studio SHALL rotate each tilt word ("upright" and the words in `StudioOptions.tiltWords`) by the signed lean of the primary body toward the camera's right, capped at 12°.
3. WHILE Trial_Playing THE Studio SHALL fill the Fuse_Window quantity from 0 to 1 over the Fuse_Window.
4. WHILE Trial_Playing THE Studio SHALL grow the underline of the force quantity in proportion to the live push force divided by the line's force, capped at 1.
5. WHEN no trial plays THE Studio SHALL draw the bound words at rest: no tilt, an empty fuse and no force underline.

### Requirement 2: Dragging a quantity draws the push

**User Story:** As an engineer, I want to see the push a number means before I run it.

#### Acceptance Criteria

1. WHEN a force or direction quantity of a line with a push perturbation is dragged or stepped THE Studio SHALL draw the shove arrow on the stage at the pushed body, along the perturbation's `visual` force, with length `arrowLength(|F|)` and the label `<F> N`, within the same frame as the change.
2. WHEN 800 ms pass after the last change THE Studio SHALL hide the preview arrow.

### Requirement 3: The fracture at the word that broke

#### Acceptance Criteria

1. WHEN a line becomes broken with a counterexample THE Studio SHALL run that counterexample once on the page's MuJoCo instance, compute the per-signal margins, and pick the Fracture_Signal.
2. THE Studio SHALL draw the hairline fracture through the Response_Clause word bound to the Fracture_Signal (from `StudioOptions.signalWords`, else the signal name's parts, else built-in synonyms, else the first Response_Clause word), with that signal's margin beside it in cinnabar, written with a minus sign and its unit ("−0.07 m").
3. IF the margins cannot be computed THEN THE Studio SHALL draw the fracture through the first Response_Clause word with the line's robustness.

### Requirement 4: Emet → met

#### Acceptance Criteria

1. THE Studio SHALL draw the word "emet" as a small incised decal on the front of the Head_Body, placed from that body's drawn geometry unless `StudioOptions.emet.at` gives the point.
2. WHEN the Selected_Line is broken THE Studio SHALL crumble the first "e" away in at most 1 s, leaving "met".
3. WHEN the Selected_Line is held or untested THE Studio SHALL re-form the letter; WHILE it runs the decal SHALL keep its state.
4. WHEN the letter crumbles for the first time on this device THE Studio SHALL show and announce the hint "In the legend, erasing one letter unmakes the golem."
5. WHERE reduced motion is preferred THE Studio SHALL swap the letter state without animation.

### Requirement 5: Bullet time

#### Acceptance Criteria

1. WHEN the first ghost of a generation breaks THE Studio SHALL play the Swarm_Clock at 0.1× for 1.2 s of wall time and orbit the camera 40° about the vertical axis through that ghost, then resume 1×.
2. WHERE reduced motion is preferred THE Studio SHALL skip bullet time.
3. WHILE frozen by the scrubber THE Studio SHALL NOT start bullet time.

### Requirement 6: The timeline scrubber

#### Acceptance Criteria

1. WHILE ghosts are shown THE Studio SHALL show a scrubber under the stage spanning the current generation's recording, with the ghost time in seconds.
2. WHEN the scrubber is moved THE Studio SHALL freeze the Swarm_Clock and pose every ghost of the generation at that ghost time.
3. WHILE frozen THE Studio SHALL let the camera orbit the frozen swarm and SHALL draw frames only on demand (no `ghosts-running` render reason).
4. WHEN "Play" is pressed THE Studio SHALL resume the Swarm_Clock from the frozen instant.

### Requirement 7: Long exposure

#### Acceptance Criteria

1. WHEN "Long exposure" is on THE Studio SHALL draw the primary-body path of every trial of the current run as one merged line geometry: ghost colour for held trials, cinnabar for broken ones.
2. THE Studio SHALL rebuild that geometry once per generation, not per frame.
3. WHEN "Save photograph" is pressed THE Studio SHALL download a PNG at twice the stage's CSS size with the Selected_Line's id and text set in the lower-left corner.

### Requirement 8: Sonification

#### Acceptance Criteria

1. THE Studio SHALL keep sound off until the "Sound" toggle is pressed, and SHALL use Web Audio only, with no audio files.
2. WHILE sound is on THE Studio SHALL play a low drone whose pitch rises and falls with the Selected_Line's live margin (lower margin, lower pitch), between 27.5 Hz and 110 Hz.
3. WHEN a ghost breaks WHILE sound is on THE Studio SHALL play a soft thud panned by the ghost's screen x, at most one per 60 ms.
4. WHEN a line becomes held WHILE sound is on THE Studio SHALL play a quiet glassy chord shorter than 2 s.
5. THE Studio SHALL keep the master gain at or below 0.12.

### Requirement 9: Generic, on demand and allocation-free

#### Acceptance Criteria

1. THE Studio SHALL keep render-on-demand: every moment holds a render reason only while it animates.
2. THE swarm, trail and audio frame paths SHALL NOT allocate per frame.
3. THE Studio SHALL work for any RobotApp without app code, and take app specifics only from `StudioOptions` (`emet`, `tiltWords`, `signalWords`).
