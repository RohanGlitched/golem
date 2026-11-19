# Implementation Plan: golem-site

## Overview

The site in `site/` is built in this order: scaffold and guards, a pure generator and its data builders, pure figure logic, styles and theme, page rendering, post-build checks, browser islands, build orchestration, then Playwright and Lighthouse CI. Language is TypeScript (strict, ES modules, Node 20 or later), as set in `tech.md` and used by the design, so no language choice is needed.

Rules for every task:
- Logic and its tests land in the same task group. Examples use Vitest. Properties use fast-check with at least 100 runs, one test per design property, tagged `Feature: golem-site, Property N: <title>`.
- Each property test lives in its own file, `site/tests/properties/pNN-<slug>.test.ts`, so property tasks can run in parallel.
- Test names state behaviour, for example `it('fails the build when a result has no pre-registration link')`.
- The site imports only `golem-spec`, `golem-spec/ui`, `golem-spec/node` and each app's public entry. The contracts in `interfaces.md` are read, never changed.
- No `Math.random()` in `site/src/build`. Never weaken an assertion or a requirement to make a test pass.

## Tasks

- [ ] 1. Scaffold the site package and build guards
  - [ ] 1.1 Create the `site/` package skeleton
    - Create `site/package.json`, strict `tsconfig.json`, `vitest.config.ts`, a Vite multi-page `vite.config.ts` with inputs for `/`, `/kit`, `/evidence`, `/how-kiro` and the changelog page, and the directory layout from the design (`pages/`, `src/build`, `src/generated`, `src/islands`, `src/figures`, `src/styles`, `src/shared`, `schema/`, `content/`, `public/`, `scripts/`, `tests/`).
    - Add npm scripts: `generate`, `build`, `test`, `smoke`, `lhci`.
    - _Requirements: 1.1, 1.9, 25.9_
  - [ ] 1.2 Implement the Node version check and the deep-import guard
    - `check-node` compares the major version to 20 and prints the required and detected versions on failure.
    - `check-imports` scans `site/` for imports of `skeleton/src/...` or app internals and reports the first file path and specifier.
    - Add Vitest examples for a passing and a failing case of each.
    - _Requirements: 1.6, 1.9_
  - [ ]* 1.3 Write property test for the Node version gate
    - **Property 5: Node version gate**
    - **Validates: Requirements 1.9**
  - [ ]* 1.4 Write property test for the deep import guard
    - **Property 4: Deep import guard**
    - **Validates: Requirements 1.6**

- [ ] 2. Generator foundations
  - [ ] 2.1 Implement the generator core in `site/src/build/`
    - `ReadOnlyFs`, `GeneratorError`, `canonicalJson` (sorted keys, 2-space indent, LF, trailing newline), `parseJsonl` (fails on the first malformed line with its number), schema validation against `site/schema/*.schema.json` (names file and first invalid path), and a staged writer that moves files into place only when every file validated.
    - Add Vitest examples for each error case.
    - _Requirements: 25.1, 25.3, 25.4, 25.6, 25.7, 25.8_
  - [ ]* 2.2 Write property test for strict JSONL reading
    - **Property 44: JSONL reading is strict**
    - **Validates: Requirements 25.7**
  - [ ]* 2.3 Write property test for generated JSON validation and round trip
    - **Property 43: Generated JSON validates and round trips**
    - **Validates: Requirements 25.4, 25.8**

- [ ] 3. Kiro inventory
  - [ ] 3.1 Implement `countRequirements`, `countTasks` and `buildInventory`
    - Count `### Requirement N` headings and `- [ ]` / `- [x]` items. Read steering inclusion mode, hook trigger and action, and purpose lines (at most 30 words). Write "no description in file" and one warning for items without a purpose. Produce the eight lists in the fixed order, totals, the commit hash and the eight surface example links.
    - Write the inventory schema and Vitest examples on a small in-memory tree.
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9, 19.10_
  - [ ]* 3.2 Write property test for inventory counts and totals
    - **Property 38: Kiro inventory counts and totals**
    - **Validates: Requirements 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.9, 27.6, 27.7**
  - [ ]* 3.3 Write property test for missing purpose warnings
    - **Property 39: Missing purpose warns once**
    - **Validates: Requirements 19.8**

