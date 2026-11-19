<!-- Cover image: docs/cover.png (long-exposure ghost campaign on the G1). Added with the site build. -->

# GOLEM

**Kiro writes your robot's requirements in plain sentences. GOLEM turns every sentence into a physics test, tries hard to break the robot, and won't let the agent say "done" while any sentence is false.**

> In the legend, a golem is clay brought to life by a written word. Here the words are a Kiro spec's EARS acceptance criteria. The clay is a robot in MuJoCo, running in your browser.

**Try it, no install:** https://d23v187fnxad7l.cloudfront.net

1. **Shove the robot.** Drag the Unitree G1 with your mouse or finger.
2. **Summon the ghosts.** 64 translucent copies get pushed at once. The ones that fall turn red, and each wave homes in on the weak spot.
3. **Read the verdict.** Each requirement either holds, with its margin in metres, or breaks with the mildest failing push: *"falls from 62.5 N at 260°, 20% into the stride"*. Replay the fall, or drag a number in the sentence and test again.

---

## What it does

```
WHEN the pelvis is pushed with up to 100 N for 0.2 s from any direction
at any point in its stride, THE robot SHALL stay upright for 3 s
```

1. **Compile.** GOLEM reads EARS lines straight from `.kiro/specs/*/requirements.md`, the file Kiro writes. Each line becomes:
   - a *scenario space*: force 0–100 N, angle 0–360°, gait phase 0–1;
   - a *monitor* with quantitative semantics: a signed margin in physical units. It prints the compiled formula too: `G[t₀, t₀+3 s] margin("stay upright") > 0 m`.
2. **Falsify.** It re-runs pinned seeds first, then random Latin-hypercube trials, then a cross-entropy search toward the lowest margin. It **shrinks** each failure to the mildest push that still breaks the line, then re-checks it on fresh seeds and at half the timestep, so a solver artefact isn't reported as a robot failure.
3. **Gate.** Kiro hooks run `golem check` when a requirements file is saved, and `golem test` when a controller is saved. A **Stop hook runs `golem gate`**, so the agent can't finish while a requirement is red, and a guard stops the tuning agent editing the requirement instead of the robot.

The engine is MuJoCo 4 compiled to WebAssembly, identical in Node and the browser. Trials are bit-for-bit deterministic, and every trial in Node is reproducible by seed.

## The kit: one command into any Kiro project

```bash
npm i -D golem-spec
npx golem init        # installs hooks, agents, MCP, skills, steering and a workflow into .kiro/
npx golem test        # falsify every requirement
npx golem gate        # exit 0 only if everything holds
```

| What lands in `.kiro/` | What it does |
|---|---|
| `hooks/golem.json` | check on save, falsify on controller save, the Stop gate, test after each spec task, and a manual "Summon the ghosts" |
| `agents/golem-tuner.json` | may edit only controller files; can't touch requirements (its own preToolUse guard); stops only through the gate |
| `agents/golem-skeptic.json` | read-only; proposes harsher believable requirements in `proposals.md` |
| `agents/golem-scribe.json` | turns plain words into EARS lines that compile |
| `settings/mcp.json` | the GOLEM MCP server: list, check, run, falsify, replay, explain_margin, propose |
| `skills/`, `steering/`, `workflows/` | how to write robot EARS; a falsify-and-fix loop that repeats until the gate is green |

The same pack ships as a **Kiro Power** (`skeleton/power`) and a **Kiro Crew app** (`skeleton/crew-app`).

## Two robots, one skeleton (Skeleton Crew)

| App | Robot | What GOLEM found |
|---|---|---|
| [`apps/stagger`](apps/stagger) | Unitree G1 humanoid running Unitree's published walking policy (it matches Unitree's own reference run to 2.5 µm) | It falls from **62.5 N** pushed from its right side at 20% of its stride, yet holds **240 N** from behind-left. That's 4,860 trials, all in `evidence/`. |
| [`apps/candy`](apps/candy) | Franka Panda with a suction cup, sorting Halloween candy while trick-or-treaters reach in | The first safety controller watched only the cup. GOLEM found the **wrist flange** ending 2–10 cm from a child's hand in 25% of trials. |

## Evidence

Every number here comes from committed raw data in [`evidence/`](evidence), using pre-registered methods ([`PREREG.md`](evidence/PREREG.md)). See [`REPORT.md`](evidence/REPORT.md) for what held, what didn't, and what went wrong.

## How Kiro built GOLEM

Kiro CLI did the building: 15 specs (including 3 bugfix specs written from independent audits in [`docs/reviews/`](docs/reviews)), 224 requirements, 2,273 EARS acceptance criteria, 340 correctness properties, 656 completed tasks and 461 property-test assertions. The root [`.kiro/`](.kiro) holds the steering, specs, hooks, agents and MCP config used to build it. The full account is on the site's *How Kiro built this* page.

## Run it locally

```bash
npm ci
npm run dev -w apps/stagger    # the G1 studio
npm run dev -w apps/candy      # the candy studio
npm test                       # every workspace
```

## Licences and credits

GOLEM is Apache-2.0. The Unitree G1 model and walking policy are © Unitree Robotics, under BSD-3-Clause (`apps/stagger/robot/LICENSE`). The Franka Emika Panda model comes from MuJoCo Menagerie, Apache-2.0 (`apps/candy/robot/LICENSE`). MuJoCo is Apache-2.0. The B612 typefaces are SIL OFL 1.1.
