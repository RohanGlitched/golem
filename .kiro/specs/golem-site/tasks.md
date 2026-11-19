# Implementation Plan: golem-site

Compact plan, done sequentially in one session. One commit per page: `golem-site: <n> <what>`.

- [x] 1. Scaffold, fonts, theme, layout and footer
  - Vite multi-page config, pages plugin, aliases for `golem-spec`, fonts (B612, B612 Mono, Gloock + OFL), `site.css` with the design tokens, theme toggle, shared header and footer, `/404.html`, favicon.
  - _Requirements: 1, 2, 3, 4, 12, 24_
- [x] 2. Home page `/`
  - Studio hero (lazy), problem, six pipeline figures, two robots, measured results, kit in 60 s, limits, call to action.
  - _Requirements: 5 to 11, 23_
- [x] 3. Studios at `/stagger/` and `/candy/`
  - Generic studio entry, workers, robot files copied into `dist`, tolerance for a missing candy studio.
  - _Requirements: 1, 5_
- [x] 4. Kit page `/kit`
  - CLI transcript excerpts, MCP tools, hooks, agents, skills, Power, workflow, Crew app, EARS dialect reference from `lexicon.json`.
  - _Requirements: 13, 14_
- [x] 5. Evidence page `/evidence`
  - Polar G1 map, falsifier rounds and needle benchmark, candy measurement, agent-gate "pending", methods and limits.
  - _Requirements: 15 to 18, 23_
- [ ] 6. How Kiro built it `/how-kiro`
  - Counts and lists from `kiro.json`, surfaces, audits and bugfix specs, what went wrong.
  - _Requirements: 19, 20, 25_
- [ ] 7. Quality
  - Vitest and fast-check for the pure logic, Playwright smoke at 1440 and 390 in both themes with screenshots, Lighthouse, OG image, link check.
  - _Requirements: 21, 22, 24, 26, 27_