- [ ] 4. Lexicon reference
  - [ ] 4.1 Implement `buildLexiconReference`
    - Take lexicons and an injected `CompileFn`. List every predicate and perturbation template once with phrase, kind, app, slot types and units, margin unit and one compiled example line. Include the units table with SI factors, the five EARS patterns from `ears-for-robots.md`, and one compile-error example with its suggestion. Fail with the line and diagnostic when an example does not compile.
    - Write the schema and Vitest examples with a stub compiler.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.9, 14.10_
  - [ ]* 4.2 Write property test for lexicon completeness and exactness
    - **Property 26: Lexicon reference is complete and exact**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.6, 14.7, 14.10, 27.4**
  - [ ]* 4.3 Write property test for unit conversion round trip
    - **Property 27: Unit conversion round trip**
    - **Validates: Requirements 14.4**
  - [ ] 4.4 Implement `filterRows` and the progressive filter markup contract
    - Pure filter by app and kind in `site/src/islands/lexicon-filter.ts`. The full table stays in HTML when JavaScript is off.
    - Add Vitest examples for empty, app-only, kind-only and combined filters.
    - _Requirements: 14.8_
  - [ ]* 4.5 Write property test for the lexicon filter
    - **Property 28: Lexicon filter**
    - **Validates: Requirements 14.8**
  - [ ]* 4.6 Write an example test that compiles every real lexicon example
    - Run the real `golem-ears` compiler, imported through `golem-spec`, over every template of `apps/stagger` and `apps/candy`.
    - _Requirements: 14.6, 14.7_

- [ ] 5. Kit data
  - [ ] 5.1 Implement the kit builder and anchor ids
    - Produce eight categories in order (CLI, MCP tools, hooks, agents, skills, power, workflow, Crew app) from `skeleton/src/cli`, `skeleton/src/mcp` and `skeleton/kiro-pack/`. One entry has a name, a description of at most 30 words and one snippet. Entries sort by name. Ids are `<section>-<name>` lowercase with hyphens. Build the table of contents and the Home pack list. Fail naming the directory if `kiro-pack/` is unreadable.
    - Write the schema and Vitest examples.
    - _Requirements: 10.2, 10.5, 13.1, 13.2, 13.3, 13.4, 13.5, 13.8, 13.9_
  - [ ]* 5.2 Write property test for kit lists matching their sources
    - **Property 24: Kit lists match their sources**
    - **Validates: Requirements 10.2, 13.1, 13.2, 13.3, 13.4, 13.5**
  - [ ]* 5.3 Write property test for anchor ids
    - **Property 25: Anchor ids are well formed and unique**
    - **Validates: Requirements 13.8, 13.9**

- [ ] 6. Evidence data and rendering
  - [ ] 6.1 Implement manifest validation and headline numbers
    - Types for `EvidenceResult`, `FalsifierResult`, `GateResult`. `validateManifest` names each result and missing field (pre-registration, method, budget, commit, raw data, limits, reproduce, weaknesses), checks gate counts sum to runs, checks `lo ≤ value ≤ hi` and a named interval method. `deriveHeadlineNumbers` is pure and yields at least one number per falsifier, stability map and gate. `verifyBuiltHeadlines` reports mismatches. Missing files fail naming the file and the number.
    - Write the schema and Vitest examples.
    - _Requirements: 9.1, 9.2, 9.3, 9.6, 15.3, 15.8, 17.2, 17.7, 18.4_
  - [ ]* 6.2 Write property test for headline derivation
    - **Property 19: Headline numbers derive from evidence**
    - **Validates: Requirements 9.1, 9.2, 9.6, 27.2**
  - [ ]* 6.3 Write property test for evidence validation failures
    - **Property 20: Missing or invalid evidence fails the build with a named cause**
    - **Validates: Requirements 9.3, 15.3, 15.8, 17.2, 17.7, 18.4, 18.6**
  - [ ] 6.4 Implement the evidence section renderer
    - Render for each result the method, budget, commit, date, seeds, limits, weaknesses, pre-registration link, raw-data links with size and format, and the reproduce command in a Copy_Snippet markup. Render the not-a-proof sentence with the same words as Home, and the default budget on the Home limits section. End with the weaknesses list.
    - Add Vitest examples.
    - _Requirements: 11.2, 15.2, 15.4, 15.5, 15.6, 16.7, 16.8, 17.3, 17.4, 17.5, 18.1, 18.2, 18.3, 18.5, 18.6_
  - [ ]* 6.5 Write property test for rendered manifest fields
    - **Property 21: Manifest fields are rendered**
    - **Validates: Requirements 11.2, 15.2, 15.4, 15.5, 15.6, 16.7, 16.8, 17.3, 17.4, 17.5, 18.1, 18.2, 18.3**

