# Design: golem-signature

## Overview

Each moment is a pure logic module in `core/` (no three.js, no DOM; property-tested) plus a thin view in `signature/` that mount.ts wires into the existing frame loop (`RenderScheduler`). No moment adds a `requestAnimationFrame` of its own. Each holds the `transition` or `ghosts-running` render reason only while it animates.

```
core/living.ts         word bindings, lean, fuse, force fraction, Fracture_Signal, signal → word
core/swarm-clock.ts    Swarm_Clock (rate, freeze, seek)
core/bullet-time.ts    0.1× for 1.2 s and the 40° orbit schedule
core/trails.ts         TrailStore: fixed-capacity paths, writes merged line-segment arrays
core/sonify-math.ts    drone pitch, pan, chord, gain caps, thud rate limit
core/emet.ts           forehead placement from vertices, letter target state
core/photo.ts          corner-text layout of the photograph
signature/emet-decal.ts      decal planes + crumble shader + particles (layer 4)
signature/trails-view.ts     one LineSegments with preallocated attributes (layer 4)
signature/sonifier.ts        Web Audio graph, injectable AudioContext (layer 4)
signature/live-sentence.ts   writes CSS variables on the selected sentence (layer 5)
signature/signature-bar.ts   scrubber, Play/Freeze, Long exposure, Save photograph, Sound (plain DOM, layer 5)
signature/photograph.ts      2× render + 2D composite + download (layer 5)
signature/trace-trial.ts     one runTrial on the hero's mj/model with earlyStop capture (layer 6)
```

## Components and interfaces

### StudioOptions additions
```ts
emet?: { body: string; at?: [number, number, number]; normal?: [number, number, number]; width?: number } | false;
tiltWords?: string[];                    // extra words that tilt with the lean (default includes "upright")
signalWords?: Record<string, string[]>;  // signal → words of the Response_Clause it binds to
```

