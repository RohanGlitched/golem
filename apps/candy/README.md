# Candy: a Franka Panda that sorts Halloween candy

App 2 of GOLEM. A Franka Panda with a suction cup sorts six pieces of candy (orange, purple, green) into three bowls on a wooden doorstep table while trick-or-treaters' hands reach in. GOLEM tests it against the EARS lines in `.kiro/specs/candy-sorter/requirements.md`.

The safety function is deliberately incomplete. Speed-and-separation monitoring version 1 (`controller/ssm.ts`) measures the distance from the hand to the suction-cup tip only. Line 1.1, `keep every link at least 0.10 m from the hand`, is therefore expected to be reported broken: a hand that passes the elbow while the tip is far away slows nothing down. That outcome is valid and the line is never edited to avoid it (see `proposals.md`).

## Layout

- `robot/`: patched Panda, `scene.xml`, simplified meshes, upstream `LICENSE`, `SOURCE.json` (committed)
- `controller/`: damped-least-squares IK, pick-and-place machine, SSM_v1, hand delay line, suction model, `CandyController`
- `constants.ts`, `geometry.ts`, `signals.ts`, `predicates.ts`, `perturbations.ts`, `lexicon.ts`: what requirement lines can say
- `app.ts`: the `RobotApp` definition
- `scripts/fetch-assets.mjs`: the asset pipeline
- `test/`: Vitest and fast-check tests
- `.kiro/specs/candy-sorter/requirements.md`: the app's own requirements
- `web/`: the studio page (`index.html`, `main.ts`, `worker.ts`, `vite.config.ts`)
- `.kiro/hooks/gate.json`: a `Stop` hook that runs `golem gate --kiro`

## Studio

The studio page is served with the `dev` script of this package (http://localhost:5188/) and built with the `build` script (typecheck, then `web/dist`, with the robot files copied to `web/dist/robot`).

`web/main.ts` mounts GOLEM's studio on the Panda with the requirements file above. Trials run in Web Workers (`web/worker.ts`), or on the page with `?inline=1`. `?autorun=1` tests every line on load and `?trials=N` sets the budget (default 48). Drag the hand with the pointer: it keeps a height of 0.05 m to 0.25 m above the table and stays out of the base column (`constrainDraggedHand` in `geometry.ts`; the studio option is `dragBody`). The studio draws geom group 2 only, so every visual geom of `scene.xml` is in group 2.

A production build inlines the pool's worker entry script as a data URL, so a built page falls back to running trials on the page thread. The dev server starts the workers.

## Regenerating the robot folder

```
npm run assets
```

This downloads `panda_nohand.xml`, the meshes and the `LICENSE` of `franka_emika_panda` from MuJoCo Menagerie at the pinned commit `370c43965323c0944b433b202aac5058b5f907a9`, checks each file against the hashes recorded in the script, simplifies visual meshes to at most 3,000 faces, stores collision meshes as convex hulls of at most 200 faces, patches in the suction cup and the `tip` site, and writes `scene.xml`. The output is deterministic. When every file already has its recorded hash the script prints `Assets are current.` and makes no request. `npm run assets -- --check` reports the state without network access. `node scripts/fetch-assets.mjs --resolve` prints the hashes of the pinned commit (or, with `--head`, of the current Menagerie head) for a maintainer who moves the pin.

## Licences

- App code: Apache-2.0 (`LICENSE`).
- Franka Panda model and meshes: Apache-2.0, Google DeepMind (MuJoCo Menagerie). The notice is kept unchanged in `robot/LICENSE`.

## Evidence

Long falsification campaigns and timing runs live in `evidence/` at the repository root, not in CI. Physics tests here use at most 2 s of simulated time after warm-up and at most 3 s per trial.
