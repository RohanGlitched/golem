# Design Document: golem-site

Compact design for `requirements.md`. The first design (`bf43343`, 47 properties, 114 tasks) is in git history; this one replaces it to fit one implementation session. Requirement numbers below refer to `requirements.md`.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Page generation | Vite multi-page build. Each page is a small HTML shell. A Vite plugin (`src/build/pages-plugin.ts`) replaces `<!--@page-->` with HTML rendered by a function in `src/pages/*.ts` from the committed data. | Real content, no framework at runtime, works in `vite dev` and `vite build` (R1, R25). |
| Runtime JS | No framework. Four small modules: theme, copy buttons, polar figure, studio loader. React and three.js load only in the studio chunk. | Lighthouse performance (R21). |
| Studio | The page shell loads `src/studio/mount.ts` through a dynamic `import()`. It calls `mountStudio` from `golem-spec/ui` on the app from `apps/<id>`. Trials run in Web Workers (`workerUrl`). Robot files are copied to `dist/<id>/robot/`. | The brief: the studio loads only on `/` and the app pages (R5, R21). |
| Studio source | `apps/<id>/web/index.html` when it exists. Otherwise the site's own entry (`src/studio/`). | `apps/stagger/web` holds only `.gitkeep` on this branch. |
| Skeleton resolution | `golem-spec`, `golem-spec/ui` and `golem-spec/ui/worker` are aliased to `skeleton/src/*` in the Vite config, so the build needs no `skeleton/dist`. Import specifiers stay public. | The skeleton package is not built in a fresh checkout. |
| Data | `site/data/*.json` (committed). `node scripts/kiro-stats.mjs` regenerates `kiro.json`. `scripts/gen-lexicon.ts` writes `lexicon.json` from both apps' `lexicon.ts`. `scripts/gen-candy.mjs` writes `candy.json` from `apps/candy/proposals.md` P8. The build reads evidence files directly and fails with the file name when one is missing or malformed (R20, R25). | Deterministic, no network. |
| Theme | `data-theme` on `<html>`, set by an inline 300-byte script before first paint from `localStorage` then `prefers-color-scheme`, dark by default. | No flash (R4). |
| Fonts | B612, B612 Mono and Gloock as woff2 or ttf in `public/fonts`, `font-display: swap`, preload for the body face and Gloock. OFL texts beside them. | R3. |
| Figures | Inline SVG generated at build time. Each has `role="img"`, `<title>` and `<desc>`, plus a caption and a text alternative (table or sentence). | R23. |
| OG image | `scripts/og.mjs` renders a 1200×630 card (the G1 map aura on clay) with Playwright into `public/og.png`. Favicon is an SVG. | R24. |

## Layout

```
site/
  index.html kit/index.html evidence/index.html how-kiro/index.html 404.html
  stagger/index.html candy/index.html          studio shells (generic entry)
  src/build/    pages-plugin, data loaders, lexicon reference, render helpers
  src/pages/    home, kit, evidence, how-kiro, notfound, studio
  src/figures/  pipeline, polar, bars
  src/client/   theme, copy, polar, studio-loader, site.css
  src/studio/   mount.ts, stagger-worker.ts, candy-worker.ts
  data/         committed JSON
  public/       fonts, favicon.svg, og.png, robots.txt
  scripts/      gen-lexicon, gen-candy, og, shots, lighthouse
  tests/        vitest (pure logic), playwright smoke
```

## Pure logic with tests (R25, R27)

- `loadEvidence()`: reads `evidence/results/*`, validates shape, returns headline numbers. Throws `SiteDataError` naming the file.
- `parseTranscript()`: splits `docs/cli-transcript.md` into command, excerpt blocks.
- `polarGeometry()`: maps (direction, held N) to SVG coordinates, 0° at the right, counter-clockwise like the map; forces scale to the ring radius.
- `lexiconReference()`: groups predicates and perturbations of both lexicons.
- Link check: every `href` and `src` in `dist` resolves to a file; no foreign origins.

Properties (fast-check): polar geometry stays inside the ring and round-trips the direction; link checker finds an injected broken link; headline numbers equal the summary file they were drawn from; page HTML has exactly one `<h1>` and no `max-width` above 72ch in prose.

## Home page (R5 to R12)

One line above the studio: "Shove the robot. Then summon the ghosts." The studio section is a full-bleed block of fixed height (`min(78vh, 760px)` on ≥1024 px, taller on phones so the tablet fits), so the layout does not shift when the studio mounts. Lab-notebook sections follow in this order: the problem, how it works (six figures), the two robots, measured results, the kit in 60 seconds, limits, call to action, footer.

## Footer (R12)

Rendered by one function, so every page has the same footer: sitemap, licences (Unitree BSD-3-Clause, Menagerie Apache-2.0, MuJoCo Apache-2.0, fonts OFL), repository link, changelog (from `site/data/changelog.json`, newest first).

## Error handling

- Missing evidence file: the build stops with the path.
- `apps/<id>/web/index.html` and the site entry are both unusable, or the app's robot files are missing: the build emits `dist/<id>/index.html` as a static notice page ("This studio is not built in this checkout") and prints a warning. It does not fail.
- Studio load failure in the browser: the section shows the error text and a link to the evidence page. WebGL absent: the studio's own fallback text.

## Testing

- Vitest: the pure logic above, in `site/tests/*.test.ts`.
- Playwright smoke (`site/tests/smoke.spec.ts`): every page at 1440 and 390 px in both themes; asserts no horizontal scroll, one `h1`, footer present, no console errors, the polar figure's hover text, the theme toggle. Screenshots to `site/shots/` (git-ignored).
- Lighthouse (`scripts/lighthouse.mjs`) against `vite preview`, mobile and desktop presets, performance ≥ 90 on `/`, `/kit`, `/evidence`.
