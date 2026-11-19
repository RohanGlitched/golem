# Requirements Document

## Introduction

The `golem-site` feature is the public website of GOLEM, in `site/` (see `.kiro/steering/structure.md`). It is a Vite multi-page static build with four pages: `/` (home), `/kit`, `/evidence` and `/how-kiro`. The same build bundles the two app studios at `/stagger/` and `/candy/`, so the whole site deploys as static files with no server and no runtime network access beyond static assets (see `.kiro/steering/tech.md`).

The site follows `.kiro/steering/design-language.md`, which is binding. Pages read like a lab notebook: a left-aligned single column of at most 72ch, with full-bleed figures that break out of it. Type is B612, B612 Mono and Gloock, self-hosted as woff2. Dark and light themes use the tokens in the design language. Every page runs from the top to a rich footer and never ends abruptly.

The site shows GOLEM's product (`.kiro/steering/product.md`): EARS acceptance criteria become physics property tests. It follows the product voice: plain, exact and physical, with units everywhere, and it states limits plainly. A pass is never described as a proof.

Content that can be derived from the repository is generated at build time, not typed by hand. These sources are:

- The lexicons of `apps/stagger` and `apps/candy` (the EARS dialect reference on `/kit`).
- The committed raw results in `evidence/` (the headline numbers and figures on `/` and `/evidence`).
- The `.kiro/` directory and the CLI and MCP definitions of `skeleton/` (the lists on `/kit` and `/how-kiro`).

This spec depends on these specs and does not redefine them:

- `golem-studio-ui`: the studio components (stage, tablet, ghost swarm, reel) that the home hero and the app pages embed.
- `golem-ears`: the lexicon and the dialect that `/kit` documents.
- `golem-falsify`: the falsifier, shrinker and seed database that the home page explains and `/evidence` measures.
- `golem-sim`: the MuJoCo WASM episode runner that the embedded studios use.
- `golem-kit`: the CLI, MCP tools, hooks, agents, skills, power and workflow that `/kit` documents.
- `golem-evidence`: the benchmark scripts and raw results that `/evidence` presents.
- `stagger-app` and `candy-app`: the two apps whose studios the site bundles.

The cross-module contracts in `interfaces.md` are fixed. This spec only reads them. Where a section below mentions a number from `evidence/`, the site shows the number that the committed data contains, never a number typed into a page by hand.

Assumptions made in this document:

- The apps' studio pages (`apps/stagger/web/` and `apps/candy/web/`) exist and expose a build entry that `site/` can include. The site does not modify them.
- The committed results in `evidence/` are JSONL files with a manifest that names each result, its budget, its commit and its pre-registration file.
- "Recorded replay" means a pose recording (`TrialResult.poses`) stored as a static asset and played by the shared replay component, not a video file.
- Lighthouse and Playwright run against the production build served as static files.
- The 72ch measure applies to text. Figures, tables of the EARS dialect and code blocks may be wider than the column, up to the full viewport width.

## Glossary

- **Site**: The static website built from `site/`, including the bundled studios.
- **Site_Build**: The Vite multi-page build that produces the Site as static files.
- **Page**: One HTML entry of the Site: Home, Kit, Evidence, How_Kiro, or a bundled Studio.
- **Home**: The page at `/`.
- **Kit_Page**: The page at `/kit`.
- **Evidence_Page**: The page at `/evidence`.
- **How_Kiro_Page**: The page at `/how-kiro`.
- **Studio**: An app's studio page: the Stagger_Studio at `/stagger/` or the Candy_Studio at `/candy/`.
- **Hero_Studio**: The live G1 studio embedded as the first element of Home, with the Stage and a Tablet showing three requirements.
- **Stage**: The three.js view of the robot, defined in `golem-studio-ui`.
- **Tablet**: The panel that shows requirements as readable sentences with draggable quantities, defined in `golem-studio-ui`.
- **Ghost**: A translucent copy of the robot that shows one falsifier trial, defined in `golem-studio-ui`.
- **Shove**: The action of dragging the robot on the Stage to push it.
- **Summon_Button**: The button on the Hero_Studio that summons the Ghosts.
- **Column**: The left-aligned text column of a Page, at most 72ch wide.
- **Figure**: A visual or interactive element on a Page: a live studio fragment, a recorded replay, a chart, a polar plot or a diagram.
- **Full_Bleed_Figure**: A Figure that spans the full viewport width and breaks out of the Column.
- **Text_Alternative**: A plain-text description of a Figure that states what it shows and its key numbers, available to assistive technology and visible or expandable on the Page.
- **Pipeline_Sequence**: The annotated sequence on Home: EARS line, scenario space and monitor, Ghosts (random and guided), shrink, pinned seed, agent Stop gate.
- **Pipeline_Step**: One step of the Pipeline_Sequence, with a title, an explanation and a Figure.
- **Replay_Loop**: A looping recorded replay of an app.
- **Headline_Number**: A number shown on Home that comes from `evidence/`, with its unit, its budget and a link to the matching section of the Evidence_Page.
- **Evidence_Manifest**: The committed file in `evidence/` that lists each result with its id, title, budget, commit, method note, pre-registration link, raw data path and stated limits.
- **Raw_Data_File**: A committed JSONL result file in `evidence/`.
- **Pre_Registration**: The committed document that fixes a benchmark's method, budget and analysis before the benchmark ran.
- **Falsifier_Benchmark**: The result that compares guided search against random search on the same budget.
- **Stability_Map**: The measured map of the G1's maximum survived push force per push direction.
- **Polar_Figure**: The interactive polar plot of the Stability_Map.
- **Gate_AB**: The result that compares agent runs with and without the `golem gate` Stop hook.
- **Lexicon_Reference**: The section of the Kit_Page that lists every phrase template of both apps' lexicons with the units of its slots.
- **Kit_Entry**: One item on the Kit_Page (a CLI command, an MCP tool, a hook, an agent, a skill, the power, the workflow or the Crew app) with a one-sentence description and a Copy_Snippet.
- **Copy_Snippet**: A code block with a button that copies its text to the clipboard.
- **Kiro_Inventory**: The list on the How_Kiro_Page of specs, steering files, hooks, agents, MCP servers, powers, skills and workflows, generated from the repository.
- **Inventory_Generator**: The build-time script that reads the repository and writes the data files for the Lexicon_Reference, the Kit_Entries, the Kiro_Inventory and the Headline_Numbers.
- **Footer**: The rich footer shared by every Page.
- **Theme**: One of `dark` or `light`, as defined by the Tokens in `design-language.md`.
- **Theme_Switch**: The control that sets the Theme.
- **Token**: A named CSS custom property from `design-language.md` (`--ground`, `--ground-2`, `--ink`, `--ink-2`, `--clay`, `--ghost`, `--break`, `--hold`).
- **Font_Set**: The self-hosted woff2 files for B612, B612 Mono and Gloock.
- **Share_Image**: The Open Graph image of a Page, a static PNG at 1200 by 630 px.
- **Smoke_Suite**: The Playwright tests that load each Page and check the quality rules.
- **Viewport_Profile**: One of three viewport widths used by the Smoke_Suite: 1440 px, 390 px, 375 px.
- **CLS**: Cumulative Layout Shift as reported by Lighthouse and by the browser Layout Instability API.
- **Static_Deploy_Directory**: The output directory of the Site_Build, which contains only static files.