- [ ] 7. Notes, changelog and pipeline data
  - [ ] 7.1 Implement the what-went-wrong notes parser and formatter
    - Parse `site/content/what-went-wrong.md` into notes (title at most 80 characters, what happened, cost, response, link or null). Fail naming the file if missing or empty. Render "no link" when there is no link.
    - Add Vitest examples.
    - _Requirements: 20.1, 20.2, 20.3, 20.5_
  - [ ]* 7.2 Write property test for notes round trip
    - **Property 40: Notes round trip and rendering**
    - **Validates: Requirements 20.1, 20.2, 20.3**
  - [ ] 7.3 Implement the changelog parser
    - Parse `CHANGELOG.md` into releases sorted newest first. Fail naming the file if missing.
    - Add Vitest examples.
    - _Requirements: 12.5, 12.8_
  - [ ]* 7.4 Write property test for changelog order
    - **Property 37: Changelog order**
    - **Validates: Requirements 12.5**
  - [ ] 7.5 Implement the pipeline data builder
    - Build six `PipelineStepData` in the required order from one Stagger requirement read from `apps/stagger/.kiro/specs/stagger/requirements.md`, with the same `quote` in all six steps, explanations of at most 80 words, a live or recorded label, and a shrink-pair validator (shrunk force ≤ original force).
    - Add Vitest examples.
    - _Requirements: 7.1, 7.2, 7.3, 7.7, 7.10_
  - [ ]* 7.6 Write property test for pipeline data invariants
    - **Property 16: Pipeline data invariants**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.7**

