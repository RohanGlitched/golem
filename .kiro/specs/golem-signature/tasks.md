# Tasks: golem-signature

Paths are relative to `skeleton/`. Each task adds its tests in the same task. Commit after each top-level task as `golem-signature: <n> <what>`, staging only `skeleton/` and `.kiro/specs/golem-signature`.

- [x] 1. The living sentence
  - [x] 1.1 `core/living.ts`: `livingSegments`, `leanDeg`, `fuseFill`, `forceFraction`, `fractureSignal`, `fractureWord`; examples and Properties 1 to 3
  - [x] 1.2 RequirementLine renders bound words, the Gloock Response_Clause and the word fracture; Gloock in `fetch-fonts.mjs` and `studioCss`
  - [x] 1.3 `signature/live-sentence.ts` and the per-frame sources in mount (replay and hero)
  - [x] 1.4 Drag preview: `onPreview` → `previewQuantity` → `ShoveController.preview`
  - [x] 1.5 `signature/trace-trial.ts`; fracture data on broken lines
  - [x] 1.6 Playwright on g1.html: live words move, the drag arrow, the fracture word
- [x] 2. Emet → met
  - [x] 2.1 `core/emet.ts` (`foreheadSpot`, `emetTarget`) with Property 4
  - [x] 2.2 `signature/emet-decal.ts`, the hint once, the `emet` option; g1.ts passes `emet: { body: 'pelvis' }`
  - [x] 2.3 Playwright: the decal exists and its state follows the selected line
- [x] 3. Bullet time
  - [x] 3.1 `core/swarm-clock.ts`, `core/bullet-time.ts` with Properties 5 and 6
  - [x] 3.2 Swarm `onBreak`, `swarmNow`, camera orbit in mount; skipped under reduced motion
  - [x] 3.3 Playwright: the clock runs at 0.1× after the first break
- [x] 4. Timeline scrubber
  - [x] 4.1 Swarm `HIDDEN` slots, `playStart`, `playDuration`, `setFrozen`
  - [x] 4.2 `signature/signature-bar.ts` scrubber and Play/Freeze
  - [x] 4.3 Playwright: scrubbing freezes the swarm and releases `ghosts-running`
- [x] 5. Long exposure
  - [x] 5.1 `core/trails.ts` with Property 7; `core/photo.ts`
  - [x] 5.2 `signature/trails-view.ts`, `signature/photograph.ts`, the toggles
  - [x] 5.3 Playwright: trails draw; the downloaded PNG is twice the stage size
- [x] 6. Sonification
  - [x] 6.1 `core/sonify-math.ts` with Property 8
  - [x] 6.2 `signature/sonifier.ts` with a fake AudioContext test; wiring in mount
  - [x] 6.3 Playwright: sound is off by default and the toggle starts an AudioContext
- [x] 7. Checkpoint: unit tests, typecheck, Playwright, the fps probe on g1.html, screenshots