## Requirements

### Requirement 1: Build the Site as a static multi-page site

**User Story:** As a maintainer, I want the whole Site to build into static files, so that I can host it on any static file host with no server.

#### Acceptance Criteria

1. WHEN the Site_Build completes, THE Site_Build SHALL produce exactly one HTML entry for each of `/`, `/kit`, `/evidence` and `/how-kiro`, each reachable at its path from the Static_Deploy_Directory served by a plain static file server and answering with a document that has a non-empty `main` element.
2. WHEN the Site_Build completes, THE Site_Build SHALL include the Stagger_Studio at `/stagger/` and the Candy_Studio at `/candy/` in the same Static_Deploy_Directory, each with its own HTML entry, its WASM module and its robot assets.
3. THE Static_Deploy_Directory SHALL contain only files with these extensions: `.html`, `.css`, `.js`, `.wasm`, `.woff2`, `.png`, `.svg`, `.ico`, `.webmanifest`, `.txt`, `.xml`, `.jsonl`, `.json`, pose recordings, compressed variants (`.gz`, `.br`) and licence files, and SHALL contain no server-side script and no file that needs a server process to be read.
4. WHEN a user opens any Page from the Static_Deploy_Directory served by a plain static file server, THE Site SHALL render that Page with every HTTP request made to the serving origin only, and a recorded request log SHALL show 0 requests to any other origin.
5. THE Site SHALL contain 0 analytics scripts and 0 trackers, meaning no script, pixel, beacon or font request to an origin other than the serving origin, in any file of the Static_Deploy_Directory.
6. THE Site_Build SHALL import the skeleton only through `golem-spec`, `golem-spec/ui` and `golem-spec/node`, SHALL import app code only through each app's public entry, and SHALL fail with the file path and import specifier of the first deep import of `skeleton/src/...` or of an app's internal path.
7. IF a Studio build entry required by the Site_Build is missing, THEN THE Site_Build SHALL exit with a non-zero status, SHALL write no Static_Deploy_Directory, and SHALL print a message that names the missing entry and the app it belongs to.
8. WHEN the Site_Build finishes, THE Site_Build SHALL verify that every internal link (`href`) and every asset reference (`src`, CSS `url()`, preload and module imports) in the Static_Deploy_Directory resolves to an existing file, and IF any does not, THEN THE Site_Build SHALL exit with a non-zero status and print the list of unresolved links, each with the Page that contains it.
9. THE Site_Build SHALL run with Node 20 or later, using TypeScript in strict mode, and IF the Node major version is below 20, THEN THE Site_Build SHALL exit with a non-zero status and print a message that states the required and the detected version.

### Requirement 2: Apply the design language to every Page

**User Story:** As a visitor, I want the Site to look and read like a calm lab notebook, so that the Stage is the one bold thing on a screen and the text is easy to read.

#### Acceptance Criteria

1. THE Site SHALL set body text in a Column with a computed maximum width of 72ch, aligned to the left, on every Page at every Viewport_Profile.
2. THE Site SHALL allow a Full_Bleed_Figure to span 100% of the viewport width while the surrounding text stays in the Column, and the measured width of a Full_Bleed_Figure SHALL equal the viewport width within 1 px at each Viewport_Profile.
3. THE Site SHALL set all UI text and EARS sentences in B612, numbers that change in B612 Mono with tabular figures (`font-variant-numeric: tabular-nums`), and Page headlines in Gloock.
4. THE Site SHALL set the body text at 16 px with a line height of 1.55, and SHALL use only the font sizes 13, 16, 20, 25, 31, 39 and 61 px for text, so that the set of computed font sizes on any Page is a subset of those seven values.
5. THE Site SHALL set the EARS keywords WHEN, WHILE, IF, THEN, WHERE, THE and SHALL in capitals at 0.85em with a letter spacing of 0.04em, and SHALL set no other text in all capitals, so that every computed `text-transform: uppercase` or all-capital text run is one of those seven keywords.
6. THE Site SHALL use 0 eyebrow labels, 0 gradients, 0 drop shadows on cards and 0 glow other than on Ghosts, so that no computed `background-image` is a gradient, no card has a `box-shadow` other than `none`, and no element other than a Ghost has a glow effect.
7. THE Site SHALL set borders at 1 px in `--clay` at 35% opacity, controls with a border radius of 2 px and the Stage with a border radius of 0.
8. THE Site SHALL set every text colour and surface colour through the Tokens defined in `design-language.md`, so that no CSS declaration of `color` or `background-color` in the Site's stylesheets holds a literal colour value instead of a Token.
9. THE Site SHALL write headings and button labels in sentence case, and each button label SHALL be a verb phrase that says what happens, such as "Summon 64 ghosts" or "Copy snippet".
10. WHERE the user agent reports `prefers-reduced-motion: reduce`, THE Site SHALL render Ghosts without the rise animation (0 ms animation duration) and SHALL step Replay_Loops one frame per user activation of a step control instead of looping.
11. WHEN a user acts on a Figure with a drag, a click or a typed number, THE Site SHALL show a visible change in that Figure within 100 ms of the action on a device that meets the Lighthouse default mobile profile.

### Requirement 3: Self-host the fonts

**User Story:** As a visitor, I want fonts that load from the Site itself, so that the Site works offline from its origin and does not leak my visit to a third party.

#### Acceptance Criteria

1. THE Site SHALL serve the Font_Set (B612, B612 Mono and Gloock) as woff2 files from the Static_Deploy_Directory, and every font request on every Page SHALL go to the serving origin.
2. THE Site SHALL declare each font face with `font-display: swap`.
3. THE Site SHALL preload, on every Page, the woff2 file of the font face used for body text, with `rel="preload"`, `as="font"`, `type="font/woff2"` and `crossorigin`.
4. THE Site SHALL define a fallback font stack whose size-adjust, ascent-override, descent-override and line-gap-override values are set so that swapping from the fallback to the Font_Set causes a CLS of 0.01 or less on every Page at every Viewport_Profile.
5. THE Site SHALL include the licence notice of each of the three fonts in the Static_Deploy_Directory and SHALL link each notice from the Footer.
6. IF a Font_Set file fails to load, THEN THE Site SHALL render the Page in the fallback font stack with 100% of the Page's text content still present and readable, with no horizontal scrolling and with no error shown to the user.