- [ ] 8. Pure figure and hero logic
  - [ ] 8.1 Implement polar geometry in `site/src/figures/polar.ts`
    - `toXY`, `fromXY`, `nearestSample` (circular distance), `stepIndex` (wraps, left arrow is counter-clockwise), `splitByBound`, `polarAlt`, a closed boundary path, the reference circle, and a width-to-size function with constant aspect ratio and labels of at least 13 px.
    - Add Vitest examples.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.9, 16.12, 22.6_
  - [ ]* 8.2 Write property test for polar fidelity and geometry
    - **Property 29: Polar fidelity and geometry**
    - **Validates: Requirements 16.1, 16.2, 16.12, 27.3**
  - [ ]* 8.3 Write property test for polar navigation and split
    - **Property 30: Polar navigation and split**
    - **Validates: Requirements 16.3, 16.4, 16.5**
  - [ ]* 8.4 Write property test for polar scaling
    - **Property 31: Polar scaling**
    - **Validates: Requirements 22.6**
  - [ ] 8.5 Implement Text_Alternative builders in `site/src/figures/alt.ts`
    - `falsifierAlt`, `gateAlt`, `pipelineAlt`, `replayAlt`, `wordCount`. Each states its numbers with units and has 1 sentence to 80 words.
    - Add Vitest examples.
    - _Requirements: 7.12, 8.6, 15.7, 16.9, 17.6, 23.1_
  - [ ]* 8.6 Write property test for text alternatives
    - **Property 32: Text alternatives state their data**
    - **Validates: Requirements 8.6, 15.7, 16.9, 17.6, 23.1**
  - [ ] 8.7 Implement the pipeline figure renderers and trial counters
    - SVG or HTML string renderers for the six figures: highlighted quantities with units, scenario-space ranges with the sign convention, random and guided counters with a non-colour cue (dashed outline) and the lowest margin, shrink side by side, pinned seed with all six `Counterexample` fields, and `golem gate` output with exit code 2 and reproduction commands.
    - Add Vitest examples.
    - _Requirements: 7.4, 7.5, 7.6, 7.8, 7.9, 7.12_
  - [ ]* 8.8 Write property test for pipeline figure renderers
    - **Property 17: Pipeline figure renderers show every required field**
    - **Validates: Requirements 7.4, 7.5, 7.8, 7.9**
  - [ ]* 8.9 Write property test for trial counters
    - **Property 18: Trial counters**
    - **Validates: Requirements 7.6**
  - [ ] 8.10 Implement hero pure logic in `site/src/figures/hero-logic.ts`
    - Drag-to-push mapping (force 0 to 200 N, direction in [0, 360)), keyboard push producing the same `Scenario`, the held or broke result formatter with margin and unit, the pixel-ratio cap at 1.5, `fallbackReason`, the Ghost cap of 64 and the tablet result state (latest result or running marker).
    - Add Vitest examples.
    - _Requirements: 5.4, 5.5, 5.7, 5.8, 5.10, 5.15, 23.4, 23.7_
  - [ ]* 8.11 Write property test for drag mapping
    - **Property 10: Drag maps to a bounded push**
    - **Validates: Requirements 5.4**
  - [ ]* 8.12 Write property test for keyboard and drag equivalence
    - **Property 11: Keyboard push equals drag push**
    - **Validates: Requirements 23.4, 5.4**
  - [ ]* 8.13 Write property test for result text
    - **Property 12: Result text states held or broke with margin and unit**
    - **Validates: Requirements 5.5, 23.7**
  - [ ]* 8.14 Write property test for the pixel ratio cap
    - **Property 14: Pixel ratio cap**
    - **Validates: Requirements 5.10**
  - [ ]* 8.15 Write property test for the fallback reason
    - **Property 15: Fallback reason names what is missing**
    - **Validates: Requirements 5.15**
  - [ ]* 8.16 Write property test for the Ghost cap and tablet state
    - **Property 13: Ghost cap and tablet result state**
    - **Validates: Requirements 5.7, 5.8**

- [ ] 9. Assemble the generator
  - [ ] 9.1 Implement `generate()` and the `generate` script
    - Wire every builder (lexicon reference, kit, inventory, evidence, polar, changelog, notes, pipeline, alt, `meta.json` with the full commit hash) into one pure call, with all schemas in `site/schema/`. Write via the staged writer so a failure leaves earlier files unchanged. Use the recorded commit date only.
    - Add a Vitest example that runs the generator on a small fixture tree.
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 25.6, 9.3, 10.5, 12.8, 20.5_
  - [ ]* 9.2 Write property test for deterministic generation
    - **Property 42: Deterministic generation**
    - **Validates: Requirements 19.10, 24.8, 25.1, 25.2, 25.3, 25.5**
  - [ ]* 9.3 Write property test for failed generation leaving output untouched
    - **Property 45: Failed generation leaves previous output untouched**
    - **Validates: Requirements 10.5, 12.8, 20.5, 25.6**