### Living sentence
`livingSegments(text, tiltWords)` splits a line into the existing segments plus word segments, each with `response: boolean` and `bind?: 'tilt' | 'fuse' | 'force'`. RequirementLine renders bound parts with `data-golem-bind`. `LiveSentence.write(lean, fuse, force)` sets `--golem-tilt`, `--golem-fuse` and `--golem-force` on the selected sentence, only when a value changed by more than a display step (0.1°, 0.5%). Sources per frame: replay poses at `t` (lean, push window from the perturbation's `visual`), or the hero (lean from `xquat`, force from `ShoveController.liveForce`, fuse from sim time since the shove started).

`leanDeg(q, right)` = atan2(z_axis · right, z_axis · up) in degrees, clamped to ±12.

### Drag preview
`QuantityControl.onPreview` → `actions.previewQuantity(lineId, start, end, value)`. mount rewrites and compiles the line, picks the harshest scenario (`severity up` → max, `down` → min, `none` → middle of the range) for each dimension, resolves `visual` and calls `ShoveController.preview(body, force)`; an 800 ms timer hides it.

### Fracture
`traceTrial(hero, app, req, ce)` runs `runTrial` with a duck-typed cache returning the hero's `{ mj, model }` (the runner restores the model) and an `earlyStop` hook that keeps the trace. `req.monitor(trace, { margins: true })` gives `margins` and `marginsAt`. `fractureSignal(margins, marginsAt)` picks the negative margin with the earliest time (ties: lower margin, then name). `fractureWord(text, signal, signalWords)` returns the char span. The result goes into `LineModel.fracture = { start, end, margin, unit, signal }`. The same trace gives the instantaneous margin series for the drone during a replay.

### Emet
`foreheadSpot(points)` uses the top 18 % of the body's height as the head band; the forehead is 40 % down the band, at the band's largest x (body forward), centred in y; width 0.55 × band width, clamped to [0.02, 0.2] m. Two planes share one canvas texture: plane E (first "e") uses a crumble shader (`uCrumble` 0 → 1 discards by value noise, darkened edge) and 24 particles whose fall is computed in the vertex shader from `uCrumble`. `emetTarget(status, prev)`: broken → `met`; held, untested, error → `emet`; running → prev.

### Swarm clock, bullet time and scrubber
GhostSwarm reads time only from its callers; mount passes `clock.now` (seconds) to `update`, `accept` and `commitGeneration` (RunDeps gets `swarmNow`). Swarm additions: `onBreak(slot, x, y, z, first)` when a ghost's break time is crossed (once per slot), `playStart`, `playDuration`, `setFrozen(f)` (releases `ghosts-running`), and a faded broken ghost keeps its slot (stage `HIDDEN`) until the next generation, so scrubbing back shows it again. `BulletTime.trigger(nowMs)`; `rate(nowMs)` = 0.1 for 1.2 s; `angle(nowMs)` = 40° × smoothstep(progress). mount rotates camera and orbit target about the ghost's vertical axis by the angle increment.

### Long exposure
`TrailStore(capacity = 2048 trials, points = 32)` keeps downsampled primary-body paths in one Float32Array. `writeSegments(pos, col, held, broken)` writes `2 × (points − 1)` vertices per trial and returns the count. TrailsView owns one `LineSegments` with attributes sized to the capacity and calls it on `onGeneration`, then `setDrawRange`. The photograph renders at pixel ratio 2, copies to a 2D canvas, sets the text with `photoLayout` and downloads `golem-<app>-<line>.png`.

### Sonification
Graph: drone (sine + triangle an octave up, lowpass 400 Hz, gain 0.03) → master (≤ 0.12) → destination. Per frame: `frequency.setTargetAtTime(droneHz(m, scale), now, 0.15)` with no allocation. `droneHz(m, s) = 55 × 2^tanh(m / s)`; `s` from the unit (m 0.1, deg 10, rad 0.2, m/s 0.15, s 0.5, N 50, else 1). Thud: one shared noise buffer, a 70 Hz sine with 220 ms decay and a lowpassed noise burst through a `StereoPanner` at `pan = clamp(2x − 1, −1, 1)`. Chord: three sines (A5, E6, A6 with ±3 cents) with 30 ms attack and 1.6 s decay at 0.02.

## Correctness Properties

### Property 1: Bound words
For generated lines, `livingSegments` concatenates back to the text; exactly the words after `SHALL` are `response`; a word is `tilt` iff it is in the tilt set; at most one `fuse` (the first duration quantity of the Response_Clause) and at most one `force` quantity.
**Validates: 1.1, 1.2, 1.3, 1.4**

### Property 2: Lean, fuse and force are bounded and monotone
`|leanDeg| ≤ 12` and its sign flips when the right vector flips; `fuseFill` and `forceFraction` lie in [0, 1] and never decrease when their input grows.
**Validates: 1.2, 1.3, 1.4**

### Property 3: Fracture_Signal
`fractureSignal` returns a signal with a negative margin and no other negative signal has an earlier time; it returns undefined iff no margin is negative. `fractureWord` returns a span inside the Response_Clause.
**Validates: 3.1, 3.2**

### Property 4: Forehead placement
For any point cloud, the spot lies inside its bounding box, in its top 18 %, and the width lies in [0.02, 0.2] m.
**Validates: 4.1**

### Property 5: Swarm clock
With rate r ≥ 0, `now` advances by r × dt; frozen, it does not advance; `seek(t)` sets `now` to t and freezes.
**Validates: 5.1, 6.2, 6.4**

### Property 6: Bullet time
For any trigger time, `rate` is 0.1 inside [t₀, t₀ + 1.2 s) and 1 outside; `angle` is monotone from 0 to 40°.
**Validates: 5.1**

### Property 7: Trails
For any added paths, `writeSegments` writes `2 × (k − 1)` vertices for a path of k ≥ 2 points, every vertex comes from that path, broken paths get the broken colour, and nothing is written past the capacity.
**Validates: 7.1, 7.2**

### Property 8: Sound mapping
`droneHz` lies in (27.5, 110) Hz and never decreases with the margin; `pan` lies in [−1, 1]; the thud limiter never lets two thuds closer than 60 ms; every gain constant ≤ 0.12.
**Validates: 8.2, 8.3, 8.5**

## Testing

Vitest examples and fast-check properties (100 runs, tag `Feature: golem-signature, Property N`) per module; jsdom tests for the tablet bindings and fracture rendering; a fake AudioContext for the sonifier. Playwright on `g1.html` (`skeleton/src/ui/e2e/signature.spec.ts`): the living sentence moves during a shove and a replay, a drag draws the arrow, emet decal exists and crumbles, bullet time slows the clock, the scrubber freezes, long exposure draws and the photograph is 2×, sound toggles on with an AudioContext running. The `@perf` probe measures fps on the G1 page with 64 ghosts and trails on.