### Requirement 4: Provide dark and light Themes

**User Story:** As a visitor, I want a dark and a light Theme, so that I can read the Site in the lighting I am in.

#### Acceptance Criteria

1. THE Site SHALL define the dark Theme as the default and the light Theme as "studio daylight", using the Token values in `design-language.md`, so that every Token resolves to a defined value in both Themes.
2. WHERE the user agent reports `prefers-color-scheme: light` and no stored Theme choice exists, THE Site SHALL render the light Theme.
3. WHEN a user activates the Theme_Switch, THE Site SHALL change the Theme on the current Page within 100 ms and SHALL store the choice (`dark` or `light`) in the browser's local storage.
4. WHEN a user opens any Page and a stored Theme choice exists, THE Site SHALL apply that Theme before the first paint, so that no frame is painted in the other Theme.
5. THE Site SHALL give body text a contrast ratio of at least 7:1 against `--ground`, and `--break` text and `--hold` text a contrast ratio of at least 4.5:1 against `--ground`, in both Themes.
6. WHEN the Theme changes, THE Site SHALL pass the new Theme to every Stage and every Figure on the Page, and each of them SHALL redraw with the new Token values within 100 ms of the change.
7. IF the browser blocks local storage, THEN THE Site SHALL apply the Theme chosen in the current session on every Page view within that session where the choice can be held in memory, SHALL fall back to the `prefers-color-scheme` result or the dark Theme on a later session, and SHALL continue without a thrown error or a visible error message.

### Requirement 5: Home hero is a live studio

**User Story:** As a visitor, I want the first thing I see on Home to be the G1 walking in a live studio that I can shove, so that I understand the product by using it.

#### Acceptance Criteria

1. THE Home SHALL show the Hero_Studio as the first content element inside `main`, with a Stage that shows the G1 walking and a Tablet that shows exactly three of the Stagger requirements, each as a readable EARS sentence with its quantities and units.
2. THE Home SHALL contain no hero that places a headline or any text over an image or over the Stage canvas. Text SHALL sit adjacent to the Stage, outside its bounds.
3. THE Hero_Studio SHALL show the text "Shove it" as its first instruction, adjacent to the Stage and visible without scrolling at the Viewport_Profiles 1440 px by 900 px and 390 px by 844 px.
4. WHEN a user drags the robot on the Stage, THE Hero_Studio SHALL apply the drag as a push to the pelvis of the G1. It SHALL show the push force in N, from 0 N to a maximum of 200 N, and the push direction in degrees, from 0° up to but not including 360°. It SHALL update both readouts within 100 ms of each pointer move.
5. WHEN a push ends, THE Hero_Studio SHALL show, within 100 ms after the monitor result is available, whether each of the three requirements on the Tablet held or broke for that push. Each result SHALL use the word "held" or "broke" and a margin in physical units, with the sign convention that positive means held and negative means broke.
6. THE Hero_Studio SHALL show a Summon_Button whose label states the number of Ghosts it summons, with a default of 64, such as "Summon 64 ghosts".
7. WHEN a user activates the Summon_Button, THE Hero_Studio SHALL start the falsifier trials within 100 ms, and SHALL show each trial as a Ghost, with at most 64 Ghosts visible at once. WHEN a trial breaks a requirement, THE Hero_Studio SHALL turn its Ghost to `--break` and fade it out within 1 s.
8. WHEN a user changes a quantity in a requirement on the Tablet, THE Hero_Studio SHALL re-run the test for that requirement within 100 ms of the change, and SHALL replace the previous held or broke result of that requirement with the new one. A re-run in progress SHALL be marked as running in text.
9. THE Hero_Studio SHALL render the Stage on demand, only while simulating, dragging or replaying. While none of these is happening, it SHALL issue 0 render calls per second.
10. THE Hero_Studio SHALL cap the pixel ratio of the Stage at 1.5, and SHALL pause rendering and simulation stepping while the Stage is entirely outside the viewport, resuming within 100 ms of the Stage re-entering it.
11. WHILE the viewport width is below 1024 px, THE Hero_Studio SHALL set the Stage to a height of 56vh and SHALL place the Summon_Button directly under the Stage and the Tablet under the Summon_Button, in a single column.
12. WHILE the viewport width is 1024 px or more, THE Hero_Studio SHALL place the Tablet in a column 380 px wide at the left of the Stage, with the Stage filling the remaining width.
13. THE Hero_Studio SHALL reserve its final layout space, through explicit dimensions or an aspect ratio in CSS, before the WASM module and the robot assets finish loading, so that loading causes a CLS contribution of 0.01 or less at each Viewport_Profile.
14. WHILE the robot assets are loading, THE Hero_Studio SHALL show a still image of the G1 and a text line that states the loading state. The still image SHALL occupy the same bounds as the Stage, and SHALL be replaced by the Stage when the assets finish loading.
15. IF the browser cannot create a WebGL context or cannot instantiate the MuJoCo WASM module, THEN THE Hero_Studio SHALL show a still image of the G1 in the Stage bounds, the three requirements as text, and a message that names which of the two is missing. It SHALL link to the recorded Replay_Loop, SHALL raise no uncaught error, and the rest of Home SHALL stay usable.
16. THE Hero_Studio SHALL run its physics in a Web Worker, with one MuJoCo instance per worker, so that no main-thread task caused by the trials lasts longer than 50 ms while the trials run.

### Requirement 6: Home explains the problem

**User Story:** As a visitor, I want a short, plain statement of the problem, so that I know why a robot controller needs evidence and not only a demo video.

#### Acceptance Criteria

1. THE Home SHALL contain a section, placed after the Hero_Studio and before the Pipeline_Sequence, that states that robot controllers are increasingly written by AI agents and ship with demo videos instead of evidence tied to requirements.
2. THE Home SHALL state in that section what GOLEM provides in its place: a falsification report tied, line by line, to the written requirements.
3. THE Home SHALL write that section in the Column, in 60 to 150 words of plain sentences, with a unit written next to every quantity that appears.
4. THE Home SHALL contain no claim about a measured result in that section unless the claim is a Headline_Number with its value, its unit, its budget and a link to the matching section of the Evidence_Page.
5. THE Home SHALL contain in that section no figure of speech that states a quantity without a number (such as "many", "most" or "often") about robot controllers or about GOLEM's results.

### Requirement 7: Home shows how GOLEM works as an annotated sequence