- [ ] 10. Styles and fonts
  - [ ] 10.1 Write the stylesheets in `site/src/styles/`
    - `tokens.css` (eight Tokens in dark and light), `type.css` (seven-size scale, `.kw` keyword class at 0.85em with 0.04em spacing), `layout.css` (72ch Column, full-bleed figures, 44 px hit areas below 1024 px, 2 px focus ring, 2 px control radius, 0 stage radius, reserved aspect ratios, table and code overflow contained, lexicon cards below 640 px). No literal colours outside `tokens.css`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 4.1, 5.11, 5.12, 5.13, 21.5, 22.1, 22.2, 22.3, 22.4, 22.5, 23.3_
  - [ ] 10.2 Add the Font_Set and fallback metrics
    - Add B612, B612 Mono and Gloock woff2 files and licence notices to `site/public/fonts/`. Write `scripts/font-metrics.ts` that computes `size-adjust` and the three override descriptors and writes `fonts.generated.css`. Write `fonts.css` with `font-display: swap`. Add a Vitest example that checks the descriptors and the preload tag for the body font.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [ ] 10.3 Implement the build-time style checker
    - Report font sizes outside the scale, `text-transform: uppercase`, gradients, card shadows, and literal `color` or `background-color` values.
    - Add Vitest examples, including a run over the real stylesheets.
    - _Requirements: 2.4, 2.5, 2.6, 2.8_
  - [ ]* 10.4 Write property test for the style checker
    - **Property 6: Typography and colour rules over CSS**
    - **Validates: Requirements 2.4, 2.5, 2.6, 2.8**
  - [ ]* 10.5 Write property test for tokens and contrast
    - **Property 7: Token coverage and contrast**
    - **Validates: Requirements 4.1, 4.5, 23.3**

- [ ] 11. Theme
  - [ ] 11.1 Implement the theme store and pre-paint script
    - `resolveInitialTheme`, `ThemeStore` (memory fallback when `localStorage` throws), `readTokens`, and the inline `<head>` script that sets `data-theme` before first paint. Figures subscribe and redraw within 100 ms.
    - Add Vitest examples.
    - _Requirements: 4.2, 4.3, 4.4, 4.6, 4.7_
  - [ ]* 11.2 Write property test for initial theme resolution
    - **Property 8: Initial theme resolution**
    - **Validates: Requirements 4.2, 4.4**
  - [ ]* 11.3 Write property test for the theme store
    - **Property 9: Theme store round trip and propagation**
    - **Validates: Requirements 4.3, 4.6, 4.7**

- [ ] 12. Shared page parts
  - [ ] 12.1 Implement the Footer and head metadata builder
    - One footer string for every page: sitemap `nav` to `/`, `/kit`, `/evidence`, `/how-kiro`, `/stagger/`, `/candy/`, credits and licences (BSD-3-Clause, Apache-2.0 as stated), links to licence files and font notices, the changelog, the repository and the Theme_Switch. Head builder emits title, description, canonical, Open Graph, Twitter, icons, manifest, font preload and the theme script.
    - Add Vitest examples.
    - _Requirements: 3.3, 3.5, 12.1, 12.2, 12.3, 12.4, 12.6, 12.7, 24.1, 24.2, 24.4, 24.5_
  - [ ]* 12.2 Write property test for the shared footer
    - **Property 36: Shared footer is identical**
    - **Validates: Requirements 12.1, 12.2**
  - [ ] 12.3 Implement the problem-section builder and vague-word scanner
    - The Home problem section of 60 to 150 words, with no banned vague quantifier ("many", "most", "often") and no unsupported claim. Unit-bearing quantities only from Headline_Numbers.
    - Add Vitest examples.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ]* 12.4 Write property test for content word and phrase rules
    - **Property 35: Content word and phrase rules**
    - **Validates: Requirements 6.3, 6.5**

