# golem-spec

**Turn the EARS acceptance criteria of a Kiro spec into physics tests.** `golem-spec` compiles every requirement into a MuJoCo property test, hunts for the scenario that breaks it, shrinks that scenario to the mildest failure, pins it as a regression seed, and gates Kiro's AI agent until every requirement holds.

Live demo, with a Unitree G1 you can shove in the browser: https://d23v187fnxad7l.cloudfront.net

```bash
npm i -D golem-spec
npx golem init        # installs Kiro hooks, agents, MCP server, skills and steering into .kiro/
npx golem check       # compile every EARS line (no trials)
npx golem test        # falsify every requirement: random, then guided, then shrink
npx golem gate        # exit 0 only if every requirement holds (2 if any is broken)
```

## A requirement is a test

```
WHEN the pelvis is pushed with up to 100 N for 0.2 s from any direction
at any point in its stride, THE robot SHALL stay upright for 3 s
```

The trigger defines what to search: force 0–100 N, any angle, any gait phase. The response becomes a monitor with a signed margin in physical units, compiled to `G[t₀, t₀+3 s] margin("stay upright") > 0 m`. A failing trial reports the mildest scenario that still breaks the line, for example *falls from 62.5 N at 260°, 20% into the stride*.

## What's inside

| Entry | What it gives you |
|---|---|
| `golem-spec` | the EARS compiler (`compileRequirement`, `compileRequirementsFile`), the MuJoCo trial runner (`runTrial`), the falsifier (`falsify`) and its types |
| `golem-spec/node` | the Node worker pool, the CLI and the MCP server |
| `golem-spec/ui` | `mountStudio`, the browser studio: a three.js stage, ghost swarm, floor aura, requirement tablet and replay reel |
| `golem` (bin) | `init`, `check`, `test`, `falsify`, `replay`, `gate`, `mcp` |
| `kiro-pack/` | the files `golem init` copies into `.kiro/`: hooks (check on save, falsify on controller save, the Stop gate), three agents (tuner, skeptic, scribe), MCP settings, skills, steering and a fix-until-green workflow |
| `power/` | the same pack as a Kiro Power |
| `crew-app/` | the same pack as a Kiro Crew app |

An app describes its robot once: an MJCF scene, a controller, the signals it measures, and a *lexicon* of the phrases its requirements may use. See the two example apps, `apps/stagger` (Unitree G1) and `apps/candy` (Franka Panda), in the repository.

## Honest limits

- "Held" means no counterexample was found within the stated budget. It is not a proof.
- This is simulation (MuJoCo 4, WebAssembly), not the real robot.

Apache-2.0. Source, evidence and the full story of how Kiro built it: https://github.com/RohanGlitched/golem
