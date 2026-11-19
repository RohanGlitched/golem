---
name: golem
displayName: GOLEM
description: Turns the EARS acceptance criteria of a Kiro spec into physics property tests for robot controllers, and gates the agent until every requirement holds.
keywords: ["robotics", "ears", "falsification", "mujoco", "requirements"]
---

# GOLEM

GOLEM reads the numbered EARS lines of a `requirements.md`, compiles them against the lexicon of a robot app, and searches for a counterexample in a MuJoCo simulation. A pass means no counterexample was found within the stated search budget. It is not a proof.

## MCP tools

The `golem` MCP server exposes eight tools:

- `list_requirements`: every requirement with its EARS line and last status.
- `check_requirement`: compile one EARS line without running anything.
- `run_requirement`: run one requirement with random trials, pinned seeds first.
- `falsify`: search for the mildest counterexample, with shrinking.
- `get_counterexample`: the latest pinned counterexample of a requirement.
- `replay`: re-run a pinned counterexample and summarise its trace.
- `explain_margin`: which signal has the lowest margin, and when.
- `propose_requirement`: record a proposed EARS line in `.kiro/specs/<robot>/proposals.md` for a human to review.

## Install

The MCP server runs through `npx golem-spec mcp`, so the `golem` binary does not need to be on the path. Run `npx --no-install golem-spec init` in an app directory to install the hooks, steering, agents and skills into its `.kiro/`.

## Loop

Falsify a red requirement, read the counterexample, explain the margin, fix the controller, re-run, and repeat until `npx --no-install golem-spec gate` exits with code 0. Requirements are never edited to make a test pass: propose a change with `propose_requirement`.
