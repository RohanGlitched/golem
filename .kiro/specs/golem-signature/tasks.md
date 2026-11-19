# Tasks: golem-signature

Paths are relative to `skeleton/`. Each task adds its tests in the same task. Commit after each top-level task as `golem-signature: <n> <what>`, staging only `skeleton/` and `.kiro/specs/golem-signature`.

- [ ] 1. The living sentence
  - [ ] 1.1 `core/living.ts`: `livingSegments`, `leanDeg`, `fuseFill`, `forceFraction`, `fractureSignal`, `fractureWord`; examples and Properties 1 to 3
  - [ ] 1.2 RequirementLine renders bound words, the Gloock Response_Clause and the word fracture; Gloock in `fetch-fonts.mjs` and `studioCss`
  - [ ] 1.3 `signature/live-sentence.ts` and the per-frame sources in mount (replay and hero)
  - [ ] 1.4 Drag preview: `onPreview` → `previewQuantity` → `ShoveController.preview`
  - [ ] 1.5 `signature/trace-trial.ts`; fracture data on broken lines
  - [ ] 1.6 Playwright on g1.html: live words move, the drag arrow, the fracture word
- [ ] 2. Emet → met
  - [ ] 2.1 `core/emet.ts` (`foreheadSpot`, `emetTarget`) with Property 4
  - [ ] 2.2 `signature/emet-decal.ts`, the hint once, the `emet` option; g1.ts passes `emet: { body: 'pelvis' }`
  - [ ] 2.3 Playwright: the decal exists and its state follows the selected line
- [ ] 3. Bullet time
  - [ ] 3.1 `core/swarm-clock.ts`, `core/bullet-time.ts` with Properties 5 and 6
  - [ ] 3.2 Swarm `onBreak`, `swarmNow`, camera orbit in mount; skipped under reduced motion
  - [ ] 3.3 Playwright: the clock runs at 0.1× after the first break
- [ ] 4. Timeline scrubber
  - [ ] 4.1 Swarm `HIDDEN` slots, `playStart`, `playDuration`, `setFrozen`
  - [ ] 4.2 `signature/signature-bar.ts` scrubber and Play/Freeze
  - [ ] 4.3 Playwright: scrubbing freezes the swarm and releases `ghosts-running`
- [ ] 5. Long exposure
  - [ ] 5.1 `core/trails.ts` with Property 7; `core/photo.ts`
  - [ ] 5.2 `signature/trails-view.ts`, `signature/photograph.ts`, the toggles
  - [ ] 5.3 Playwright: trails draw; the downloaded PNG is twice the stage size
- [ ] 6. Sonification
  - [ ] 6.1 `core/sonify-math.ts` with Property 8
  - [ ] 6.2 `signature/sonifier.ts` with a fake AudioContext test; wiring in mount
  - [ ] 6.3 Playwright: sound is off by default and the toggle starts an AudioContext
- [ ] 7. Checkpoint: unit tests, typecheck, Playwright, the fps probe on g1.html, screenshots