**User Story:** As a visitor, I want to follow one requirement through the whole pipeline step by step, so that I can see how a written line becomes a physics test and an agent gate.

#### Acceptance Criteria

1. THE Home SHALL contain a Pipeline_Sequence of exactly six Pipeline_Steps in this order: the EARS line, the scenario space and monitor, the Ghosts (random then guided), the shrink, the pinned seed, and the agent Stop gate.
2. THE Home SHALL give each Pipeline_Step a title, an explanation in the Column of at most 80 words, and exactly one Figure.
3. THE Pipeline_Sequence SHALL use one example requirement from the Stagger requirements in every Pipeline_Step, quoted with character-identical text in each step.
4. THE Figure of the EARS-line step SHALL show the requirement sentence with each quantity highlighted and labelled with its unit.
5. THE Figure of the scenario-space-and-monitor step SHALL show the range of each searched dimension with its unit (such as force in N, direction in degrees from 0 to 360, and gait phase from 0 to 1) and the sign convention of the monitor (positive held, negative broke, magnitude in the unit of the margin).
6. THE Figure of the Ghosts step SHALL distinguish random trials from guided trials by a label and a second cue that does not rely on colour, SHALL show the count of trials of each kind, and SHALL show the lowest margin seen so far with its unit.
7. THE Figure of the shrink step SHALL show a failing scenario and its shrunk scenario side by side, with the force in N, the direction in degrees and the gait phase from 0 to 1 for each, and SHALL show that the shrunk force is less than or equal to the original force.
8. THE Figure of the pinned-seed step SHALL show a `.golem/seeds/<app>/<reqId>.json` entry with every field of a `Counterexample` (`reqId`, `scenario`, `seed`, `robustness`, `shrunk`, `foundAfter`).
9. THE Figure of the agent-Stop-gate step SHALL show the output of `golem gate` for one broken requirement, with one line per broken requirement, the exit code 2 and the reproduction command.
10. THE Home SHALL draw each Figure from live computation or from a recorded result that the Site_Build copies from `evidence/` or from an app recording, and SHALL label each Figure "live" or "recorded" in text adjacent to the Figure.
11. WHEN a live Pipeline_Step Figure comes within one viewport height of the visible area, THE Home SHALL start its computation, and WHILE the Figure is farther away, THE Home SHALL run no computation for it.
12. THE Home SHALL give each Pipeline_Step Figure a Text_Alternative that states what the Figure shows and its key numbers with units.

### Requirement 8: Home presents the two apps

**User Story:** As a visitor, I want to see both apps running and open their studios, so that I can see GOLEM work on a humanoid and on an arm.

#### Acceptance Criteria

1. THE Home SHALL contain exactly one section for the Stagger app and exactly one for the Candy app.
2. THE Home SHALL show in each app section a Replay_Loop of that app, a one-sentence description of the app and its requirement categories, and a link to its Studio.
3. THE Stagger section SHALL link to `/stagger/` and the Candy section SHALL link to `/candy/`, and each link text SHALL name its Studio.
4. WHEN a Replay_Loop comes within one viewport height of the visible area, THE Home SHALL start loading its recording, and THE Home SHALL not request the recording before that.
5. WHILE a Replay_Loop is outside the viewport, THE Home SHALL pause that Replay_Loop and SHALL render no frames of it.
6. THE Home SHALL give each Replay_Loop a Text_Alternative that states the app, the scenario (with its quantities and units) and the outcome (held or broke, with the margin in physical units) of the recorded run.
7. THE Home SHALL reserve the display size of each Replay_Loop in CSS before it loads, so that loading causes a CLS of 0.01 or less.
8. IF a Replay_Loop recording fails to load, THEN THE Home SHALL show within 1 s of the failure a still image of the app with the Text_Alternative and a link to the Studio, and SHALL keep the rest of the Page unchanged.

### Requirement 9: Home shows measured evidence

**User Story:** As a visitor, I want the headline numbers from the benchmarks with their budgets, so that I can judge the claims and follow them to the data.

#### Acceptance Criteria

