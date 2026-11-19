---
inclusion: always
---
# Repository structure

```
.kiro/                 Kiro config used to build GOLEM itself (specs, steering, hooks, agents, MCP, skills)
skeleton/              the reusable kit, npm package `golem-spec` (bin: golem)
  src/ears/            EARS + units parser, lexicon matching, monitors (robustness semantics)
  src/sim/             MuJoCo WASM loading, episode runner, perturbations, signal recording
  src/falsify/         random search, cross-entropy search, shrinking, verdicts, seed database
  src/pool/            TrialPool (browser workers / node worker_threads)
  src/cli/             `golem` commands: check, test, falsify, replay, gate, init, mcp
  src/mcp/             MCP server exposing GOLEM to Kiro agents
  src/ui/              shared three.js stage, ghost swarm, floor aura, tablet, reel
  kiro-pack/           templates `golem init` copies into a project's .kiro/
apps/stagger/          app 1: Unitree G1 humanoid (own package.json, own .kiro/ installed by `golem init`)
apps/candy/            app 2: Franka Panda candy sorter (own package.json, own .kiro/)
site/                  landing page, kit docs, evidence pages; links the two app studios
evidence/              benchmark scripts and committed raw results (JSONL) + logs
```

Rules:
- Apps import the skeleton only through its public entry points (`golem-spec`, `golem-spec/ui`, `golem-spec/node`). Never deep-import `skeleton/src/...` from an app.
- An app = `robot/` (MJCF + meshes + licence), `controller/`, `lexicon.ts`, `app.ts` (the `RobotApp` definition), `.kiro/specs/<robot>/requirements.md` (its EARS requirements), `web/` (its studio page).
- Generated or downloaded assets go in `robot/` with a script in `scripts/` that reproduces them.
