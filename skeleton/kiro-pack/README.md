# GOLEM Kiro pack

`golem init` copies these files into the `.kiro/` of a project. Everything except `agent-src/` and this README is listed in `manifest.json`.

| Path | What it is |
|---|---|
| `hooks/golem.json` | Five workspace hooks (v1 format). No PreToolUse hook. |
| `hooks/golem-guard-requirements.mjs` | The guard that denies writes to `requirements.md`. Referenced only by the `golem-tuner` agent. |
| `steering/golem-ears.md` | The GOLEM dialect, included when a `requirements.md` is open. |
| `agents/*.json` | `golem-tuner`, `golem-skeptic`, `golem-scribe`: the upgraded and finalized agent files. Built from `agent-src/` by `npm run pack:build`. Never edited by hand. |
| `settings/mcp.json` | The `golem` MCP server entry. `golem init` merges only this entry into an existing file. |
| `skills/` | `robot-ears` and `falsify-and-fix`. |
| `workflows/falsify-and-fix.workflow.json` | A repeat node that runs the tuner and `golem gate` up to 6 times. |

## How the repair loop is driven

Verified on kiro-cli 3.5.0:

- A workspace v1 hook with trigger `Stop` that prints `{"decision":"block","reason":...}` and exits 0 does continue the agent, with the reason as a new message.
- It fires **once per user turn**. A second stop in the same turn is not gated.
- The Stop payload on stdin holds only `session_id`, `hook_event_name` and `cwd`.

So the fix-until-green loop does not depend on repeated Stop calls. It comes from three places:

1. The `golem-tuner` prompt: after every fix it runs `golem gate` itself and reads the exit code, and it finishes only on exit 0 or with a stated blocker.
2. The `falsify-and-fix` workflow: a repeat node (at most 6 iterations) that runs the tuner and then `golem gate` without `--kiro`.
3. The Stop hook as a last guard: one block per turn with the counterexamples, so an agent that tries to stop on a red gate is sent back once.

The counter of `golem gate --kiro` is kept as designed: at most 5 consecutive blocks per `session_id`, then one allowed stop (logged in `gateOverrides` of `.golem/report.json`) and the count resets to 0. Two gate runs for one stop within 2 s count once.

## Verified Kiro formats

| Format | Status |
|---|---|
| Hook file `.kiro/hooks/<id>.json`: `{ "version": "v1", "hooks": [ { name, description?, trigger, matcher?, action: { type: "command", command }, timeout?, enabled? } ] }`, `timeout` in seconds. | Verified (Kiro docs) |
| Triggers are PascalCase: `PostFileSave`, `PostTaskExec`, `PreToolUse`, `Stop`, `SessionStart`; file matchers are regexes on the path. | Verified |
| `Stop` hook with `{"decision":"block","reason":...}` and exit 0 continues the agent. | Verified on kiro-cli 3.5.0 (once per turn) |
| `Manual` trigger. | Partly (hook types page) |
| Agent file: `name, description, prompt, mcpServers, tools, resources, hooks, permissions, model` plus legacy `allowedTools, toolsSettings`. | Verified |
| Permission rule `{ capability, match, exclude, effect }`; deny overrides allow; `exclude` globs must not match. | Verified |
| `kiro-cli agent upgrade <dir> [--no-backup]`, `kiro-cli agent validate --path <file>`. Shell patterns in V2 `allowedCommands` are regexes: only `.*` and literal text convert. | Verified by running the commands |
| An upgraded file that was edited, or finalized, is reported `skipped ... out of sync` and left unchanged. | Verified by running the command |
| A file with a byte order mark is rejected by the upgrade. The build writes UTF-8 without BOM. | Verified |
| Workflow recipe `<name>.workflow.json`, repeat node with `maxIterations`, `onMaxIterations`, `stopCondition.fileCheck`. | Partly (third-party article) |
| Agent Plugins 1.0 `plugin.json`: closed schema, `$schema, name, version, description, author, homepage, repository, license, keywords, extensions`. | Verified (specification) |
| Crew `app.json` `mcpServers` and `schedule { cron, timezone }`. | Not verified (C1) |

## Decisions X1 to X7

| # | Decision |
|---|---|
| X1 | Hook `action` is the object `{ "type": "command", "command": ... }`. |
| X2 | Hook matchers are regular expressions, not globs. |
| X3 | `plugin.json` holds `$schema` and only fields of Agent Plugins 1.0. |
| X4 | The only URLs in the Power are the `$schema` values of `plugin.json` and `mcp.json`. The licence text is exempt, because it is a byte copy of the repository licence and names its own URL. |
| X5 | Agents go through V2 source, `kiro-cli agent upgrade`, the deterministic `finalizeAgent` (it appends the Deny_Rule with `exclude`), and `kiro-cli agent validate --path`. |
| X6 | `golem gate --kiro` blocks with JSON on stdout and exit 0. `golem gate` without `--kiro` exits 2 on a red gate. |
| X7 | The commands are exactly `kiro-cli agent upgrade <dir>` and `kiro-cli agent validate --path <file>`. |

## Resolved questions OQ1 to OQ5

- OQ1: `finalizeAgent` is the only post-upgrade change. A second upgrade skips the finalized file, so the pipeline is idempotent.
- OQ2: `kiro-cli agent validate` takes the file through `--path`.
- OQ3: an upgraded file may carry `permissions`, `model` and `kiroUpgrade`, `hooks` in array form, and the V2 `toolsSettings` and `allowedTools`.
- OQ4: the workspace Stop hook and the tuner's own Stop hook both run `golem gate --kiro`. The 2 s dedupe window makes them count once.
- OQ5: under `--kiro` a compile error is a red gate: the counter counts it and the block reason lists the Diagnostics.

## Assumptions

- W1: workflow steps have the shape `{ "type": "step", "id", "agent", "prompt" }` and the gate step runs `golem gate` through the agent's shell tool. The `jsonPath` syntax of the stop condition is unverified.
- C1: the Crew `app.json` carries `mcpServers` and `schedule`. This kit also puts the nightly `agent` and `prompt` inside `schedule`.
- K1: an upgraded agent file may carry the V3 fields (`permissions`, `kiroUpgrade`, `model`) next to the V2 fields.

## Still open

- **OQ6.** Requirement 24.6 (pause when `golem gate` exits 1) depends on the gate step obeying its prompt, because the repeat stop condition reads only `.golem/report.json`. The workflow step shape (W1) is unverified. `workflows/falsify-and-fix.workflow.json` is the least verified file in the pack.
- **OQ7.** `golem replay` and the MCP `replay` and `explain_margin` tools need the trace of a trial. `golem-sim` does not return `TrialResult.trace` yet, so the kit captures the trace through the `earlyStop` hook that `runTrial` already has. A sim that offers neither makes `replay` exit 1 with a named cause.
- `explain_margin` needs per-signal margins. Until `golem-ears` adds `CompiledRequirement.predicates` or a `margins` map to the monitor result, it returns "per-signal margins unavailable: the compiled requirement carries no predicate bindings".
- The Deny_Rule with `exclude` rests on the documented semantics of Kiro permissions. No kit test exercises it at runtime, and a finalized agent shows as "out of sync" in Kiro's `/upgrade-agent` menu. Selecting it rebuilds the file from the V2 settings and drops the Deny_Rule.
- `kiro-cli powers install ./skeleton/power` changes the user's Kiro configuration, so its test runs only with `GOLEM_POWER_INSTALL=1`.
- A shell redirect into `requirements.md` is not blocked by the guard, which covers write tools only. The tuner prompt forbids it.
