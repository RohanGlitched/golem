---
inclusion: fileMatch
fileMatchPattern: ["skeleton/src/ui/**", "apps/**/web/**", "site/**", "skeleton/ui-demo/**", "infra/**"]
---
# Signature moments: the GOLEM experience (binding)

The studio must feel like nothing a judge has seen: a physics instrument where language, matter and sound are one system. Everything stays fast (first frame under 4 s; 60 fps with 64 ghosts on integrated graphics) and premium: cinematic light and real data. Never cartoonish. Each moment below is required unless marked stretch.

## 1. The living sentence (kinetic EARS)
- The selected requirement stands out on the tablet: Gloock for the response clause (28 px in the 380 px column, so the whole sentence fits and never overflows; 39-61 px when the tablet is stacked and at least 600 px wide), B612 for the rest.
- The words are bound to the signals they name, and move **only while a trial plays**:
  - the word "upright" tilts with the robot's torso tilt (CSS transform from the live signal, capped at 12°);
  - "3 s" fills like a fuse over the monitored window;
  - the force quantity's underline grows with the live push force.
- Dragging a quantity (`250 N`) also draws the matching force arrow on the stage in real time, before any test runs. The sentence and the world are the same object.
- When a requirement breaks, its sentence fractures along a hairline at the word whose signal broke first. The margin value appears in cinnabar beside it: "−0.07 m".

## 2. Emet → met
- The robot's forehead carries a small incised word, "emet" (Latin letters), on the clay.
- When the selected requirement is broken, the first "e" crumbles away and leaves "met" (dead).
- When it holds again, the letter re-forms.
- A one-line hint explains it once: "In the legend, erasing one letter unmakes the golem."

## 3. The swarm and bullet time
- "Summon 64 ghosts" works as described in the UI spec. Ghosts rise, get shoved, and each generation converges on the weak spot.
- **Bullet time:** when the first ghost breaks, time slows to 0.1× for 1.2 s and the camera orbits 40° around that ghost. Then normal speed resumes. Skip this under reduced motion.
- **The timeline scrubber** under the stage scrubs all ghosts at once, and lets you freeze any instant and orbit the frozen swarm.

## 4. Long exposure
- A toggle ("Long exposure") draws every trial's pelvis path as a fine light trail on the dark stage: cool ghost-white for trials that held, cinnabar for those that broke.
- The result is a single photograph of a whole falsification campaign.
- Add "Save photograph", exporting a 2× PNG with the requirement text set in the corner.

## 5. Sonification (off by default, one toggle)
- Web Audio only, with no audio files.
- A low drone whose pitch follows the selected requirement's live margin: it falls as the margin shrinks.
- A soft clay thud, panned to the ghost's screen position, when a ghost breaks.
- A brief glassy chord when a requirement is held.
- Keep it quiet and tasteful, never cartoon sounds. The video uses it.

## 6. Shove from your phone (stretch, high wow)
- A QR on the studio opens /shove on a phone.
- Flicking the phone (DeviceMotion acceleration peak) sends a shove to the laptop's robot, with direction from the flick and force from its strength, over a tiny WebSocket relay (golem-cloud).
- It shows "You shoved the golem with 182 N from the left" on both screens.
- Fallback: a big swipe pad on the phone.

## 7. Watch Kiro fix it
- A pane that replays a real recorded kiro-cli stream-json session:
  - tool calls appear as terse lines;
  - each controller diff appears as a small code card;
  - each `golem gate` verdict flips the tablet lines red or green, with the ghost swarm re-running.
- It is driven only by the committed log file (authentic, deterministic), with a scrubber.

## 8. The floor aura
- The measured stability boundary drawn on the floor, as in the UI spec.
- Hovering a direction shows "holds 182 N from 135°; breaks at 196 N".
- Tapping the aura edge sets the sentence's quantities to that boundary scenario and replays it.

## Calm everywhere else
Outside these moments the interface is quiet: plain type, generous spacing, no decoration. Boldness is spent on the stage, the sentence and the ghosts.