- [ ] 13. Post-build checks
  - [ ] 13.1 Implement the link extractor and checker in `site/src/build/links.ts`
    - `extractLinks` for `href`, `src`, CSS `url()`, preload and module imports. `checkLinks` returns exactly the unresolved references with their page.
    - Add Vitest examples.
    - _Requirements: 1.8, 12.4, 13.9_
  - [ ]* 13.2 Write property test for the link checker
    - **Property 1: Link checker is sound and complete**
    - **Validates: Requirements 1.8, 12.4, 13.9, 27.8**
  - [ ] 13.3 Implement the deploy file whitelist and foreign-origin scanner
    - Allowed extension set and a scanner for absolute URLs whose origin differs from the serving origin, in HTML, CSS and JavaScript.
    - Add Vitest examples.
    - _Requirements: 1.3, 1.4, 1.5, 3.1_
  - [ ]* 13.4 Write property test for the deploy file whitelist
    - **Property 2: Deploy file whitelist**
    - **Validates: Requirements 1.3**
  - [ ]* 13.5 Write property test for foreign origins
    - **Property 3: No foreign origins in built files**
    - **Validates: Requirements 1.4, 1.5, 3.1**
  - [ ] 13.6 Implement the metadata checker and sitemap builder
    - `checkMetadata` (title, description length, Open Graph, Twitter, canonical equals `og:url`, Share_Image exists) and `buildSitemap` listing exactly the site pages including `/stagger/` and `/candy/`. Also write `robots.txt`.
    - Add Vitest examples.
    - _Requirements: 24.1, 24.2, 24.3, 24.5, 24.6, 24.7_
  - [ ]* 13.7 Write property test for the metadata checker
    - **Property 41: Metadata checker**
    - **Validates: Requirements 24.1, 24.2, 24.5, 24.6, 24.7**
  - [ ] 13.8 Implement the structure checkers
    - Figure alt checker (1 to 80 words), heading checker (one `h1`, no skipped levels), generic link text checker, image and figure dimension checker, landmark and `lang` checks.
    - Add Vitest examples.
    - _Requirements: 21.5, 23.1, 23.5, 23.6, 23.8, 23.9, 23.10_
  - [ ]* 13.9 Write property test for figure alt completeness
    - **Property 33: Figure alt completeness**
    - **Validates: Requirements 7.12, 23.1, 23.10**
  - [ ]* 13.10 Write property test for page structure rules
    - **Property 34: Page structure rules**
    - **Validates: Requirements 21.5, 23.6, 23.9**
  - [ ] 13.11 Implement the output plan and raw-data copy
    - Plan `.gz` and `.br` variants for HTML, CSS, JavaScript, JSON, JSONL and SVG. Content-hash every asset except HTML entries. Copy Raw_Data_Files byte for byte.
    - Add Vitest examples.
    - _Requirements: 18.7, 21.8_
  - [ ]* 13.12 Write property test for the build output plan
    - **Property 46: Build output plan**
    - **Validates: Requirements 21.8**
  - [ ]* 13.13 Write property test for raw data files copied unchanged
    - **Property 22: Raw data files are copied unchanged**
    - **Validates: Requirements 18.7**

- [ ] 14. Share images and icons
  - [ ] 14.1 Write the Share_Image and icon script
    - `scripts/share-images.ts` writes four 1200 by 630 PNGs (Home, Kit, Evidence, How Kiro) deterministically. Add the SVG favicon, 32 px PNG, 180 px Apple touch icon and the web manifest to `site/public/`.
    - Add a Vitest example that runs the script twice and compares bytes, and reads PNG header dimensions.
    - _Requirements: 24.3, 24.4, 24.8_

- [ ] 15. Browser islands
  - [ ] 15.1 Implement the Copy_Snippet island
    - Copy the exact text, show a confirmation for 2 s, then restore. On failure select the text and show a message within 100 ms.
    - Add Vitest examples with a fake clipboard.
    - _Requirements: 10.1, 13.6, 13.7_
  - [ ]* 15.2 Write property test for copy snippet
    - **Property 23: Copy snippet copies exact text**
    - **Validates: Requirements 10.1, 13.6, 13.7**
  - [ ] 15.3 Implement the Polar_Figure island
    - Hydrate the reserved box, draw the boundary and the reference circle with `--break` and `--hold` plus a dashed stroke below the bound, pointer and keyboard (left and right arrows) readouts of direction and force, a phase selector when data has phases, and the build-time alt and Raw_Data_File link when data fails to load.
    - Add Vitest DOM examples.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.10, 16.11, 23.2_
  - [ ] 15.4 Implement the Replay_Loop island
    - Start fetching within one viewport height, pause outside the viewport, reserve size, show still image, alt and Studio link within 1 s of a failure, and step one frame per activation under `prefers-reduced-motion`.
    - Add Vitest examples with a fake `IntersectionObserver`.
    - _Requirements: 2.10, 8.4, 8.5, 8.7, 8.8, 23.2_
  - [ ] 15.5 Implement the pipeline figures island
    - Start live figures within one viewport height and stop when farther away. Label each figure "live" or "recorded".
    - Add Vitest examples with a fake `IntersectionObserver`.
    - _Requirements: 7.10, 7.11_
  - [ ] 15.6 Implement the Hero_Studio island
    - Mount the G1 Stage and Tablet from `golem-spec/ui` with three requirements. Run physics in a worker through `TrialPool`. Drag and keyboard push through one `push()`. Summon 64 ghosts, turn broken Ghosts `--break` and fade within 1 s, re-run on quantity change, render on demand, pause off-screen, show the loading still and the fallback message from `fallbackReason`.
    - Add Vitest examples with a fake pool.
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.14, 5.15, 5.16, 23.2, 23.4_
  - [ ] 15.7 Wire page entry scripts
    - Per-page entry scripts mount the Theme_Switch, Copy_Snippets, the lexicon filter and the islands. The hero chunk loads by dynamic `import()` after first contentful paint. No WASM, robot asset or recording is referenced in the HTML or preloaded.
    - Add a Vitest example that checks the entry order.
    - _Requirements: 2.11, 4.3, 14.8, 21.4, 21.6_