1. THE Home SHALL show Headline_Numbers read from the Evidence_Manifest and the Raw_Data_Files at build time, and SHALL show at least one Headline_Number from each of the Falsifier_Benchmark, the Stability_Map and the Gate_AB.
2. THE Home SHALL show for each Headline_Number its value, its unit, the budget it was measured with (trials per run and number of runs, or the manifest's equivalent) and a link to the matching section of the Evidence_Page.
3. IF a Headline_Number cannot be derived because the Evidence_Manifest or a Raw_Data_File it needs is missing or unreadable, THEN THE Site_Build SHALL fail with a message that names the missing file and the number, and SHALL write no Static_Deploy_Directory.
4. THE Home SHALL state next to the Headline_Numbers that a pass means no counterexample was found within the stated search budget and is not a proof.
5. THE Home SHALL link the evidence section to `/evidence`.
6. THE Home SHALL contain no Headline_Number that is typed into the page source and not generated from `evidence/`, and THE Site_Build SHALL fail with the offending number if a Headline_Number in the built Home differs from the value derived from `evidence/`.

### Requirement 10: Home shows the Kiro kit in 60 seconds

**User Story:** As a developer, I want to see how to install the kit and what it adds to my project, so that I can try it in one minute.

#### Acceptance Criteria

1. THE Home SHALL contain a section that shows the command `npx golem-spec init` in a Copy_Snippet whose copied text equals the displayed text exactly.
2. THE Home SHALL list in that section what `golem init` adds under `.kiro/` (steering, hooks, agents, skills, power, workflow and MCP configuration), with one entry per file in `skeleton/kiro-pack/`, generated from that directory.
3. THE Home SHALL show the three commands of the shortest loop (`golem check`, `golem falsify` and `golem gate`) in that order, each with one sentence of at most 25 words on what it does.
4. THE Home SHALL link that section to `/kit`.
5. IF the list of files in `skeleton/kiro-pack/` cannot be read at build time, THEN THE Site_Build SHALL fail with a message that names the directory.

### Requirement 11: Home states the limits and closes with a call to action

**User Story:** As a visitor, I want the limits stated plainly and a clear next step, so that I trust the claims and know what to do next.

#### Acceptance Criteria

1. THE Home SHALL contain a limits section that states that GOLEM does not prove a requirement holds.
2. THE limits section SHALL state that a pass means "no counterexample found within this search budget", and SHALL state the default search budget used by the Evidence_Page benchmarks (trials per run), read from the Evidence_Manifest.
3. THE limits section SHALL state that GOLEM never calls an LLM at runtime to decide a verdict, and that verdicts come only from deterministic monitors.
4. THE limits section SHALL state that simulation results are not measurements of a physical robot.
5. THE Home SHALL end its main content with a closing call to action that links to `/stagger/`, to `/kit` and to the repository, each with link text that names its target.
6. THE Home SHALL place the Footer immediately after the closing call to action, with no content between them.

### Requirement 12: Share a rich Footer on every Page

**User Story:** As a visitor, I want a footer with a sitemap, credits and licences, so that I can find my way and see what the Site is built on.

#### Acceptance Criteria

1. THE Site SHALL show a Footer with identical content on Home, Kit_Page, Evidence_Page, How_Kiro_Page, the changelog Page and each Studio page.
2. THE Footer SHALL contain a sitemap, in a `nav` element, that links to `/`, `/kit`, `/evidence`, `/how-kiro`, `/stagger/` and `/candy/`.
3. THE Footer SHALL contain credits and licences that state: the Unitree G1 model and policy under BSD-3-Clause, the Franka Panda model from MuJoCo Menagerie under Apache-2.0, MuJoCo under Apache-2.0, and GOLEM's own code under Apache-2.0.
4. THE Footer SHALL link to each licence text that the Static_Deploy_Directory contains, including `apps/stagger/robot/LICENSE`, `apps/candy/robot/LICENSE` and the font licence notices, and each link SHALL resolve to an existing file.
5. THE Footer SHALL contain a link to the changelog, and the Site_Build SHALL render the changelog as a Page that lists releases from newest to oldest, generated from the repository's `CHANGELOG.md`.
6. THE Footer SHALL contain a link to the repository.
7. THE Footer SHALL contain the Theme_Switch.
8. IF `CHANGELOG.md` is missing at build time, THEN THE Site_Build SHALL fail with a message that names the file.
9. THE Site SHALL end each Page with the Footer, with content above it that is at least as tall as one viewport height at the Viewport_Profile 1440 px by 900 px.

### Requirement 13: Document the kit on the Kit_Page

**User Story:** As a developer, I want docs for every part of the kit with a snippet I can copy, so that I can use each part without reading the source.

#### Acceptance Criteria

1. THE Kit_Page SHALL contain one section for each of these eight categories, in this order: the CLI commands, the MCP tools, the hooks, the agents, the skills, the power, the workflow and the Crew app.
2. THE Kit_Page SHALL show for each Kit_Entry a name, a one-sentence description of at most 30 words, and one Copy_Snippet.
3. THE Kit_Page SHALL list every command of the `golem` CLI that `skeleton/src/cli/` defines (`check`, `test`, `falsify`, `replay`, `gate`, `init`, `mcp`), generated from the CLI's command definitions, and the number of listed commands SHALL equal the number of commands defined.
4. THE Kit_Page SHALL list every MCP tool that the `golem mcp` server exposes, generated from the server's tool definitions, and the number of listed tools SHALL equal the number of tools defined.
5. THE Kit_Page SHALL list every hook, agent, skill, power and workflow file in `skeleton/kiro-pack/`, generated from that directory, and the number of listed entries per category SHALL equal the number of files of that category in the directory.
6. WHEN a user activates the copy button of a Copy_Snippet, THE Kit_Page SHALL copy the exact text of the snippet, byte for byte, to the clipboard and SHALL change the button label to a confirmation for 2 s, then restore the original label.
7. IF the clipboard cannot be written, THEN THE Kit_Page SHALL select the full snippet text, SHALL show a message within 100 ms that tells the user to copy it by hand, and SHALL leave the snippet text unchanged.
8. THE Kit_Page SHALL give each Kit_Entry a unique anchor id of the form `<section>-<name>` in lowercase with spaces replaced by hyphens, so that a link to `/kit#<id>` scrolls to that entry.
9. THE Kit_Page SHALL show a table of contents that contains one link to each of the eight sections, and each link SHALL target an existing anchor on the Page.
10. THE Kit_Page SHALL end with a closing section that contains at least one link to a next step (`/stagger/`, `/evidence` or the repository), followed by the Footer, and every section SHALL end with a Kit_Entry or a link.

### Requirement 14: Generate the EARS dialect reference from the lexicons

**User Story:** As a robotics engineer, I want every phrase I can write in a requirement with its units, so that I can write lines that compile on the first try.

#### Acceptance Criteria

1. THE Lexicon_Reference SHALL list every `PredicateTemplate` and every `PerturbationTemplate` of the `apps/stagger` lexicon and of the `apps/candy` lexicon.
2. THE Lexicon_Reference SHALL show for each template its phrase exactly as written in the lexicon (character for character), its kind (predicate or perturbation), the app it belongs to, the type of each slot, the accepted units of each slot, and, for a predicate, the unit of its margin.
3. THE Inventory_Generator SHALL read the lexicons by importing them from each app's public entry and SHALL write the Lexicon_Reference data without any hand-typed phrase.
4. THE Lexicon_Reference SHALL list the accepted units (N, kN, m, cm, mm, s, ms, m/s, cm/s, deg, °, rad, kg, g, %) with the SI unit of each and the factor that converts it to SI (for example kN to N: 1000).
5. THE Lexicon_Reference SHALL show the five EARS patterns (ubiquitous, event, state, unwanted, optional) with the shape of each and what each compiles to, matching `.kiro/steering/ears-for-robots.md`.
6. THE Lexicon_Reference SHALL show for each template exactly one example line that the `golem-ears` compiler accepts.
7. THE Inventory_Generator SHALL compile each example line with the `golem-ears` compiler at build time, and IF any example line does not compile, THEN THE Site_Build SHALL fail with the line and its diagnostic.
8. THE Lexicon_Reference SHALL let a user filter the templates by app and by kind and SHALL apply a filter within 100 ms, and WHILE JavaScript is unavailable, THE Lexicon_Reference SHALL show the full unfiltered list.
9. THE Lexicon_Reference SHALL show one example of a compile error with its suggestion (the closest template by token edit distance), produced by the compiler at build time.
10. FOR ALL apps, the number of templates listed in the Lexicon_Reference SHALL equal the number of templates in that app's lexicon (completeness property).

### Requirement 15: Present the falsifier benchmark

**User Story:** As a researcher, I want the guided-versus-random benchmark with its method and limits, so that I can judge whether guided search finds failures sooner.

#### Acceptance Criteria

1. THE Evidence_Page SHALL show the Falsifier_Benchmark as a Figure that compares guided search with random search on the same budget, with the number of trials to the first counterexample (a count, median over runs) and the fraction of runs that found a counterexample (0 to 1, or %) for each method.
2. THE Evidence_Page SHALL state the budget (trials per run and number of runs), the seeds, the commit hash and the date of the Falsifier_Benchmark, read from the Evidence_Manifest.
3. THE Evidence_Page SHALL show an uncertainty interval (lower and upper bound, with its confidence level) for each reported number, and SHALL name the method used to compute it.
4. THE Evidence_Page SHALL state the limits of the Falsifier_Benchmark, read from the Evidence_Manifest, including the list of requirement ids and apps that it covered.
5. THE Evidence_Page SHALL link the Pre_Registration of the Falsifier_Benchmark.
6. THE Evidence_Page SHALL link each Raw_Data_File of the Falsifier_Benchmark and SHALL state its size in bytes (or KB) and its format (JSONL).
7. THE Evidence_Page SHALL give the Figure a Text_Alternative that states the trials-to-first-counterexample and the fraction of runs with a counterexample for both search methods, with their uncertainty intervals.
8. IF the Evidence_Manifest lists a result with no Pre_Registration link, THEN THE Site_Build SHALL fail with a message that names the result.

### Requirement 16: Present the G1 stability map as an interactive polar figure

**User Story:** As a robotics engineer, I want to explore the measured push-recovery boundary of the G1 by direction, so that I can see where the robot is weakest.

#### Acceptance Criteria

1. THE Evidence_Page SHALL show the Stability_Map as a Polar_Figure whose angle is the push direction in degrees (0° to 360°) and whose radius is the maximum survived push force in N.
2. THE Polar_Figure SHALL draw the measured boundary as a closed curve and SHALL draw the requirement's force bound (in N) as a reference circle.
3. WHEN a user moves a pointer over the Polar_Figure or moves the keyboard focus along it, THE Polar_Figure SHALL show, within 100 ms, the direction in degrees and the maximum survived force in N at the nearest measured direction.
4. THE Polar_Figure SHALL be operable by keyboard, with the left arrow key stepping the direction by one measured step counter-clockwise and the right arrow key by one measured step clockwise, wrapping at 360°.
5. THE Polar_Figure SHALL colour the part of the boundary below the requirement's force bound with `--break` and the part at or above it with `--hold`, and SHALL mark the difference with a second cue that does not rely on colour (a dashed stroke for the part below the bound).
6. WHERE the Stability_Map data contains the gait phase, THE Polar_Figure SHALL offer a control to select the gait phase from 0 to 1 in the measured steps and SHALL redraw within 100 ms of a change.
7. THE Evidence_Page SHALL state the budget, the resolution (number of directions and number of phases measured), the commit hash and the limits of the Stability_Map, read from the Evidence_Manifest.
8. THE Evidence_Page SHALL link the Pre_Registration and each Raw_Data_File of the Stability_Map.
9. THE Evidence_Page SHALL give the Polar_Figure a Text_Alternative that states the weakest direction in degrees, its maximum survived force in N, the strongest direction in degrees and its force in N, computed from the data.
10. THE Polar_Figure SHALL render at the same size for any data, with its space reserved before the data loads, so that loading causes a CLS of 0.01 or less.
11. IF the Stability_Map data fails to load, THEN THE Evidence_Page SHALL show the Text_Alternative from the build-time data and a link to the Raw_Data_File.
12. FOR ALL directions in the Stability_Map data, the radius drawn by the Polar_Figure SHALL equal the maximum survived force in the data at that direction, within a relative error of 1e-9 (rendering fidelity property).

### Requirement 17: Present the agent-gate A/B

**User Story:** As a team lead, I want to see whether the Stop gate changes what an agent ships, so that I can decide whether to adopt it.

#### Acceptance Criteria

1. THE Evidence_Page SHALL show the Gate_AB as a Figure that compares agent runs with the `golem gate` Stop hook and without it.
2. THE Evidence_Page SHALL show for each arm of the Gate_AB the number of runs, the number of runs that ended with every requirement held and the number that ended with at least one requirement broken, and the two outcome counts SHALL sum to the number of runs.
3. THE Evidence_Page SHALL describe the task given to the agents, the agent and model identifiers, the budget and the commit hash, read from the Evidence_Manifest.
4. THE Evidence_Page SHALL state the limits of the Gate_AB, including the number of runs per arm and the list of tasks covered, read from the Evidence_Manifest.
5. THE Evidence_Page SHALL link the Pre_Registration and each Raw_Data_File of the Gate_AB.
6. THE Evidence_Page SHALL give the Figure a Text_Alternative that states the run count, held count and broken count of both arms.
7. THE Evidence_Page SHALL describe the Gate_AB with no causal claim beyond what its stated number of runs supports, and SHALL show an uncertainty interval for the difference between the arms, naming the method.

### Requirement 18: Document methods, budgets and limits of every result

**User Story:** As a reader, I want every result to carry its method, budget and limits, so that I can reproduce it or reject it.

#### Acceptance Criteria

1. THE Evidence_Page SHALL show for each result in the Evidence_Manifest a method note, a budget, a commit hash, a link to the Pre_Registration, links to the Raw_Data_Files and a limits statement.
2. THE Evidence_Page SHALL show for each result the command that reproduces it, in a Copy_Snippet.
3. THE Evidence_Page SHALL render these fields from the Evidence_Manifest and SHALL contain no hand-typed copy of them.
4. IF a result in the Evidence_Manifest lacks any of the fields in criterion 1 or criterion 2, THEN THE Site_Build SHALL fail with a message that names the result and the missing field.
5. THE Evidence_Page SHALL state, in the same words as on Home, that a pass means no counterexample found within the stated budget and is not a proof.
6. THE Evidence_Page SHALL end with a section that lists known weaknesses of the evidence, with at least one item per result, followed by the Footer.
7. THE Evidence_Page SHALL provide each Raw_Data_File as a link that downloads the committed file unchanged, so that its SHA-256 equals that of the file in the repository.

### Requirement 19: Show how Kiro built GOLEM

**User Story:** As a hackathon reviewer, I want to see how Kiro was used to build GOLEM, generated from the repository, so that I can check the claims against the files.

#### Acceptance Criteria

1. THE How_Kiro_Page SHALL show the Kiro_Inventory with these eight lists, in this order: specs, steering files, hooks, agents, MCP servers, powers, skills and workflows.
2. THE How_Kiro_Page SHALL show for each spec its name, its number of requirements and its number of tasks, counted from its `requirements.md` and `tasks.md`.
3. THE Inventory_Generator SHALL count a requirement as each `### Requirement N` heading in `requirements.md` and a task as each checkbox item (`- [ ]` or `- [x]`) in `tasks.md`.
4. THE How_Kiro_Page SHALL show for each steering file its name and its inclusion mode, read from its front matter, with a link to the file in the repository.
5. THE How_Kiro_Page SHALL show for each hook its name, its trigger event and its action type, read from the hook file.
6. THE How_Kiro_Page SHALL show for each agent, MCP server, power, skill and workflow its name and a one-sentence purpose of at most 30 words read from the file.
7. THE How_Kiro_Page SHALL state which Kiro surface did which work (specs, steering, hooks, agents, MCP, powers, skills and the agent chat), with one example link into the repository for each of the eight surfaces.
8. IF a listed item in `.kiro/` has no readable purpose line, THEN THE Inventory_Generator SHALL write the item with its name and the text "no description in file", and SHALL print a warning that names the item during the Site_Build.
9. THE How_Kiro_Page SHALL show the total of each list, and each total SHALL equal the number of items shown in that list.
10. THE Inventory_Generator SHALL regenerate the Kiro_Inventory on every Site_Build, so that the lists match the repository at the built commit, and THE How_Kiro_Page SHALL show the commit hash.
11. THE How_Kiro_Page SHALL end with a closing section that contains at least one link to a next step, followed by the Footer.

### Requirement 20: State honestly what went wrong

**User Story:** As a reader, I want honest notes on what went wrong while building GOLEM with Kiro, so that I can learn from the failures and trust the rest.

#### Acceptance Criteria

1. THE How_Kiro_Page SHALL contain a section of notes on what went wrong, read from a committed notes file in the repository (`site/content/what-went-wrong.md`).
2. THE How_Kiro_Page SHALL show each note with a short title of at most 80 characters, what happened, what it cost (in time, trials, or tasks, with units), and what was changed in response.
3. THE How_Kiro_Page SHALL link each note to the commit, spec or file that shows the problem or the fix, where one exists, and SHALL show the text "no link" for a note that has none.
4. THE How_Kiro_Page SHALL write these notes in the same plain voice as the rest of the Site, with no spooky wording in the notes and no claim that is not in the repository.
5. IF the notes file is missing or has no notes at build time, THEN THE Site_Build SHALL fail with a message that names the file.

### Requirement 21: Meet the performance bar

**User Story:** As a visitor on a modest device, I want the Site to load fast and stay stable, so that I can read it without waiting or watching the page jump.

#### Acceptance Criteria

1. WHEN Lighthouse audits `/` served from the Static_Deploy_Directory with its default mobile profile, THE Site SHALL achieve a performance score of at least 90 in each of 3 consecutive runs.
2. WHEN Lighthouse audits `/kit` served from the Static_Deploy_Directory with its default mobile profile, THE Site SHALL achieve a performance score of at least 90 in each of 3 consecutive runs.
3. THE Site SHALL cause a CLS of 0.01 or less on every Page at every Viewport_Profile, measured from navigation start until the user has scrolled to the Footer and 2 s have passed.
4. THE Site SHALL issue no request for the MuJoCo WASM module, the robot assets or the pose recordings before the first contentful paint of the Page.
5. THE Site SHALL give every image, Figure and Stage an explicit width and height, or an aspect ratio, in CSS, so that the reserved box has the same size before and after its content loads.
6. THE Site SHALL load the Hero_Studio code as a separate chunk from the text and styles of Home, and the HTML and CSS of Home SHALL be requested and render the Column text before the Hero_Studio chunk has finished downloading.
7. THE Site SHALL include the Column content of every Page in its HTML, so that the Column text is present when JavaScript is disabled.
8. THE Site_Build SHALL write a gzip file and a brotli file for each static text asset (HTML, CSS, JavaScript, JSON, JSONL and SVG), and SHALL include a content hash in the file name of each asset other than the HTML entries.
9. IF a Lighthouse run in CI scores below 90 on `/` or `/kit`, THEN THE CI job SHALL fail with a non-zero exit code and SHALL print the 5 audits that lost the most points, each with its score and its point loss.

### Requirement 22: Work at every viewport width

**User Story:** As a visitor on a phone, I want the Site to fit my screen, so that I never scroll sideways.

#### Acceptance Criteria

1. THE Site SHALL cause no horizontal scrolling on any Page at a viewport width of 375 px, 390 px and 1440 px, in both Themes, so that the document scroll width is no greater than the viewport width.
2. WHEN a Full_Bleed_Figure, a table or a code block is wider than the viewport, THE Site SHALL contain its overflow inside the element, so that the document scroll width stays no greater than the viewport width.
3. WHILE the viewport width is below 1024 px, THE Site SHALL set every interactive control to a hit area of at least 44 px by 44 px.
4. THE Site SHALL keep body text at 16 px at every viewport width from 375 px to 1440 px and SHALL not rely on browser zoom to fit.
5. WHILE the viewport width is below 640 px, THE Lexicon_Reference table SHALL reflow into one card per template, with no sideways scroll inside or outside the Lexicon_Reference.
6. THE Polar_Figure SHALL scale to the viewport width down to 375 px, SHALL keep its labels at 13 px or larger, and SHALL keep its aspect ratio constant at every width.

### Requirement 23: Make every Figure accessible

**User Story:** As a visitor using a screen reader or keyboard, I want every Figure to have a text alternative and to work from the keyboard, so that I get the same information as a sighted mouse user.

#### Acceptance Criteria

1. THE Site SHALL give every Figure a Text_Alternative that states what the Figure shows and its key numbers with units, and that is at least 1 sentence and at most 80 words.
2. THE Site SHALL give every Stage, Replay_Loop and Polar_Figure a non-empty accessible name and an ARIA role.
3. THE Site SHALL make every control of a Figure reachable and operable by keyboard, with a visible focus indicator of at least 2 px and a contrast ratio of at least 3:1 against the adjacent colours, in both Themes.
4. THE Hero_Studio SHALL offer a keyboard action that applies a push to the G1, with the force in N and the direction in degrees set by keyboard, as an alternative to dragging, and SHALL show the same result as a drag push.
5. THE Site SHALL use semantic landmarks on every Page: exactly one `main`, exactly one `nav` for the sitemap, and exactly one `footer`.
6. THE Site SHALL use exactly one `h1` per Page and heading levels that never skip a level going down.
7. THE Site SHALL not use colour as the only cue for a held or broken state, and SHALL show the word "held" or "broke" and a margin in physical units.
8. THE Site SHALL set a non-empty `lang` attribute on the `html` element of every Page.
9. THE Site SHALL give every link text that states its target, with no link text "click here" or "read more".
10. WHEN the Site_Build finishes, THE Site_Build SHALL fail with a list of the Pages and Figures that have no Text_Alternative.

### Requirement 24: Provide metadata, favicon and Share_Images

**User Story:** As someone sharing a link, I want a proper title, description, preview image and icon, so that the link looks right wherever it is posted.

#### Acceptance Criteria

1. THE Site SHALL give every Page a unique non-empty `title` and a unique `meta description` of 1 to 160 characters.
2. THE Site SHALL give every Page Open Graph tags for `og:title`, `og:description`, `og:type`, `og:url` and `og:image`, and the matching Twitter card tags (`twitter:card`, `twitter:title`, `twitter:description` and `twitter:image`).
3. THE Site SHALL provide a Share_Image at 1200 by 630 px for each of Home, Kit_Page, Evidence_Page and How_Kiro_Page, with `og:image:width` set to 1200, `og:image:height` set to 630 and a non-empty `og:image:alt`.
4. THE Site SHALL provide a favicon as an SVG and as a 32 px by 32 px PNG, an Apple touch icon at 180 px by 180 px, and a web manifest, each linked from every Page and present in the Static_Deploy_Directory.
5. THE Site SHALL set exactly one canonical URL on each Page, and the canonical URL SHALL equal the `og:url` of that Page.
6. THE Site SHALL provide a `robots.txt` and a `sitemap.xml`, and the `sitemap.xml` SHALL list every Page of the Site, including `/stagger/` and `/candy/`, and no other URL.
7. IF any Page lacks a required tag or its Share_Image file does not exist, THEN THE Site_Build SHALL fail with a message that names the Page and the missing item.
8. THE Site_Build SHALL generate each Share_Image from a script in `scripts/`, so that running the script twice on the same repository contents writes byte-identical images.

### Requirement 25: Generate repository-derived content deterministically

**User Story:** As a maintainer, I want the generated content to be a pure function of the repository, so that the Site does not drift from the repo and the build is reproducible.

#### Acceptance Criteria

1. THE Inventory_Generator SHALL write its data files as a pure function of the repository contents at the built commit, with no network access and no use of the current time other than the recorded commit date.
2. WHEN the Inventory_Generator runs twice on the same repository contents, THE Inventory_Generator SHALL write byte-identical data files.
3. THE Inventory_Generator SHALL sort every list it writes by a stable key, so that the order does not depend on file system order.
4. THE Inventory_Generator SHALL write each data file as JSON that validates against a schema stored in `site/schema/`, and IF a data file fails validation, THEN THE Inventory_Generator SHALL fail with a message that names the file and the first invalid path.
5. THE Inventory_Generator SHALL include the full commit hash in a `meta.json` file.
6. IF a source file is unreadable or malformed, THEN THE Inventory_Generator SHALL fail with a non-zero exit code and a message that names the file, the line where known, and the expected shape, and SHALL leave previously written data files unchanged.
7. THE Inventory_Generator SHALL read Raw_Data_Files line by line, SHALL skip no malformed line silently, and SHALL fail with the line number of the first malformed line.
8. FOR ALL generated data files, serialising the parsed data back to JSON with the same key order and formatting SHALL produce the original file text (round-trip property).
9. THE Inventory_Generator SHALL be written in TypeScript in strict mode and SHALL contain no call to `Math.random()`.

### Requirement 26: Verify the Site with Playwright smoke tests

**User Story:** As a maintainer, I want automated smoke tests at the target widths in both Themes, so that layout and accessibility regressions are caught before release.

#### Acceptance Criteria

1. THE Smoke_Suite SHALL load each of `/`, `/kit`, `/evidence`, `/how-kiro`, `/stagger/` and `/candy/` at each Viewport_Profile (1440 px, 390 px and 375 px wide) in each Theme (dark and light), which is 36 combinations.
2. WHEN the Smoke_Suite loads a Page, THE Smoke_Suite SHALL assert that the document scroll width does not exceed the viewport width.
3. WHEN the Smoke_Suite loads a Page, THE Smoke_Suite SHALL assert that the Layout Instability total is 0.01 or less after the Page has finished loading, the user has scrolled to the Footer and 2 s have passed.
4. WHEN the Smoke_Suite loads a Page, THE Smoke_Suite SHALL assert that the Page contains exactly one `h1`, exactly one `main`, exactly one `footer` and the Open Graph tags required by Requirement 24, and that every Figure has a non-empty Text_Alternative.
5. WHEN the Smoke_Suite loads a Page, THE Smoke_Suite SHALL assert that the Page reaches the Footer and that the Footer contains the sitemap, the licences and the repository link.
6. WHEN the Smoke_Suite loads Home, THE Smoke_Suite SHALL assert that the Hero_Studio shows the text "Shove it" and the Summon_Button, and that activating the Summon_Button produces at least one Ghost within 5 s.
7. WHEN the Smoke_Suite loads the Evidence_Page, THE Smoke_Suite SHALL assert that moving the keyboard focus along the Polar_Figure with the right arrow key changes both the displayed direction in degrees and the displayed force in N.
8. WHEN the Smoke_Suite activates the Theme_Switch, THE Smoke_Suite SHALL assert that the Theme attribute changes to the other Theme and that it has the same value after a reload.
9. THE Smoke_Suite SHALL fail a test with the Page, the Viewport_Profile and the Theme in the test name.
10. THE Smoke_Suite SHALL run against the Static_Deploy_Directory served as static files and SHALL fail any test that makes a request to an origin other than the serving origin.
11. THE Smoke_Suite SHALL run with short simulation horizons of at most 2 s of simulated time and small budgets, and SHALL keep long campaigns in `evidence/`.

### Requirement 27: Test the pure logic of the Site with properties

**User Story:** As a maintainer, I want the build-time and data logic covered by property tests, so that the generated content stays correct as the repository changes.

#### Acceptance Criteria

1. THE Site SHALL include fast-check property tests, each run with at least 100 generated cases, for the Inventory_Generator, the Headline_Number derivation, the Lexicon_Reference builder, the Polar_Figure geometry and the Text_Alternative builders.
2. FOR ALL valid Evidence_Manifest inputs, deriving the Headline_Numbers twice SHALL produce equal results (determinism property).
3. FOR ALL generated Stability_Map data, converting a (direction, force) pair to Polar_Figure coordinates and back SHALL return the pair within a relative error of 1e-9 (round-trip property).
4. FOR ALL lexicons, the Lexicon_Reference builder SHALL list each template exactly once (completeness property).
5. FOR ALL Stability_Map data, the weakest direction named in the Text_Alternative SHALL be a direction whose force is the minimum of the data (invariant property).
6. FOR ALL repository trees, the totals shown in the Kiro_Inventory SHALL equal the number of items in each list (invariant property).
7. FOR ALL requirement files, the counted number of requirements SHALL equal the number of `### Requirement N` headings (invariant property).
8. FOR ALL sets of internal links, the link checker SHALL report exactly the links whose target does not exist, with no false positive and no false negative (soundness property).
9. THE Site SHALL name each test to state the behaviour it checks, such as `it('fails the build when a result has no pre-registration link')`.
10. THE Site SHALL never weaken an assertion or a requirement to make a test pass, and IF a test is wrong, THEN the commit message that changes it SHALL state why.
