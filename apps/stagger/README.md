# Stagger: Unitree G1

App 1 of GOLEM. A Unitree G1 humanoid (12-DOF legs, `g1_12dof`) walks under Unitree's published locomotion policy in MuJoCo, and GOLEM tests it against the EARS lines in `.kiro/specs/g1-walking/requirements.md`.

## Layout

- `robot/`: processed model, meshes, `policy.bin`, upstream `LICENSE`, `SOURCE.json` (committed)
- `controller/`: policy network (Float64 LSTM port), observation, PD law reference, latency buffer, Walker
- `signals.ts`, `predicates.ts`, `perturbations.ts`, `lexicon.ts`: what requirement lines can say
- `app.ts`: the `RobotApp` definition
- `scripts/fetch-assets.mjs`: the asset pipeline
- `test/`: Vitest and fast-check tests, including the parity test against the Python reference

## Regenerating the robot folder

```
npm run assets
```

This downloads the MJCF, meshes and `motion.pt` from `github.com/unitreerobotics/unitree_rl_gym` at the pinned commit `276801e46c5d433564f24658bac64f254b7d2d4b`, builds convex-hull collision meshes and visual meshes of at most 3,000 triangles, rewrites the MJCF, writes `scene.xml` and packs the policy weights into `policy.bin`. The output is deterministic, and the result is committed so the site needs no download at build time.

## Licences

- App code: Apache-2.0 (`LICENSE`).
- G1 model, meshes and policy: BSD-3-Clause, Unitree Robotics. The notice is kept unchanged in `robot/LICENSE`.

## Evidence

Long falsification campaigns and timing runs live in `evidence/` at the repository root, not in CI. Physics tests here use at most 2 s of simulated time per trial.