- [ ] 16. Page rendering
  - [ ] 16.1 Implement the page renderers
    - Render static HTML with Column text, tables, lists and Text_Alternatives for Home (hero placeholder, problem, six pipeline steps, two apps, evidence, kit in 60 seconds, limits, call to action, then Footer), Kit, Evidence (falsifier, polar, gate, methods, weaknesses), How Kiro (inventory, surfaces, notes) and the changelog. One `h1`, one `main`, content at least one viewport tall above the Footer.
    - _Requirements: 1.1, 5.1, 5.2, 5.3, 6.1, 7.1, 8.1, 8.2, 8.3, 9.1, 9.2, 9.4, 9.5, 10.1, 10.3, 10.4, 11.1, 11.3, 11.4, 11.5, 11.6, 12.9, 13.1, 13.10, 15.1, 16.1, 17.1, 19.1, 19.11, 20.4, 21.7_
  - [ ] 16.2 Write example tests for the rendered content
    - Vitest checks on built HTML: section order on Home, the three commands in order, the same not-a-proof wording on Home and Evidence, the limits statements, the call to action followed directly by the Footer, the eight Kiro surfaces, the "live" or "recorded" labels, and Column text present without JavaScript.
    - _Requirements: 6.1, 7.10, 9.4, 10.3, 11.1, 11.3, 11.4, 11.6, 18.5, 19.7, 21.7_

- [ ] 17. Build orchestration
  - [ ] 17.1 Implement the build orchestrator
    - Run in order: Node check, import guard, generate, render, `vite build` with the `/stagger/` and `/candy/` studio entries, hashing and compression, then link, metadata, alt, structure and origin checks. Stage output in a temporary directory and rename it to the Static_Deploy_Directory only when every check passes. Fail naming a missing studio entry and its app.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 18.7, 21.6, 21.8_
  - [ ] 17.2 Write build failure example tests
    - Remove a studio entry, an evidence file, the changelog and the notes file in turn and expect a non-zero exit, a message naming the missing item, and no output directory. Check the built output for one HTML entry per page, studio WASM and robot assets, and the separate hero chunk.
    - _Requirements: 1.1, 1.2, 1.7, 9.3, 12.8, 20.5, 21.6_

