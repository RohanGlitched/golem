# golem-spec

**Turn the EARS acceptance criteria of a Kiro spec into physics tests.** `golem-spec` compiles every requirement into a MuJoCo property test, hunts for the scenario that breaks it, shrinks that scenario to the mildest failure, pins it as a regression seed, and gates Kiro's AI agent: a Stop hook blocks it from finishing while any requirement misses its expectation.

Live demo, with a Unitree G1 you can shove in the browser: https://d23v187fnxad7l.cloudfront.net

```bash
npm init -y && npm i -D golem-spec
npx golem-spec init                            # Kiro hooks, agents, MCP, skills and steering into .kiro/, plus a starter cart-pole robot
npx --no-install golem-spec check              # compile the 3 EARS lines of the starter (no trials), exit 0
npx --no-install golem-spec test --budget 24   # falsify them with real MuJoCo trials: 1.2 breaks
npx --no-install golem-spec gate               # exit 0 only if every requirement holds; here 2, naming 1.2
npx --no-install golem-spec replay 1.2         # re-run the shrunk counterexample, write .golem/replays/1.2.csv
```

In an empty project `init` also writes `app.js`, `robot/scene.xml`, `.kiro/specs/cartpole/requirements.md`, a short `README.md` and a `golem.config.json` that points at them. It needs no TypeScript, no build step and no other dependency, and it never overwrites a file you already have: with a `golem.config.json` that names an existing app, or an existing `app.js`, `robot/` or cartpole spec, it installs only the Kiro pack. `npx golem-spec init --no-starter` skips the starter, and `--force` replaces pack files only.

The starter's three lines, measured with `test --budget 24` over six search seeds:

| Line | Verdict | Closest margin |
|---|---|---|
| 1.1 `WHEN the cart is pushed with up to 8 N for 0.2 s THE robot SHALL keep the pole within 30 deg of upright for 3 s` | held | +17.1 to +17.9 deg |
| 1.2 the same with up to 30 N | broken, shrunk to a push of 14.5 to 15.1 N (the motor gives 15 N) | -0.13 deg at the edge, about -300 deg once the pole tumbles |
| 2.1 `THE robot SHALL keep the cart within 0.3 m of the centre` | held | +0.19 to +0.26 m |


## A requirement is a test

```
WHEN the pelvis is pushed with up to 100 N for 0.2 s from any direction
at any point in its stride, THE robot SHALL stay upright for 3 s
```

The trigger defines what to search: force 0–100 N, any angle, any gait phase. The response becomes a monitor with a signed margin in physical units, compiled to `G[t₀, t₀+3 s] margin("stay upright") > 0 m`. A failing trial reports the mildest scenario that still breaks the line, for example *falls from 62.5 N pushed from its left (80°), 20% into the stride* on the Unitree G1 in the demo. With the balance reflex that Kiro's `golem-tuner` agent wrote under the gate, the same 4,860-trial map gives a weakest push of 101.6 N.

## What's inside

| Entry | What it gives you |
|---|---|
| `golem-spec` | the EARS compiler (`compileRequirement`, `compileRequirementsFile`), the MuJoCo trial runner (`runTrial`), the falsifier (`falsify`) and its types |
| `golem-spec/node` | the Node worker pool, the CLI and the MCP server |
| `golem-spec/ui` | `mountStudio`, the browser studio: a three.js stage, ghost swarm, floor aura, requirement tablet and replay reel |
| `golem` (bin) | `init`, `check`, `test`, `falsify`, `replay`, `gate`, `mcp` |
| `starter/` | the cart-pole robot `golem init` writes into an empty project: `app.js`, `robot/scene.xml`, its three-line spec and a README |
| `kiro-pack/` | the files `golem init` copies into `.kiro/`: hooks (check on save, falsify on controller save, the Stop gate), three agents (tuner, skeptic, scribe), MCP settings, skills, steering and a fix-until-green workflow |
| `power/` | the same pack as a Kiro Power |
| `crew-app/` | the same pack as a Kiro Crew app |

An app describes its robot once: an MJCF scene, a controller, the signals it measures, and a *lexicon* of the phrases its requirements may use. See the two example apps, `apps/stagger` (Unitree G1) and `apps/candy` (Franka Panda), in the repository.

## Honest limits

- "Held" means no counterexample was found within the stated budget. It is not a proof.
- This is simulation (MuJoCo 4, WebAssembly), not the real robot.

Apache-2.0. Source, evidence and the full story of how Kiro built it: https://github.com/RohanGlitched/golem
