---
inclusion: fileMatch
fileMatchPattern: ["skeleton/src/ui/**", "apps/**/web/**", "site/**", "**/*.css"]
---
# GOLEM design language: "Vltava clay at midnight"

The Prague golem was shaped from river clay. The interface is a night-time proving ground: the robot is made of unfired clay under one raking lamp. Every trial the falsifier runs appears as a translucent **ghost** of the robot. The floor carries an **aura**, the measured boundary of where the robot breaks. Spooky comes from the subject (ghosts are literally the test runs), not from decoration.

## Principles
1. **The spec is the interface.** Requirements are set as readable sentences on a "tablet". Every quantity in a sentence (`200 N`, `3 s`) is a control you can drag or type into, and changing it re-runs the test.
2. **Ghosts are the test.** You see every trial. Ghosts that break turn cinnabar and fade; survivors stay pale.
3. **Data drawn as matter.** The aura on the floor is the measured boundary (max force survived per direction), not decoration.
4. **One bold thing per screen.** The stage is the bold thing. Everything else is calm: plain type, generous spacing, no gradients, no glow except ghosts.
5. **A failing requirement cracks.** Its sentence shows a hairline fracture. Passing lines show nothing extra. Never use a green-check confetti look.

## Tokens
Dark is the default; light is "studio daylight" on a grey seamless backdrop.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--ground` | `#2A211C` (wet clay umber) | `#D6D6D2` (seamless grey) | page and stage background |
| `--ground-2` | `#342923` | `#E3E3DF` | raised surfaces (tablet, panels) |
| `--ink` | `#EDE6DC` | `#1F1B18` | text |
| `--ink-2` | `#B8AC9E` | `#55504A` | secondary text |
| `--clay` | `#C9B59C` | `#A88E73` | the robot, rules, quiet borders |
| `--ghost` | `#D6F1F2` | `#4B44A6` | ghosts, live trial marks |
| `--break` | `#D0452F` (cinnabar) | `#A8311F` | failed requirements, fracture, falling ghosts |
| `--hold` | `#86BFA6` (verdigris) | `#2F7560` | held requirements, margins |

Contrast: body text ≥ 7:1 on `--ground`, and `--break` / `--hold` text ≥ 4.5:1 in both themes.

## Type
- **B612** (Airbus's cockpit typeface: the requirements are safety-critical sentences) for all UI and the EARS sentences. **B612 Mono** for numbers that change (tabular figures).
- **Gloock** for page headlines only, at large sizes. Never in UI controls.
- Scale (1.25 ratio): 13 / 16 / 20 / 25 / 31 / 39 / 61 px. Body 16 px, line-height 1.55. Measure ≤ 72ch.
- EARS keywords (WHEN, WHILE, IF, THEN, WHERE, THE, SHALL) keep their conventional capitals because that is the standard, set at 0.85em with letter-spacing 0.04em. Nothing else is all-caps. No eyebrow labels.

## Layout
- **Studio** (each app): a full-bleed stage; the tablet is a 380 px column at the left on ≥1024 px; the counterexample **reel** is a strip under the stage. On phones: the stage is 56vh, primary actions sit directly under it, then the tablet, then the reel.
- **Site** pages read like a lab notebook: left-aligned single column (≤72ch) with full-bleed figures that break out of it.
- Radii: 2 px for controls, 0 for the stage. Borders are 1 px `--clay` at 35% opacity. No drop shadows on cards; elevation comes from `--ground-2`.

## Motion
- One orchestrated moment per screen: summoning the ghosts (they rise from the floor over 400 ms, then run).
- Anything a user does gets an answer in <100 ms (a ghost appears, a number re-renders).
- `prefers-reduced-motion`: ghosts appear without the rise, and replays step frame by frame.
- 3D renders on demand: only while simulating, dragging or replaying. Pixel ratio is capped at 1.5, and rendering pauses off-screen.

## Words
Sentence case. Buttons are verbs that say what happens: "Summon 64 ghosts", "Shove", "Replay the fall", "Pin this seed". Errors say what broke and how to fix it: "Line 3 has a number with no unit: write 200 N, not 200."