- [ ] 18. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 19. Playwright smoke suite
  - [ ] 19.1 Set up the smoke suite
    - Playwright config, a static file server for the Static_Deploy_Directory, a layout-shift observer installed with `addInitScript` (ignoring entries with recent input), and a route guard that fails any request to a foreign origin. Simulation horizons at most 2 s.
    - _Requirements: 26.9, 26.10, 26.11_
  - [ ] 19.2 Write the 36-combination page matrix
    - For `/`, `/kit`, `/evidence`, `/how-kiro`, `/stagger/` and `/candy/` at 1440, 390 and 375 px in dark and light: no horizontal scroll, layout shift at most 0.01 after scrolling to the Footer plus 2 s, one `h1`, `main` and `footer`, Open Graph tags, non-empty Text_Alternatives, Footer sitemap, licences and repository link. Test titles carry page, viewport and theme.
    - _Requirements: 21.3, 22.1, 23.5, 23.6, 24.2, 26.1, 26.2, 26.3, 26.4, 26.5, 26.9_
  - [ ] 19.3 Write the Home hero tests
    - "Shove it" and the Summon_Button visible at 1440 by 900 and 390 by 844, at least one Ghost within 5 s of activation, keyboard push equals drag push, zero idle render calls, no WASM or recording request before first contentful paint, and replay recordings not requested before the replay nears the viewport.
    - _Requirements: 5.3, 5.6, 5.7, 5.9, 8.4, 21.4, 23.4, 26.6_
  - [ ] 19.4 Write the Evidence polar and theme tests
    - Right arrow on the Polar_Figure changes both the direction in degrees and the force in N. The Theme_Switch flips `data-theme` and the value survives a reload with no frame in the other theme.
    - _Requirements: 4.3, 4.4, 16.4, 26.7, 26.8_
  - [ ] 19.5 Write failure-path and computed-style tests
    - Abort woff2 requests, a replay recording and the polar data, emulate reduced motion, blocked storage and disabled JavaScript. Check Column max width 72ch, 16 px body text, font sizes within the scale, 44 px hit areas below 1024 px, 2 px focus ring, and full-bleed width within 1 px.
    - _Requirements: 2.1, 2.2, 2.4, 2.10, 3.6, 4.7, 8.8, 14.8, 16.11, 21.7, 22.3, 22.4, 23.3_

- [ ] 20. Lighthouse CI
  - [ ] 20.1 Add Lighthouse CI config and wrapper
    - `@lhci/cli` config that runs 3 consecutive audits of `/` and `/kit` on the static directory with the default mobile profile and asserts a performance score of at least 90 each run. The wrapper prints the five audits with the largest point loss (score and loss) and exits non-zero on failure.
    - Add a Vitest example for the wrapper's report on a fixed audit list.
    - _Requirements: 21.1, 21.2, 21.9_
  - [ ]* 20.2 Write property test for the Lighthouse failure report
    - **Property 47: Lighthouse failure report**
    - **Validates: Requirements 21.9**

- [ ] 21. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster first pass. Each of the 47 design properties has exactly one `*` task.
- Property tests use fast-check with at least 100 runs and sit in separate files so they can run in parallel.
- Playwright and Lighthouse tasks are not optional because the spec requires them.
- Pure logic is tested with properties. Layout, CLS, network and Lighthouse behaviour is tested in Playwright and Lighthouse CI only.
- Playwright and Lighthouse runs use short horizons (2 s of sim time or less). Long campaigns stay in `evidence/`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "4.1", "4.4", "7.1", "7.3", "8.1", "8.10", "10.1", "10.2", "12.1", "11.1", "12.3"] },
    { "id": 2, "tasks": ["1.3", "1.4", "2.2", "2.3", "3.1", "4.2", "4.3", "4.5", "5.1", "6.1", "7.2", "7.4", "7.5", "8.2", "8.3", "8.4", "8.11", "8.12", "8.13", "8.14", "8.15", "8.16", "10.3", "10.5", "11.2", "11.3", "12.2", "12.4", "13.1", "13.3", "13.6", "13.8", "13.11"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.6", "5.2", "5.3", "6.2", "6.3", "6.4", "7.6", "8.5", "8.7", "10.4", "13.2", "13.4", "13.5", "13.7", "13.9", "13.10", "13.12", "13.13", "15.1", "15.3"] },
    { "id": 4, "tasks": ["6.5", "8.6", "8.8", "8.9", "9.1", "14.1", "15.2", "15.4", "15.5", "15.6"] },
    { "id": 5, "tasks": ["9.2", "9.3", "15.7", "16.1"] },
    { "id": 6, "tasks": ["16.2", "17.1"] },
    { "id": 7, "tasks": ["17.2"] },
    { "id": 8, "tasks": ["18"] },
    { "id": 9, "tasks": ["19.1", "20.1"] },
    { "id": 10, "tasks": ["19.2", "19.3", "19.4", "19.5", "20.2"] },
    { "id": 11, "tasks": ["21"] }
  ]
}
```
