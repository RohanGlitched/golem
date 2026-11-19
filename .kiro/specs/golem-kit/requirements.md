# Requirements Document

## Introduction

`golem-kit` covers the part of GOLEM that plugs into Kiro: `skeleton/src/cli` (the `golem` command), `skeleton/src/mcp` (the MCP server), `skeleton/kiro-pack` (the templates that `golem init` copies into a project's `.kiro/`), `skeleton/power` (a Kiro Power and Agent Plugin) and `skeleton/crew-app` (a small Kiro Crew app). The Kiro configuration is a product feature that ships with the skeleton, not only the way GOLEM itself was built.

The kit calls the modules defined by the sibling specs `golem-ears` (compile and monitors), `golem-sim` (episodes and traces) and `golem-falsify` (search, shrinking, seed database, `TrialPool`). It uses only the contracts in `interfaces.md` (`CompiledRequirement`, `Scenario`, `Trace`, `TrialSpec`, `TrialResult`, `Counterexample`, `Verdict`, `TrialPool`, `RobotApp`). It adds fields where needed and renames or removes none. The kit relies on four optional additions to sibling contracts: `CompiledRequirement.predicates` (an optional binding of the lexicon predicates and their signals, used by `explain_margin`), `signalUnits` on `RobotApp` (an optional map from signal name to unit), the exposure of the recorded `Trace` by `golem-sim` for replay, and the optional `margins` map of the monitor result. Each is an optional field added to a sibling contract, and nothing is renamed or removed.

The loop the kit supports is: the agent writes or edits a controller, a hook runs `golem test`, a counterexample comes back through the CLI or MCP, the agent fixes the controller, and a Stop hook runs `golem gate --kiro` so that a task cannot be called done while a requirement is broken. The Stop hook follows Kiro's contract: a blocking Stop hook prints the block JSON on stdout and exits 0. Outside Kiro, `golem gate` (without `--kiro`) exits 2 on a red gate, for CI and workflows. A `held` verdict means "no counterexample found within this search budget". It is never a proof. Verdicts come only from deterministic monitors, and the kit never calls an LLM to decide a verdict.

Out of scope: EARS parsing and monitors, the MuJoCo episode runner, the search algorithms and pool implementations, the studio UI pages, and the two apps. The kit only calls them.

## Glossary

- **CLI**: The `golem` command in `skeleton/src/cli`, shipped as the bin of the npm package `golem-spec`.
- **Arg_Parser**: The small hand-written argument parser of the CLI. It has no third-party dependency.
- **Arg_Formatter**: The CLI component that formats a parsed command back into an argument list.
- **Project**: A directory tree that holds one app and a `golem.config.json`.
- **App_Dir**: The directory that holds `golem.config.json` for the app being run.
- **Config_File**: The file `golem.config.json`. It names the RobotApp module and the requirements files, and may carry the optional fields `studioUrl` and `robot`.
- **Config_Locator**: The CLI component that finds the App_Dir, either by walking up from the current working directory or from the `--app <dir>` flag.
- **Requirements_File**: A `requirements.md` file named by the Config_File.
- **Proposals_File**: The file `.kiro/specs/<robot>/proposals.md`, where proposed requirement lines are written for human review.
- **Diagnostic**: A compile error or warning for one EARS line, with file, line, column, message and an optional suggestion.
- **Report_File**: The file `.golem/report.json`, the last full run (`Verdict[]` plus metadata).
- **Replay_File**: The file `.golem/replays/<reqId>.csv`, the trace of a replayed trial.
- **Studio_URL**: The URL of an app's studio page with the scenario and seed encoded in the URL hash.
- **Quick_Budget**: The fixed small trial budget that `golem gate` uses after the pinned seeds.
- **Exit_Code**: The process exit status. `0` is success, `1` is a usage, compile or runtime error, `2` is a broken requirement. The exception is `golem gate --kiro`, which exits `0` on every gate outcome and `1` only on a usage or Config_File error (Requirement 8).
- **Kiro_Stop_Output**: The one-line JSON object `{"decision":"block","reason":"..."}` that a Kiro Stop hook prints on stdout, with exit code 0, to block the stop.
- **MCP_Server**: The stdio Model Context Protocol server in `skeleton/src/mcp`, built on `@modelcontextprotocol/sdk` and started by `golem mcp`.
- **MCP_Tool**: One tool that the MCP_Server exposes.
- **Tool_Result**: The result of an MCP_Tool call, made of one plain-text summary line followed by a JSON text block.
- **Tool_Time_Cap**: The maximum wall time of one MCP_Tool call, in seconds, with a default of 60 s.
- **Kiro_Pack**: The directory `skeleton/kiro-pack`, the set of templates that `golem init` copies into a project.
- **Pack_File**: One file in the Kiro_Pack, with a relative path under `.kiro/`.
- **Starter_Robot**: The cart-pole robot in `skeleton/starter/` that `golem init` writes into a project that has no robot: `app.js`, `robot/scene.xml`, `.kiro/specs/cartpole/requirements.md` and `README.md`. Line 1.2 of its spec asks for a push twice the motor limit, so it breaks on purpose.
- **Hook_File**: `hooks/golem.json` in the Kiro_Pack, in Kiro v1 hook format: `{"version":"v1","hooks":[...]}` where each hook has `name`, `trigger`, an optional `matcher` (a regular expression tested against the file path, not a glob) and an `action` that is an object `{"type":"command","command":"..."}`, and optionally `timeout` (whole seconds). It is a workspace-level hook file and contains no PreToolUse hook.
- **Requirements_Guard**: The Node script `hooks/golem-guard-requirements.mjs` in the Kiro_Pack, installed as `.kiro/hooks/golem-guard-requirements.mjs`. It uses only Node built-in modules, reads only the PreToolUse payload on stdin, and exits with code 2 when a write target is a `requirements.md` file. It reads no environment variable and no agent name. It is referenced only by the agent-scoped `preToolUse` hook in the Tuner_Agent's Agent_File, so it takes effect only while `golem-tuner` is the active agent.
- **Tuner_Agent**: The agent `golem-tuner`, which may write only `controller/**` and tuning files. Its Agent_File pre-approves those paths and denies every other write.
- **Skeptic_Agent**: The agent `golem-skeptic`, which has no write tool, denies all writes, and looks for harsher believable requirements that break the robot.
- **Scribe_Agent**: The agent `golem-scribe`, which turns plain-language robot behaviour into GOLEM EARS lines and writes them as proposals in the Proposals_File. Its Agent_File denies every write outside the Proposals_File pattern. It never writes a Requirements_File; a human or Kiro spec mode merges accepted proposals into `requirements.md`.
- **Session_Id**: The value of the string field `session_id` in the Stop hook payload, or the key `default` when the payload has no non-empty string `session_id`.
- **Gate_State_File**: The file `.golem/gate-state.json` in the App_Dir. It maps each Session_Id to an object with the number of consecutive blocks (`count`) and the UTC ISO 8601 time of the last update (`updatedAt`).
- **Block_Limit**: The number 5, the maximum number of consecutive blocking gate results for one Session_Id.
- **Gate_Counter**: The pure function `(state, sessionId, gateGreen) -> { allowStop, nextState }` that decides whether `golem gate --kiro` blocks or allows the stop, and the next content of the Gate_State_File. When it allows a stop for a Red_Gate, it resets the count of that Session_Id to 0, so that the next Red_Gate for that Session_Id blocks again. It may take an optional fourth argument, a UTC ISO 8601 time, used only to stamp `updatedAt`, and an optional fifth argument, `elapsedS`, the number of seconds from the `updatedAt` of that Session_Id to the start of the current invocation, which the CLI computes and passes in for the dedupe of Requirement 8.24.
- **DEDUPE_WINDOW_S**: The constant 2, the number of seconds within which a second gate invocation for the same Session_Id and the same result class counts as the same Stop event.
- **Gate_Override**: An entry in the `gateOverrides` array of the Report_File that records a stop allowed by the Gate_Counter while the gate was red, with the fields `sessionId`, `timestamp` (UTC ISO 8601), `count`, `brokenReqIds` (the ids that did not meet their expectation and whose verdict is not `held`, plus `compile`, `config`, `run` or `expectations` for a gate that could not run) and `unmetReqIds` (every id that did not meet its expectation, and the same pseudo ids).
- **Expectation_Table**: A Markdown table in a Requirements_File that gives each criterion a mark, `Expected_Hold` or `Expected_Break` (Requirement 7A). A criterion with no row is `Expected_Hold`.
- **Table_Error**: A problem in the Expectation_Table that makes the gate unable to run: a mark that is neither `Expected_Hold` nor `Expected_Break`, a row for an id that no criterion has, or two rows that give one id different marks (Requirement 7A.4).
- **Red_Gate**: A gate result in which any requirement does not meet its expectation (its verdict is not `held` for an `Expected_Hold` line, which is the default, or not `broken` for an `Expected_Break` line; `error` meets neither), any pinned seed fails, the Config_File names no requirements, or, under `--kiro`, a Requirements_File has an error-severity Diagnostic (Requirement 8.9) or the Expectation_Table has a Table_Error (Requirement 7A.5). Any other gate result is a green gate.
- **Agent_File**: A JSON agent definition in `kiro-pack/agents/`.
- **V2_Fields**: The agent fields of Kiro CLI V2 (name, description, prompt, tools, allowedTools, toolsSettings, mcpServers, hooks, resources).
- **V3_Fields**: The extra agent fields that `kiro-cli agent upgrade` emits into the universal format, including `permissions` (a list of rules, each with a `capability`, an `effect` of `allow` or `deny`, path patterns and optional `exclude` globs), the `kiroUpgrade` marker, and `model` when present. An upgraded file keeps the V2_Fields `toolsSettings` and `allowedTools`.
- **finalizeAgent**: The deterministic, script-only build step that runs after `kiro-cli agent upgrade` and appends the Deny_Rule with `exclude` globs to the `permissions` of the tuner and scribe Agent_Files, because V2_Fields cannot express `exclude`.
- **Deny_Rule**: A `permissions` rule with `capability` `fs_write` and `effect` `deny` that forbids writes to the paths it names, which an allow rule alone does not do.
- **Source_Template**: An Agent_File as written by the build script in V2_Fields, before `kiro-cli agent upgrade`.
- **Workflow_File**: `workflows/falsify-and-fix.workflow.json`, a Kiro workflow with a repeat node.
- **Power**: The package in `skeleton/power`, installable with `kiro-cli powers install ./skeleton/power`.
- **Plugin_Manifest**: `plugin.json` in the Power, in Agent Plugins 1.0 format, a closed schema whose permitted top-level fields are `$schema`, `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords` and `extensions`. Skills (`skills/<name>/SKILL.md`) and MCP servers (`mcp.json`) are found by convention, not by paths in the manifest.
- **Legacy_Power_File**: `POWER.md` in the Power, with its steering files.
- **Crew_App**: The Kiro Crew app in `skeleton/crew-app`, defined by `app.json`.
- **Nightly_Job**: The `crons` entry of the Crew_App that runs the Skeptic_Agent and ends with a summary in the run's output.
- **Tiny_Test_App**: A small `RobotApp` defined inline in tests, with a synthetic trial function and no MuJoCo, used to test the CLI and MCP_Server.
- **In_Memory_Transport**: The MCP SDK transport pair that connects a client and the MCP_Server inside one process.

## Requirements

### Requirement 1: Locate the app

**User Story:** As a robotics engineer, I want `golem` to find my app from any subdirectory, so that I can run it from where I work.

#### Acceptance Criteria

1. WHEN a command runs without `--app`, THE Config_Locator SHALL check the current working directory first, then each parent directory in turn up to the file system root, and SHALL select the first directory that contains a Config_File.
2. WHEN `--app <dir>` is given, THE Config_Locator SHALL resolve `<dir>` against the current working directory, SHALL use it as the App_Dir only if it contains a Config_File, and SHALL not check any parent directory.
3. IF no Config_File is found, THEN THE CLI SHALL exit with Exit_Code 1 and print on stderr a message that names the directory where the search started (the current working directory, or the resolved `<dir>` when `--app` is given) and suggests `golem init`.
4. IF the Config_File is not valid JSON, lacks the field for the RobotApp module, lacks the field for the requirements files, or holds a value of the wrong type in any of these fields or in `studioUrl` or `robot`, THEN THE CLI SHALL exit with Exit_Code 1 and print on stderr a message that names the Config_File path and the first invalid field in the order the fields appear in the file, or the parse error position when the file is not valid JSON.
5. THE Config_File SHALL accept the optional fields `studioUrl` and `robot`, and THE CLI SHALL ignore unknown fields without printing a warning and without changing the Exit_Code.
6. THE Config_Locator SHALL resolve every relative path in the Config_File against the App_Dir, and SHALL use an absolute path in the Config_File unchanged.
7. THE CLI SHALL accept the global flags `--app <dir>`, `--json` and `--help` before or after the command name.
8. WHERE `--help` is given, THE CLI SHALL print the usage text on stdout, SHALL exit with Exit_Code 0, and SHALL not search for a Config_File.

### Requirement 2: Argument parsing

**User Story:** As a maintainer, I want a small tested argument parser, so that the CLI has no heavy dependency and flags behave the same everywhere.

#### Acceptance Criteria

1. THE Arg_Parser SHALL parse a command name, positional arguments and flags of the forms `--flag`, `--flag value` and `--flag=value`, where a flag defined as boolean for the command takes no value, a flag defined as value-taking consumes exactly the next argument (or the text after the first `=`), and an argument that does not start with `--` and is not consumed as a flag value is positional.
2. IF a flag is not defined for the command, THEN THE Arg_Parser SHALL fail with a message that names the flag and lists every flag the command accepts.
3. IF a numeric flag value is not a positive finite decimal number (for example `0`, `-1`, `NaN`, `Infinity`, an empty string or non-numeric text), THEN THE Arg_Parser SHALL fail with a message that names the flag and the value as written.
4. IF a required positional argument is missing, THEN THE Arg_Parser SHALL fail with a message that shows the command usage line.
5. THE Arg_Parser SHALL treat every argument after the first `--` as positional, including arguments that start with `--`, and SHALL not include the `--` itself in the positional list.
6. THE Arg_Formatter SHALL format a parsed command back into an argument list that contains the command name, the flags and the positional arguments, and that places `--` before any positional argument that starts with `--`.
7. FOR ALL valid parsed commands, parsing then formatting then parsing SHALL produce an equal parsed command (round-trip property), where equal means the same command name, the same flag names with the same values, and the same positional list in the same order.
8. WHEN a command fails in the Arg_Parser, THE CLI SHALL print the failure message on stderr, SHALL exit with Exit_Code 1 and SHALL not start any simulation.
9. IF a value-taking flag is the last argument or is given an empty value (`--flag=`), THEN THE Arg_Parser SHALL fail with a message that names the flag and states that a value is required.
10. IF the command name is missing or is not one of the CLI commands, THEN THE Arg_Parser SHALL fail with a message that names the given command (or states that none was given) and lists the valid command names.
11. IF the same flag is given more than once, or the command receives more positional arguments than its usage line allows, THEN THE Arg_Parser SHALL fail with a message that names the repeated flag or the first extra argument.

### Requirement 3: `golem check`

**User Story:** As a robotics engineer, I want every EARS line compiled with exact locations, so that I fix wording errors in seconds.

#### Acceptance Criteria

1. WHEN `golem check` runs without a file, THE CLI SHALL compile every acceptance criterion in every Requirements_File named by the Config_File, in the order the Config_File lists them.
2. WHEN `golem check <file>` runs, THE CLI SHALL compile only the acceptance criteria in that file, with `<file>` resolved relative to the current working directory.
3. THE CLI SHALL print each Diagnostic on stdout as `file:line:col: severity: message`, where `line` and `col` are 1-based, `severity` is `error` or `warning`, and `file` is the path as resolved in criterion 1 or 2. WHERE the Diagnostic has a suggestion, THE CLI SHALL print the suggestion on the next line. THE CLI SHALL order Diagnostics by file order, then line, then column.
4. WHEN a line matches no lexicon template, THE CLI SHALL print the closest template as the suggestion, as produced by the compiler of `golem-ears`, and SHALL print an `error` Diagnostic for that line.
5. WHEN every line compiles without an error-severity Diagnostic, THE CLI SHALL print one summary line with the count of compiled requirements and the count of warnings, and SHALL exit with Exit_Code 0.
6. IF any line has an error-severity Diagnostic, THEN THE CLI SHALL print every Diagnostic for all files before it exits, and SHALL exit with Exit_Code 1.
7. WHERE `--json` is given, THE CLI SHALL print on stdout one JSON object with the fields `ok`, `requirements` (id, source, pattern) and `diagnostics` (file, line, col, severity, message, suggestion), and nothing else. `ok` SHALL be `true` only when no Diagnostic has severity `error`, and `suggestion` SHALL be `null` when none exists. THE CLI SHALL print this object when the Exit_Code is 0 and when it is 1 because of Diagnostics.
8. THE CLI SHALL run `golem check` without loading MuJoCo and without running any Trial.
9. IF the named file does not exist, THEN THE CLI SHALL exit with Exit_Code 1, print the path on stderr, and compile no other file.
10. WHEN a compiled file contains no acceptance criterion, THE CLI SHALL print a `warning` Diagnostic that names the file, and SHALL still exit with Exit_Code 0 if no error exists.
11. THE CLI SHALL also read the Expectation_Table of the files it compiles and print each table issue (Requirement 7A.4) in the form of a Diagnostic at column 1, count a Table_Error as an error (Exit_Code 1, `ok` false in `--json`) and the other issues as warnings. WHEN a file is named, THE CLI SHALL report only the issues of reading that file's rows, not orphan rows or lines with no row.
### Requirement 4: `golem test`

**User Story:** As a robotics engineer, I want all requirements falsified in one command, so that I see which spec lines my controller breaks.

#### Acceptance Criteria

1. WHEN `golem test` runs, THE CLI SHALL compile every requirement and falsify each one with the `golem-falsify` Falsifier, with pinned seeds run first and in the order in which they were pinned.
2. WHERE `--req <id>` is given, THE CLI SHALL falsify only that requirement and SHALL write only that requirement's Verdict into the Report_File, leaving the Report_File entries of the other requirements unchanged.
3. WHERE `--budget <n>` is given, THE CLI SHALL use `n` as the maximum trial count per requirement, counting pinned-seed trials, random trials and guided trials, where `n` is a positive integer.
4. WHERE `--time <s>` is given, THE CLI SHALL use `s` seconds as the maximum wall time per requirement, where `s` is a positive number, and SHALL end that requirement's search after the trial in progress when `s` is reached.
5. WHERE `--workers <n>` is given, THE CLI SHALL create a pool of `n` workers, where `n` is a positive integer, and WHERE it is not given, THE CLI SHALL use the Node_Pool default size.
6. WHEN neither `--budget` nor `--time` is given, THE CLI SHALL use a default budget of 64 trials per requirement.
7. WHERE both `--budget` and `--time` are given, THE CLI SHALL end the search for a requirement at whichever limit is reached first.
8. THE CLI SHALL print one line per requirement, in the order of the compiled requirements, with its id, status, margin with unit, trial count and, when the status is `broken`, the shrunk counterexample scenario with a unit on every value.
9. THE CLI SHALL print for a `held` requirement the text "no counterexample in N trials", where N is the trial count, and, when the verdict has a failure-rate bound, "; from the n uniformly random ones, failure rate below P % (95 % confidence)", where n is `randomTrials` (the bound is computed from those trials only).
10. THE CLI SHALL write the Report_File with every `Verdict`, the budget, the commit identifier when the project is a git repository, and the duration in seconds.
11. WHEN any requirement is `broken`, THE CLI SHALL exit with Exit_Code 2, and WHEN every requirement is `held`, THE CLI SHALL exit with Exit_Code 0.
12. IF any requirement has status `error` and none is `broken`, THEN THE CLI SHALL exit with Exit_Code 1.
13. WHERE `--json` is given, THE CLI SHALL print on stdout one JSON object that contains the `Verdict` list and the run metadata, and nothing else.
14. WHEN a Falsifier run produces a counterexample, THE CLI SHALL pin it through the Seed_Database before the CLI exits.
15. IF `--req` names an id that is not in the compiled requirements, THEN THE CLI SHALL exit with Exit_Code 1, list the valid ids, and not start any simulation.
16. THE CLI SHALL close the pool before it exits, on every path.
17. IF any requirement has an error-severity Diagnostic, or the compiled requirements are empty, THEN THE CLI SHALL exit with Exit_Code 1, print the Diagnostics or a message stating that no requirements were found, and not start any simulation.

### Requirement 5: `golem falsify`

**User Story:** As a robotics engineer, I want to watch one requirement being attacked, so that I see whether the search is converging.

#### Acceptance Criteria

1. WHEN `golem falsify <reqId>` runs, THE CLI SHALL falsify that one requirement with the same budget flags (`--budget <n>`, `--time <s>`, `--workers <n>`) and the same defaults as `golem test`, with pinned seeds run first.
2. WHILE the Falsifier runs, THE CLI SHALL print one progress line per Generation, in the order the Generations complete, with the phase (`random`, `guided` or `shrink`), the Generation index starting at 0, the lowest robustness so far with unit, the trials used, and the trials remaining in the budget.
3. WHEN the run ends, THE CLI SHALL print the same final line as `golem test` for that requirement, which is the line defined in Requirement 4.8 and 4.9.
4. WHEN the run ends, THE CLI SHALL replace the entry of that requirement in the Report_File and leave every other entry byte-identical, and WHEN the Report_File does not exist, THE CLI SHALL create it with only that entry.
5. THE CLI SHALL use the same Exit_Codes as `golem test`: `2` when the requirement is `broken`, `1` when it has status `error`, and `0` when it is `held`.
6. WHERE `--json` is given, THE CLI SHALL print on stdout one JSON object per line for each progress update, followed by one final line that holds the `Verdict` object, and nothing else.
7. IF `<reqId>` is missing or is not in the compiled requirements, THEN THE CLI SHALL exit with Exit_Code 1, list the valid ids, and start no simulation.
8. WHEN a Falsifier run produces a counterexample, THE CLI SHALL pin it through the Seed_Database, as `golem test` does.
9. THE CLI SHALL close the pool before it exits, on every path.

### Requirement 6: `golem replay`

**User Story:** As a robotics engineer, I want to re-run a counterexample exactly, so that I can inspect it and share it.

#### Acceptance Criteria

1. WHEN `golem replay <reqId>` runs, THE CLI SHALL re-run the most recently pinned counterexample of that requirement, which is the last entry of its list in the Seed_Database, with its stored scenario and seed.
2. WHERE `--seed <n>` is given, THE CLI SHALL re-run with seed `n` the scenario of the most recently pinned counterexample of that requirement, or the `closest` scenario of that requirement's Verdict in the Report_File when none is pinned.
3. WHEN the replay ends, THE CLI SHALL print a trace summary with the robustness and its unit, the time of the worst moment in seconds, and for each signal of the Trace its minimum, maximum and value at the worst moment, each with unit.
4. WHEN the replay ends, THE CLI SHALL write the Replay_File, replacing any earlier file of the same name, with a header row of `t` followed by the signal names in Trace order, then one row per control-rate sample in time order, with every value in SI units written as the shortest decimal string that parses back to the same number.
5. WHEN the replay ends, THE CLI SHALL print the Studio_URL, built from the `studioUrl` field of the Config_File, with the requirement id, every scenario value in SI units and the seed in the URL hash.
6. IF the Config_File has no `studioUrl`, THEN THE CLI SHALL print the Studio_URL with a relative path built from the app id.
7. WHEN the same scenario and seed are replayed twice, THE CLI SHALL write byte-identical Replay_Files.
8. IF no pinned counterexample exists and either `--seed` is not given or the Report_File has no `closest` scenario for that requirement, THEN THE CLI SHALL exit with Exit_Code 1, write no Replay_File, and state that no counterexample is pinned for that requirement.
9. THE CLI SHALL exit with Exit_Code 0 after a completed replay, whatever the robustness.
10. THE Studio_URL formatter SHALL encode a scenario and seed into a hash, and THE Studio_URL parser SHALL decode it.
11. FOR ALL valid scenarios and seeds, encoding then decoding then encoding SHALL produce an equal hash (round-trip property).
12. IF `<reqId>` is missing or is not in the compiled requirements, THEN THE CLI SHALL exit with Exit_Code 1, write no Replay_File, and list the valid ids.
13. THE CLI SHALL leave the Seed_Database and the Report_File unchanged during a replay.
14. IF the replay fails to run to completion, THEN THE CLI SHALL exit with Exit_Code 1, write no Replay_File, and print a message that names the requirement id and the cause.
### Requirement 7: `golem gate`

**User Story:** As a robotics engineer, I want a command that fails when any requirement fails, so that CI and agents cannot skip the spec.

#### Acceptance Criteria

1. WHEN `golem gate` runs, THE CLI SHALL run every pinned seed of every requirement first, and then run the Quick_Budget for every requirement, with the Quick_Budget trials counted in addition to the pinned-seed trials.
2. THE CLI SHALL use a Quick_Budget of 24 trials per requirement, unless `--budget` or `--time` is given, in which case THE CLI SHALL apply the value of that flag as in `golem test`.
3. WHEN `--kiro` is not given, every requirement meets its expectation (Requirement 7A.3: `held` for an `Expected_Hold` line, which is the default, `broken` for an `Expected_Break` line) and no pinned seed fails, THE CLI SHALL exit with Exit_Code 0, where a pinned seed fails when its re-run robustness is not greater than 0, and a failing pinned seed makes its requirement `broken`.
4. IF `--kiro` is not given and any requirement that is `Expected_Hold` is `broken`, or any requirement that is `Expected_Break` is `held`, THEN THE CLI SHALL exit with Exit_Code 2.
5. IF `--kiro` is not given and any requirement has status `error` and none fails its expectation otherwise, THEN THE CLI SHALL exit with Exit_Code 2, because the gate cannot confirm that the requirement meets its expectation.
6. IF any requirement does not meet its expectation, THEN THE CLI SHALL print for each such requirement one block with the EARS line as written, the counterexample scenario with units, the margin with unit, and the replay command `golem replay <reqId>`, and for a requirement with status `error` THE CLI SHALL print the cause of the error in place of the counterexample scenario and margin. For an `Expected_Break` line that held, the block is the one of Requirement 7A.9.
7. IF the Config_File names no requirements, or the named Requirements_Files compile to zero requirements, THEN THE CLI SHALL, WHEN `--kiro` is not given, exit with Exit_Code 2 and state that the gate has nothing to check.
8. WHEN the gate passes, THE CLI SHALL print "no counterexample in N trials", where N is the total number of trials run, counting pinned-seed trials and Quick_Budget trials of all requirements.
9. THE CLI SHALL write the Report_File after every gate run that reaches the trial phase, whatever the Exit_Code, and the Report_File SHALL hold every requirement's `Verdict`, the budget, and the duration.
10. THE CLI SHALL close the pool before it exits, on every path.
11. THE CLI SHALL, WHERE `--kiro` is not given, exit with Exit_Code 0 when the gate is green, with Exit_Code 2 when the gate is a Red_Gate (including a Config_File that names no requirements), and with Exit_Code 1 when the gate cannot start because of a usage, Config_File or compile error. WHERE `--kiro` is given, the exit codes are those of Requirement 8.

### Requirement 7A: Expectation table

**User Story:** As a robotics engineer, I want to write in the spec which lines are known to break, so that the gate is green when the robot does what the spec expects, and so that nobody can move a mark without it showing.

#### Acceptance Criteria

1. THE Expectation_Table SHALL be a Markdown table in a Requirements_File whose header row has an id column (`Criterion`, `Criteria`, `ID` or `#`) and an expectation column (a cell that starts with `Expect`), in either order and in any letter case, and whose body rows give a criterion id as the extractor numbers it (such as `1.2`) and a mark `Expected_Hold` or `Expected_Break` (letter case, and `_`, space or `-` between the words, not significant; bold, backticks and underscores around a cell ignored). THE CLI SHALL read tables anywhere in the file, in blockquotes, without leading or trailing pipes, with LF, CRLF or CR line ends and with `\|` as a pipe inside a cell, SHALL NOT read a table inside a fenced code block or indented by 4 or more spaces (and SHALL warn about the latter), and SHALL NOT read marks from prose.
2. A criterion with no row, or in a file set with no table, SHALL be `Expected_Hold`. WHILE at least one table exists, THE CLI SHALL warn about each criterion with no row.
3. A requirement SHALL meet its expectation when its verdict is `held` for `Expected_Hold` and `broken` for `Expected_Break`; a verdict of `error` meets neither. The gate SHALL be green only when the list of requirements is not empty, every requirement meets its expectation and no pinned seed fails.
4. THE CLI SHALL report these Table_Errors: a mark that is neither `Expected_Hold` nor `Expected_Break`; a row whose id no criterion has (with the nearest id when one is clear); two rows that give one id different marks, in one file or in two (the id is then `Expected_Hold`, whichever row came first). It SHALL report as warnings: a criterion with no row, the same mark given twice for one id, a table whose header has an expectation column and no id column, and a table indented 4 or more spaces.
5. WHEN the gate finds a Table_Error after the requirements compile, THE CLI SHALL run no trial. WHERE `--kiro` is not given, it SHALL print each issue on stderr and exit with Exit_Code 1. WHERE `--kiro` is given, the gate SHALL be a Red_Gate that the Gate_Counter counts, and the `reason` SHALL hold a block that states the number of errors, tells the reader to fix the rows named, to tell the user when it may not edit `requirements.md`, and not to change a mark to make the gate pass, followed by one line per error.
6. WHERE `--kiro` is given and the gate is red, THE CLI SHALL end the `reason` with a block `Expectation table notes:` that lists the warnings, so that the cut of Requirement 8.7 removes them before a counterexample.
7. THE CLI SHALL compare the effective expectation of each requirement with the one in the version of each Requirements_File at `HEAD` (`KitDeps.readCommitted`; nothing is compared outside a repository, for an untracked file or when git fails). `golem gate` SHALL print each difference as `<id>: <from> -> <to> (uncommitted)` on stdout and list it in `--json` as `expectationChanges`; under `--kiro` the `reason` SHALL begin with a block `Expectation marks changed since the last commit (a changed mark is a spec change, not a fix):` and the report `meta.expectationChanges` SHALL record them. A mark change SHALL NOT by itself change the gate decision.
8. THE Report_File SHALL record `expectation` and `met` for every verdict written by `gate`, `test`, `falsify` and the MCP run tools, and `gate --json` and `test --json` SHALL give every verdict `expectation` and `met`.
9. THE block of an `Expected_Break` line that held SHALL state `expected to break but held within budget <n> trials`, the closest margin with its scenario and seed, and then `This line held, so the controller is better than the spec expects. Look further with npx golem-spec falsify <id> --budget 200. If it still holds, tell the user to move row <id> of the Expectation table to Expected_Hold. Do not edit requirements.md yourself.`, with and without `--kiro`. The gate SHALL stay red for that line.
10. WHEN a line marked `Expected_Break` is `held` after the first pass of the gate, THE CLI SHALL run it once more in the same pool with 4 times the budget (4 times `--budget`, 4 times `--time`, or 4 times 24 trials plus its valid pinned seeds), pin any counterexample, and let that run decide the verdict and the budget the message reports.
11. WHERE at least one line is `Expected_Break`, `golem gate` without `--json` SHALL print the two groups `Expected_Hold` and `Expected_Break` with one line per requirement, and the closing line `gate GREEN: every requirement meets its expectation (...)` or `gate RED: <n> of <m> requirements do not meet their expectation`. Otherwise it SHALL print the output of Requirement 7.8 and 7.6.

### Requirement 8: `golem gate --kiro`

**User Story:** As a Kiro user, I want the Stop hook to block the agent while a requirement is broken, so that the agent keeps working until the spec holds.

#### Acceptance Criteria

1. WHERE `--kiro` is given and the gate is a Red_Gate and the Gate_Counter returns `allowStop` false, THE CLI SHALL print on stdout exactly one JSON object followed by one newline, equal to the Kiro_Stop_Output with `decision` set to `block` and a non-empty `reason`, and SHALL exit with Exit_Code 0, as Kiro's Stop hook contract requires for a blocking Stop hook.
2. THE CLI SHALL build the `reason` field as a single string that holds the per-requirement blocks of Requirement 7.6, one block for each requirement that does not meet its expectation, separated by one blank line, in requirement order, with the blocks of Requirement 7A.5 to 7A.7 before and after them.
3. WHERE `--kiro` is given and the gate is green, THE CLI SHALL print 0 bytes on stdout and SHALL exit with Exit_Code 0.
4. WHERE `--kiro` is given, THE CLI SHALL print every message other than the Kiro_Stop_Output on stderr, including the "no counterexample in N trials" line of Requirement 7.8.
5. WHERE `--kiro` is given and stdin is not a terminal, THE CLI SHALL read the Stop hook payload from stdin for at most 1 s, and SHALL ignore a payload that is empty, is not valid JSON, or is not read within that time. THE CLI SHALL take the Session_Id from a valid payload, and SHALL use the Session_Id `default` when the payload is ignored or has no non-empty string `session_id`.
6. WHERE `--kiro` is given, THE CLI SHALL decide between block and allow with the Gate_Counter and the Gate_State_File, and SHALL not read any field of the Stop hook payload other than `session_id` to make that decision.
7. THE CLI SHALL limit the `reason` string to 4000 characters, and WHEN the blocks exceed that limit, THE CLI SHALL cut the blocks at a line boundary and end the string with a final line that names the path of the Report_File, so that the total length, including that line, is at most 4000 characters.
8. IF `--kiro` is given and the Config_File names no requirements, THEN THE CLI SHALL treat the gate as a Red_Gate, and while the Gate_Counter returns `allowStop` false SHALL print a Kiro_Stop_Output whose `reason` states that the gate has nothing to check and SHALL exit with Exit_Code 0.
9. IF `--kiro` is given and the gate cannot start because of a usage error or a missing or invalid Config_File, THEN THE CLI SHALL print 0 bytes on stdout, print a message on stderr that names the cause, and exit with Exit_Code 1. IF `--kiro` is given and a Requirements_File has an error-severity Diagnostic, THEN THE CLI SHALL treat the gate as a Red_Gate that the Gate_Counter counts, and while the Gate_Counter returns `allowStop` false SHALL print a Kiro_Stop_Output whose `reason` lists the Diagnostics and SHALL exit with Exit_Code 0.
10. WHERE `--kiro` is given, THE CLI SHALL write the Report_File after the run, as in Requirement 7.9, keeping every Gate_Override already in the Report_File.
11. THE Gate_Counter SHALL, for a green gate, return `allowStop` true and a `nextState` without the key of that Session_Id, and SHALL leave every other key unchanged.
12. THE Gate_Counter SHALL, for a Red_Gate whose count for that Session_Id before the call is below the Block_Limit (a missing key counts as 0), return `allowStop` false and a `nextState` in which that count is increased by 1, so that up to 5 consecutive blocks are returned per Session_Id.
13. THE Gate_Counter SHALL, for a Red_Gate whose count for that Session_Id before the call equals the Block_Limit, return `allowStop` true and a `nextState` in which the key of that Session_Id has `count` 0 and a fresh `updatedAt`, so that the next Red_Gate for that Session_Id is blocked again, for up to 5 more consecutive blocks, and the count is not latched at the Block_Limit.
14. THE Gate_Counter SHALL change no key other than the key of the given Session_Id, so that the counters of different Session_Ids are independent.
15. THE Gate_Counter SHALL be a pure function, with no file access, no clock read, no random number and no mutation of its input `state`.
16. WHERE `--kiro` is given, THE CLI SHALL write the Gate_State_File after each run that reaches the gate decision and before it prints on stdout, by writing a temporary file in the same directory and renaming it over the target path, and SHALL create the `.golem` directory when it does not exist.
17. IF the Gate_State_File does not exist, THEN THE CLI SHALL treat the state as empty without a warning, and IF it cannot be read or is not valid JSON of the expected shape, THEN THE CLI SHALL treat the state as empty and print a warning on stderr that names the path.
18. THE CLI SHALL remove from the state, before it calls the Gate_Counter, every entry whose `updatedAt` is more than 7 days before the current time, and SHALL treat an entry with an invalid `updatedAt` as older than 7 days.
19. IF writing the Gate_State_File fails, THEN THE CLI SHALL print a warning on stderr that names the path and the cause, SHALL remove its temporary file, and SHALL still apply the decision of the Gate_Counter for this run.
20. WHEN the Gate_Counter returns `allowStop` true for a Red_Gate, THE CLI SHALL print 0 bytes on stdout (and in particular no JSON with `decision` set to `block`), SHALL exit with Exit_Code 0, and SHALL print on stderr a multi-line message that states the gate is still RED after 5 blocks for that Session_Id and lists each requirement that does not meet its expectation with its id and its EARS line (for an `Expected_Break` line that held, followed by the reason in parentheses).
21. WHEN the Gate_Counter returns `allowStop` true for a Red_Gate, THE CLI SHALL append one Gate_Override to the `gateOverrides` array of the Report_File, with the Session_Id, the current time as UTC ISO 8601, the count (5) and the ids of the requirements that do not meet their expectation (`unmetReqIds`, and `brokenReqIds` as defined in the Gate_Override entry), before the CLI exits.
22. WHERE `--kiro` is given, THE CLI SHALL exit with Exit_Code 0 for every gate outcome (green, blocked Red_Gate and allowed Red_Gate), and SHALL exit with Exit_Code 1 only for a usage error or a missing or invalid Config_File (criterion 9), so that the block decision is carried by the Kiro_Stop_Output and not by the exit code.
23. WHEN a green gate runs with `--kiro`, THE Gate_Counter SHALL delete the key of that Session_Id, and a later Red_Gate for that Session_Id SHALL start counting from 0.
24. THE Gate_Counter SHALL advance at most once per Session_Id per Stop event: WHEN the Gate_State_File holds an entry for the Session_Id whose `updatedAt` is less than DEDUPE_WINDOW_S (2 s) before the start of the current invocation (the `elapsedS` argument) and the current gate result is a Red_Gate, as the earlier one was, THE Gate_Counter SHALL return a `nextState` equal to its input `state` and SHALL return `allowStop` true when the count of that entry is 0 and false otherwise, so that two calls within the window equal one call.
25. FOR ALL states, Session_Ids and Red_Gate results, calling the Gate_Counter twice with `elapsedS` below DEDUPE_WINDOW_S, the second call receiving the `nextState` of the first, SHALL produce the same `allowStop` and the same `nextState` as the first call alone (dedupe property).

### Requirement 9: `golem init`

**User Story:** As a robotics engineer, I want one command that installs the Kiro configuration, so that a new project gets the hooks, agents and steering without manual copying.

#### Acceptance Criteria

1. WHEN `golem init` runs, THE CLI SHALL copy every Pack_File of the Kiro_Pack into `.kiro/` of the target directory, keeping relative paths and creating any missing directory. The target directory is the first positional argument, or the current working directory when no positional argument is given.
2. WHEN `golem init` runs and no Config_File exists in the target directory, THE CLI SHALL write a Config_File. WHEN the Starter_Robot is written (criterion 17), THE Config_File SHALL name `./app.js` as the RobotApp module, `.kiro/specs/cartpole/requirements.md` as the Requirements_File, `cartpole` as `robot` and `pole_angle: rad` and `cart_x: m` as `signalUnits`. OTHERWISE its fields for the RobotApp module and the Requirements_Files SHALL hold placeholder values (`./app.js` and `.kiro/specs/robot/requirements.md`) that satisfy the field checks of Requirement 1.4.
3. WHEN a target file, including the Config_File, already exists and `--force` is not given, THE CLI SHALL leave it byte for byte unchanged and print the line "skipped <path> (exists)".
4. WHERE `--force` is given, THE CLI SHALL overwrite every existing Pack_File and the placeholder Config_File with the template content, except `settings/mcp.json`, for which THE CLI SHALL replace only the `golem` entry of `mcpServers` with the template entry and SHALL preserve every other `mcpServers` entry and every other top-level field. `--force` applies to the Pack_Files only: it SHALL NOT overwrite a Starter_Robot file and SHALL NOT replace a Config_File that names an app that exists (criterion 22).
5. THE CLI SHALL print one line "wrote <path>" for every file it writes, with `<path>` relative to the target directory and written with `/` separators.
6. WHEN `golem init` runs a second time on the same target directory without `--force`, THE CLI SHALL write no file, SHALL print one "skipped <path> (exists)" line for every Pack_File and the Config_File, SHALL print the line "skipped starter robot (<reason>)" of criterion 19, and SHALL exit with Exit_Code 0.
7. THE CLI SHALL write every file by writing a temporary file in the same directory and renaming it over the target path.
8. IF a target path is outside the target directory after path resolution, including resolution of `..` segments and symbolic links, THEN THE CLI SHALL exit with Exit_Code 1, print a message that names the path, and write no file.
9. THE CLI SHALL set the executable bit on no file it writes, and the command of the `preToolUse` hook in the `golem-tuner` Agent_File SHALL start the Requirements_Guard through `node <path>`.
10. WHEN `golem init` completes without an error, THE CLI SHALL exit with Exit_Code 0, including when every file was skipped.
11. THE CLI SHALL copy the Pack_Files byte for byte, so that a file in `.kiro/` written by `golem init` equals its template.
12. THE Config_File writer SHALL format a Config_File as JSON with 2-space indentation, a key order that does not depend on the order of the input fields, and a trailing newline, and THE Config_File parser SHALL read it back.
13. FOR ALL valid Config_File values, writing then parsing SHALL produce an equal value (round-trip property).
14. IF writing or renaming a file fails, THEN THE CLI SHALL remove its temporary file, leave the existing target file unchanged, stop without writing further files, print a message that names the failing path, and exit with Exit_Code 1.
15. IF the Kiro_Pack cannot be read, THEN THE CLI SHALL exit with Exit_Code 1, print a message that names the Kiro_Pack path, and write no file.
16. WHEN `golem init` runs, THE CLI SHALL copy the Requirements_Guard from the Pack_File `hooks/golem-guard-requirements.mjs` to `.kiro/hooks/golem-guard-requirements.mjs` of the target directory, together with the other Pack_Files and under the rules of criteria 3, 4 and 7.
17. WHEN `golem init` runs without `--no-starter`, the package ships the Starter_Robot and no blocker of criterion 19 applies, THE CLI SHALL write `app.js`, `robot/scene.xml`, `.kiro/specs/cartpole/requirements.md` and `README.md` of the Starter_Robot into the target directory, before the Config_File, and SHALL print `wrote app.js (starter cart-pole robot)` and one `wrote <path>` line for each of the other files.
18. WHEN the Starter_Robot has been written into a project with no other robot, THE commands `check`, `test --budget 24`, `gate` and `replay 1.2` SHALL run with only `golem-spec` installed and no build step: `check` SHALL exit with Exit_Code 0 and report 3 compiled requirements, `test --budget 24` SHALL report line 1.1 and line 2.1 as held and line 1.2 as broken, `gate` SHALL exit with Exit_Code 2 and name 1.2, and `replay 1.2` SHALL re-run the shrunk counterexample and write `.golem/replays/1.2.csv`.
19. IF `golem.config.json` exists and is not the placeholder Config_File of an earlier `golem init`, or `app.js`, `robot/scene.xml`, `.kiro/specs/cartpole/requirements.md` or the directory `robot/` exists, THEN THE CLI SHALL write no Starter_Robot file and SHALL print `skipped starter robot (<reason>)`, where `<reason>` is `golem.config.json names an app that exists`, `golem.config.json exists`, `<path> exists` or `robot/ exists`. The Pack_Files and the placeholder Config_File are still written.
20. WHEN `README.md` already exists, THE CLI SHALL leave it byte for byte unchanged, SHALL print `skipped README.md (exists)`, and SHALL still write the rest of the Starter_Robot.
21. WHERE `--no-starter` is given, THE CLI SHALL write the Pack_Files and the placeholder Config_File only, and SHALL print no line that mentions the starter robot or `next:`.
22. THE CLI SHALL NOT overwrite an existing Starter_Robot file with or without `--force`, and SHALL keep a Config_File that names an app that exists byte for byte, printing `skipped golem.config.json (names an app that exists)` when `--force` would otherwise have replaced it.
23. WHEN the Config_File is the placeholder written by an earlier `golem init` and the Starter_Robot is written, THE CLI SHALL replace it with the starter Config_File and SHALL print `wrote golem.config.json (replaced the empty placeholder)`.
24. WHEN the Starter_Robot is written, THE CLI SHALL print `next: npx --no-install golem-spec check` as the last line, and SHALL print no `next:` line otherwise.
25. IF a Starter_Robot file cannot be read from the package, THEN THE CLI SHALL exit with Exit_Code 1, print a message that names the starter path and the file, and write no file. Every Starter_Robot target is subject to the containment check of criterion 8.
26. WHEN the RobotApp module is a `.js` file written as a self-contained ES module (no relative import) in a package whose nearest `package.json` does not set `"type": "module"`, THE CLI SHALL import it through a cached `.mjs` copy whose `import.meta.url` points at the original file, so that `./robot/` still resolves. IF the module uses ES module syntax and imports other files, THEN THE CLI SHALL fail with a message that asks for `"type": "module"` in the nearest `package.json`.

### Requirement 10: `golem mcp` and server lifecycle

**User Story:** As a Kiro agent, I want an MCP server on stdio, so that I can call GOLEM tools instead of parsing CLI text.

#### Acceptance Criteria

1. WHEN `golem mcp` runs, THE CLI SHALL start the MCP_Server on stdio and SHALL answer an MCP `initialize` request within 2 s of receiving it.
2. WHILE the MCP_Server runs, THE MCP_Server SHALL write only MCP protocol messages on stdout, with each message on its own line, and SHALL write all logs on stderr.
3. THE MCP_Server SHALL create one worker pool at the first tool call that needs it, reuse that same pool for every later tool call, and close it on shutdown. A tool call that does not need a pool SHALL NOT create one.
4. WHEN stdin closes, THE MCP_Server SHALL close the pool, if one exists, and exit with Exit_Code 0 within 5 s.
5. THE MCP_Server SHALL run every MCP_Tool in the same process, with no child process for the CLI.
6. THE MCP_Server SHALL locate the app with the Config_Locator, using `--app` when given and otherwise the working directory, once at startup.
7. IF no Config_File is found, THEN THE MCP_Server SHALL start and SHALL answer each tool call with a Tool_Result that has the MCP error flag set and whose summary line names the directory where the search started and suggests `golem init`.
8. THE MCP_Server SHALL accept a server factory that takes an injected transport and an injected app, so that tests connect through the In_Memory_Transport.
9. IF the worker pool cannot be created or a pool call throws, THEN THE MCP_Server SHALL answer that tool call with a Tool_Result that has the MCP error flag set and whose summary line states the cause, SHALL stay running, and SHALL try to create the pool again at the next tool call that needs it.
10. IF the Config_File is found but is invalid as defined in Requirement 1, THEN THE MCP_Server SHALL start and SHALL answer each tool call with a Tool_Result that has the MCP error flag set and whose summary line names the file path and the first invalid field.
### Requirement 11: MCP tools, listing and checking

**User Story:** As a Kiro agent, I want to read the requirements and test a candidate line, so that I can work from the spec without running physics.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose exactly the eight tools `list_requirements`, `check_requirement`, `run_requirement`, `falsify`, `get_counterexample`, `replay`, `explain_margin` and `propose_requirement`, each with a non-empty name, a non-empty description and a JSON input schema.
2. WHEN `list_requirements` is called, THE MCP_Server SHALL return, in the order of the lines in the Requirements_File, one entry per requirement with its id, its EARS line and its last status from the Report_File. The status SHALL be one of `held`, `broken` or `error` as recorded in the Report_File, or `unknown` when the Report_File has no entry for that requirement or does not exist.
3. IF the Report_File exists but cannot be parsed, THEN THE MCP_Server SHALL still return every requirement with status `unknown`, SHALL include a note that the Report_File is unreadable, and SHALL leave the Report_File unchanged.
4. WHEN `check_requirement` is called with `text`, a string of 1 to 2000 characters holding one EARS line, THE MCP_Server SHALL compile the text and return its Diagnostics (each with line, column, message and optional suggestion) and, when it compiles, its Scenario_Space, without running any Trial and without writing any file.
5. IF the `text` passed to `check_requirement` does not compile, THEN THE MCP_Server SHALL return the Diagnostics with suggestions as a successful Tool_Result, and SHALL not report a protocol error.
6. WHEN `get_counterexample` is called with `reqId`, THE MCP_Server SHALL return the most recently pinned counterexample for that `reqId`, which is the last entry of its pinned list, with its scenario, seed, robustness and unit.
7. IF no counterexample is pinned for `reqId`, THEN THE MCP_Server SHALL return a Tool_Result that states so, with `counterexample` set to null.
8. IF a tool that takes `reqId` is called with a `reqId` that matches no requirement in the Requirements_File, THEN THE MCP_Server SHALL return an error Tool_Result that lists the valid ids, and SHALL run no Trial.
9. IF the arguments do not match the input schema of the tool, THEN THE MCP_Server SHALL return an error Tool_Result that names the invalid field, and SHALL run no Trial.

### Requirement 12: MCP tools, running and falsifying

**User Story:** As a Kiro agent, I want to run and falsify a requirement from a tool call, so that I can check my fix without leaving the conversation.

#### Acceptance Criteria

1. WHEN `run_requirement` is called with `reqId` and `budget`, THE MCP_Server SHALL run the requirement for at most `budget` trials, running every pinned seed for that `reqId` first, and SHALL return the `Verdict` with the fields `status`, `trials`, `randomTrials`, `guidedTrials`, `closest` and, when one was found, `counterexample`.
2. WHEN `falsify` is called with `reqId` and `budget`, THE MCP_Server SHALL run the full Falsifier, including shrinking, within `budget` search trials, and SHALL return the `Verdict` with the shrunk counterexample, whose `shrunk` field is true, when one was found.
3. THE MCP_Server SHALL accept a `budget` that is an integer from 1 to 1024 inclusive, and SHALL use 24 when `budget` is omitted.
4. IF `budget` is not an integer from 1 to 1024, THEN THE MCP_Server SHALL return an error Tool_Result that names `budget` and states the accepted range, and SHALL run no Trial.
5. WHEN a run produces a counterexample, THE MCP_Server SHALL pin it through the Seed_Database and SHALL update the entry for that `reqId` in the Report_File, before it returns the Tool_Result.
6. IF a tool call runs longer than the Tool_Time_Cap, THEN THE MCP_Server SHALL stop the run through the AbortSignal within 1 s and SHALL return a Tool_Result, not an error, with the best `Verdict` fields available and a note that the time cap ended the run.
7. WHEN a client cancels a tool call, THE MCP_Server SHALL abort the run within 1 s and SHALL leave the Seed_Database and the Report_File unchanged.
8. THE MCP_Server SHALL run at most one falsification at a time and SHALL queue further run calls in arrival order.

### Requirement 13: MCP tools, replay and margin explanation

**User Story:** As a Kiro agent, I want to see what happened in a failure, so that I fix the cause and not the symptom.

#### Acceptance Criteria

1. WHEN `replay` is called with `reqId` and an optional `seed`, THE MCP_Server SHALL re-run the pinned counterexample as the CLI does, using the pinned counterexample whose seed equals `seed` or, when `seed` is omitted, the latest pinned counterexample, and SHALL return a trace summary sampled at 10 Hz, the time in seconds and the robustness with unit of the worst moment, and the Studio_URL.
2. THE MCP_Server SHALL limit the trace summary to 200 samples, SHALL keep the earliest samples when the trace is longer, SHALL state the sampling interval of 0.1 s in the result, and SHALL state in the result whether the summary was truncated.
3. WHEN `explain_margin` is called with `reqId`, THE MCP_Server SHALL replay the latest pinned counterexample and return the signal whose margin was lowest, the time in seconds of that moment, the margin with unit, and the margin with unit of each other signal that the requirement reads at that time, and SHALL name the signal that comes first in the requirement's signal list when two signals tie for the lowest margin.
4. WHEN `explain_margin` is called for a requirement with no pinned counterexample, THE MCP_Server SHALL use the `closest` scenario and seed of the latest Verdict for that `reqId` in the Report_File, and SHALL state in the result that the scenario is the closest one and not a counterexample.
5. IF `explain_margin` is called for a requirement that has neither a pinned counterexample nor a Report_File entry, THEN THE MCP_Server SHALL return an error Tool_Result that suggests calling `falsify`.
6. THE MCP_Server SHALL return identical `replay` results, excluding wall-clock durations, for identical scenario and seed.
7. IF `replay` is called for a requirement with no pinned counterexample, or with a `seed` that matches no pinned counterexample of that requirement, THEN THE MCP_Server SHALL return an error Tool_Result that states which case occurred and, when pinned seeds exist, lists them, and SHALL run no Trial.
8. THE monitor result of a CompiledRequirement MAY carry an optional field `margins`, a map from signal name to margin in the unit of the result, and THE CompiledRequirement MAY carry an optional field `predicates`, a binding of each lexicon predicate used by the requirement to the signals it reads, which `explain_margin` uses to recompute margins. WHEN the monitor result of the replayed trial carries `margins`, THE MCP_Server SHALL use it for `explain_margin`, and WHEN it does not, THE MCP_Server SHALL recompute the per-signal margins from `predicates` (or, when `predicates` is absent, from the lexicon predicate signals) along the replayed Trace. THE MCP_Server SHALL obtain the replayed Trace from the trace exposure of `golem-sim` and SHALL label signal units from the optional `signalUnits` of the RobotApp when present. Each of `margins`, `predicates`, `signalUnits` and the trace exposure is an optional addition to a sibling contract that renames and removes no existing field.

### Requirement 14: MCP tool, propose a requirement

**User Story:** As a skeptic or tuner agent, I want to propose a harsher requirement without editing the spec, so that a human decides what the robot must meet.

#### Acceptance Criteria

1. WHEN `propose_requirement` is called with `text` that compiles with no Diagnostic of severity error, THE MCP_Server SHALL append the text to the Proposals_File without changing earlier entries, and SHALL return a successful Tool_Result that names the Proposals_File path and includes any warning Diagnostics.
2. THE MCP_Server SHALL write each proposal as one entry with a timestamp in UTC ISO 8601 form, the EARS line as supplied, and the caller-supplied rationale when given.
3. IF the text does not compile, THEN THE MCP_Server SHALL leave the Proposals_File unchanged and return the Diagnostics with suggestions as a successful Tool_Result that states the proposal was not recorded, without reporting a protocol error.
4. THE MCP_Server SHALL not write to any Requirements_File through any tool.
5. THE MCP_Server SHALL create the Proposals_File and its directory when they do not exist.
6. IF the proposed line is equal, ignoring whitespace, to a line already in the Proposals_File or a Requirements_File, THEN THE MCP_Server SHALL leave the Proposals_File unchanged and return a successful Tool_Result that states the proposal is a duplicate and names the file and line number of the existing match.
7. THE MCP_Server SHALL derive the `<robot>` directory from the `robot` field of the Config_File, or from the app id when the field is absent.
8. THE MCP_Server SHALL write the Proposals_File by writing a temporary file in the same directory and renaming it, so that a reader never sees a partially written file.
9. THE MCP_Server SHALL accept `text` of 1 to 1000 characters and an optional `rationale` of 0 to 1000 characters, and an input outside these limits SHALL be handled as a schema mismatch under Requirement 11.9.
10. IF writing the Proposals_File fails, THEN THE MCP_Server SHALL leave the existing Proposals_File content unchanged, remove any temporary file it created, and return an error Tool_Result that names the path and the cause.
11. WHEN two `propose_requirement` calls overlap in time, THE MCP_Server SHALL process them one after the other in arrival order, so that both accepted proposals appear in the Proposals_File.

### Requirement 15: Tool result format and limits

**User Story:** As a Kiro agent, I want every tool result in one predictable shape, so that I can read the summary first and parse the detail second.

#### Acceptance Criteria

1. THE MCP_Server SHALL return each Tool_Result as exactly two text blocks, in this order: a first block that is one line of at most 200 characters with no line break (the plain summary), and a second block that is valid JSON, parseable by `JSON.parse` without error.
2. THE MCP_Server SHALL write the summary in plain words, in the voice of `product.md`. The summary SHALL state what happened, give every physical quantity in it with an SI unit, and contain no unitless physical number. For a broken requirement it SHALL also state by how much the requirement broke and the reproduction command.
3. WHEN a tool call fails, THE MCP_Server SHALL set `isError` to true on the Tool_Result, give a first block that is a one-line summary of what failed, and give a second block that is valid JSON. THE MCP_Server SHALL leave the Seed_Database and the Report_File unchanged by the failed call.
4. IF the UTF-8 encoded JSON block would exceed 32768 bytes, THEN THE MCP_Server SHALL repeatedly cut the largest array in the JSON to fewer elements, keeping its leading elements in original order, until the block is at most 32768 bytes. THE MCP_Server SHALL add a `truncated` field that names each cut array and gives its original length and the number of elements kept.
5. THE MCP_Server SHALL stop every MCP_Tool call that runs longer than the Tool_Time_Cap. The Tool_Time_Cap SHALL be the value in seconds of the Config_File field `toolTimeCapS`, and SHALL be 60 s when the field is absent. For `run_requirement` and `falsify`, the result is defined by Requirement 12.6. For every other MCP_Tool, the Tool_Result SHALL be an error Tool_Result whose summary states that the time cap ended the call.
6. IF `toolTimeCapS` is not a positive finite number, THEN THE CLI SHALL exit with Exit_Code 1 when it starts `golem mcp` and print a message that names the field and the value.
7. THE MCP_Server SHALL make no network request.
8. THE MCP_Server SHALL not call an LLM to decide any verdict.
### Requirement 16: Steering template

**User Story:** As a Kiro user, I want the agent to learn the GOLEM dialect when it opens a requirements file, so that it writes lines that compile.

#### Acceptance Criteria

1. THE Kiro_Pack SHALL contain `steering/golem-ears.md` with front matter `inclusion: fileMatch` and `fileMatchPattern` that matches `**/requirements.md`.
2. THE Pack_File `steering/golem-ears.md` SHALL describe each of the five EARS patterns (Ubiquitous, Event, State, Unwanted, Optional) with its shape and one example line, the use of units on every number except counts and ratios declared as `{ratio}`, the use of ranges in triggers, the use of `golem check`, and the rule that a requirement is never edited to make a test pass.
3. THE Pack_File `steering/golem-ears.md` SHALL name the MCP_Tool `propose_requirement` and the Proposals_File path `.kiro/specs/<robot>/proposals.md` as the place for requested requirement changes.
4. THE Pack_File `steering/golem-ears.md` SHALL list exactly these accepted units: N, kN, m, cm, mm, s, ms, m/s, cm/s, deg, °, rad, kg, g and %.
5. WHEN `golem init` copies the Kiro_Pack into a Project, THE CLI SHALL write `steering/golem-ears.md` under the Project's `.kiro/` directory with content byte-identical to the Pack_File.

### Requirement 17: Hook file

**User Story:** As a Kiro user, I want ready hooks that run GOLEM at the right moments, so that the loop runs without my reminding the agent.

#### Acceptance Criteria

1. THE Hook_File SHALL be valid JSON with `version` equal to `v1` and a `hooks` array of exactly 5 hooks, where each hook has a non-empty string `name`, a non-empty string `trigger`, and an `action` that is an object with `type` equal to `command` and a non-empty string `command`, and where each PostFileSave hook has a non-empty string `matcher` that is a valid regular expression (compiles with `new RegExp`).
2. THE Hook_File SHALL contain a PostFileSave hook with the matcher regular expression `(^|[\\/])requirements\.md$` (a path whose final segment is `requirements.md`, after a start of string, `/` or `\`) whose `action.command` is `golem check`, so that the matcher matches `requirements.md`, `a/b/requirements.md` and `a\b\requirements.md` and does not match `my-requirements.md` or `requirements.md.bak`.
3. THE Hook_File SHALL contain a PostFileSave hook with the matcher regular expression `(^|[\\/])controller[\\/]` (a path with a `controller` directory segment) whose `action.command` is `golem test --budget 24`, so that the matcher matches `apps/stagger/controller/gait.ts` and `controller\a.ts` and does not match `apps/stagger/my-controller/a.ts` or `controller.ts`.
4. THE Hook_File SHALL contain a Stop hook whose `action.command` is `golem gate --kiro`.
5. THE Hook_File SHALL contain a PostTaskExec hook whose `action.command` is `golem test`, run so that the Config_Locator resolves the App_Dir of the robot that the executed spec belongs to.
6. THE Hook_File SHALL contain a manual hook named "Summon the ghosts" with `trigger` equal to `Manual` and `action.command` equal to `golem test --budget 256`.
7. THE Hook_File SHALL use only trigger names from this set, with exact casing: `PostFileSave`, `PostTaskExec`, `Stop` and `Manual`.
8. THE Hook_File SHALL contain no hook whose trigger is `PreToolUse` (compared ignoring case) and no hook that references the Requirements_Guard, so that no workspace-level hook can block a write to `requirements.md` by any agent other than `golem-tuner`, including Kiro's own spec mode.
9. THE Hook_File SHALL give each hook a `name` that differs, ignoring case, from the `name` of every other hook.
10. THE Hook_File SHALL set on each hook a `timeout` in whole seconds, no less than the measured wall time in seconds of one Quick_Budget run for the Tiny_Test_App, and SHALL state each timeout value and its reason in the steering file or in the `description` field of that hook.

### Requirement 18: Requirements guard

**User Story:** As a robotics engineer, I want the tuner agent blocked from editing requirements, so that it cannot make a test pass by weakening the spec.

#### Acceptance Criteria

1. WHEN the Requirements_Guard receives a PreToolUse payload on stdin in which at least one target path (from the `path` field, the `file_path` field or the `paths` array) has the final segment `requirements.md` after normalisation, THE Requirements_Guard SHALL exit with Exit_Code 2.
2. WHEN the Requirements_Guard exits with Exit_Code 2, THE Requirements_Guard SHALL write on stderr the message "golem-tuner may not edit requirements. Propose changes with propose_requirement." and SHALL leave the target file unmodified.
3. WHEN no target path has the final segment `requirements.md` after normalisation, THE Requirements_Guard SHALL exit with Exit_Code 0.
4. THE Requirements_Guard SHALL decide only from the PreToolUse payload on stdin, SHALL read no environment variable and SHALL read no agent name, so that its result is the same under every environment.
5. THE Requirements_Guard SHALL read the target paths from the `path` field, the `file_path` field and the `paths` array of the tool input, and SHALL treat the call as targeting `requirements.md` if at least one path found in any of these fields has the final segment `requirements.md`.
6. THE Requirements_Guard SHALL compare paths after converting `\` to `/`, resolving `.` and `..` segments, and folding letter case, on every operating system, so that `Requirements.md` and `a\..\requirements.md` are recognised, and a final segment such as `my-requirements.md` is not.
7. IF the payload is not valid JSON, or contains no non-empty string in the `path`, `file_path` or `paths` fields, THEN THE Requirements_Guard SHALL exit with Exit_Code 0 and write a warning on stderr that states the cause (invalid JSON or no path), so that an unrelated tool call is never blocked by a parsing fault.
8. THE Requirements_Guard SHALL use only Node built-in modules and SHALL make no network request.
9. FOR ALL generated payloads, THE Requirements_Guard SHALL exit with Exit_Code 2 if and only if at least one target path has the final segment `requirements.md` after normalisation (guard property).
10. THE Requirements_Guard SHALL finish and exit within 500 ms of receiving a payload of up to 1 MiB on stdin.
11. THE Requirements_Guard SHALL be referenced only by the agent-scoped `preToolUse` hook of the `golem-tuner` Agent_File, so that it blocks `requirements.md` writes only while `golem-tuner` is the active agent, and no Hook_File, no other Agent_File and no workspace-wide setting references it.

### Requirement 19: Tuner agent

**User Story:** As a robotics engineer, I want an agent that fixes the controller until the gate passes, so that I get a repair loop, not an opinion.

#### Acceptance Criteria

1. THE Tuner_Agent file SHALL name the agent `golem-tuner` and SHALL give a description of 1 to 200 characters that states the agent repairs controller code until `golem gate` passes.
2. THE Tuner_Agent file SHALL pre-approve writes only to `controller/**` and tuning files, through `toolsSettings.write.allowedPaths` in the Source_Template and the equivalent allow rule in `permissions` in the upgraded file, and SHALL list no other pre-approved write path pattern. THE Tuner_Agent file SHALL also contain a Deny_Rule that denies `fs_write` to every path (`**`) with an `exclude` list of exactly the allowed patterns, so that writes outside `controller/**` and the tuning files are denied. Tuning files are the files in `controller/**` or a `tuning/**` directory under the App_Dir that hold controller parameters.
3. THE Tuner_Agent file SHALL register the `golem` MCP server with the command `golem mcp`, and SHALL list that server in `mcpServers` and its tools in `allowedTools`.
4. THE Tuner_Agent file SHALL contain its own agent-scoped `preToolUse` hook with a matcher for the write tools and the command `node .kiro/hooks/golem-guard-requirements.mjs`, and its own Stop hook whose command is `golem gate --kiro`.
5. THE Tuner_Agent prompt SHALL explain the loop in this order: falsify, read the counterexample, explain the margin, fix the controller, re-run, and repeat until `golem gate` exits with Exit_Code 0.
6. THE Tuner_Agent prompt SHALL state that requirements are never edited and that changes are proposed with `propose_requirement`.
7. THE Tuner_Agent prompt SHALL state that a `held` verdict means no counterexample was found within the stated budget, and not a proof.
8. THE Tuner_Agent file SHALL pass the structural validation of Requirement 28 and SHALL contain no absolute path and no user home directory.
9. THE `golem-tuner` Agent_File SHALL be the only Agent_File in the Kiro_Pack that contains a hook referencing the Requirements_Guard.

### Requirement 20: Skeptic and scribe agents

**User Story:** As a robotics engineer, I want one agent that attacks my spec and one that drafts requirement lines from plain language, so that proposals for harsher and clearer requirements wait for my review without my typing them.

#### Acceptance Criteria

1. THE Skeptic_Agent file SHALL name the agent `golem-skeptic`, SHALL give a description, SHALL list no file-writing tool in `tools` or `allowedTools`, SHALL restrict its shell tool in `toolsSettings` to commands that do not write files, SHALL contain no allow rule and no pre-approved path for writes of any kind, and SHALL contain a Deny_Rule that denies `fs_write` to every path (`**`) with no `exclude`.
2. THE Skeptic_Agent file SHALL register the `golem` MCP server and SHALL list the MCP tools `falsify`, `propose_requirement`, `list_requirements`, `check_requirement`, `get_counterexample` and `explain_margin` in `allowedTools`.
3. THE Skeptic_Agent prompt SHALL instruct the agent to propose only requirements that meet all of these conditions: `check_requirement` reports no error for the line; every number in the line carries a unit; every trigger range has a stated lower and upper bound, and the prompt asks for a one-sentence reason why a real user or environment could produce the upper bound.
4. THE Skeptic_Agent prompt SHALL instruct the agent to attach to each proposal the counterexample that motivates it, giving the requirement ID, the scenario values with units, the seed and the robustness with its unit.
5. THE Skeptic_Agent prompt SHALL instruct the agent to submit proposals only with `propose_requirement` and never to edit a Requirements_File.
6. THE Scribe_Agent file SHALL name the agent `golem-scribe`, SHALL give a description, SHALL pre-approve writes to exactly the single pattern `.kiro/specs/*/proposals.md` (`toolsSettings.write.allowedPaths` in the Source_Template and the equivalent allow rule in `permissions` after upgrade), and SHALL contain a Deny_Rule that denies `fs_write` to every path (`**`) with an `exclude` list of exactly `.kiro/specs/*/proposals.md`, so that it can write no Requirements_File and no other file.
7. THE Scribe_Agent file SHALL register the `golem` MCP server and SHALL list `check_requirement` in `allowedTools`.
8. THE Scribe_Agent prompt SHALL instruct the agent to turn the user's plain-language robot behaviour into GOLEM EARS lines, to call `check_requirement` on each line it writes, to revise the line until it compiles with no error Diagnostic, and to write each compiled line as a proposal in the Proposals_File in the entry format of Requirement 14.2.
9. IF a line still produces an error Diagnostic after 5 revisions, THEN THE Scribe_Agent prompt SHALL instruct the agent to leave the line out of the Proposals_File and to report to the user the line text and the last Diagnostic message.
10. THE Scribe_Agent prompt SHALL instruct the agent to put a unit on every number except counts and declared ratios, and, when the user's description lacks a quantity, to leave that quantity out of the line and ask the user for it rather than guess a value.
11. THE Scribe_Agent prompt SHALL state that it never edits a Requirements_File, and that a human or Kiro spec mode merges accepted proposals into `requirements.md`.
12. THE `golem-skeptic` and `golem-scribe` Agent_Files SHALL contain no hook that references the Requirements_Guard, and no pre-approved write path other than the one in criterion 6 (none at all for the Skeptic_Agent).
### Requirement 21: Agent file format and validation

**User Story:** As a maintainer, I want agent files that work on every Kiro CLI generation, so that the pack does not break on an upgrade.

#### Acceptance Criteria

1. THE build script SHALL write each Source_Template in V2_Fields only, containing the fields `name`, `description`, `prompt`, `tools` and `mcpServers` and no top-level field outside V2_Fields, and THE committed Pack_Files for agents SHALL be the files that `kiro-cli agent upgrade` wrote from the Source_Templates and that finalizeAgent then changed (criterion 2), which MAY additionally contain the V3_Fields that the upgrade emits (including `permissions` and the `kiroUpgrade` marker), and which keep the V2_Fields `toolsSettings` and `allowedTools` that the upgrade preserves, and no other field.
2. WHEN the pack is built, THE build script SHALL run these steps in this order: write the Source_Templates, run `kiro-cli agent upgrade <dir>` on the directory that holds the Agent_Files, run finalizeAgent, then run `kiro-cli agent validate --path <file>` on each Agent_File, where valid means `kiro-cli agent validate --path <file>` exits with code 0 on the file. THE finalizeAgent step SHALL be a deterministic script, SHALL never be performed manually, and SHALL append the Deny_Rule with `exclude` globs to the `permissions` of the tuner and scribe Agent_Files only. THE command name SHALL be exactly `kiro-cli agent upgrade`.
3. WHEN `kiro-cli` is installed, THE test suite SHALL run `kiro-cli agent validate --path <file>` on every Agent_File and SHALL fail on a non-zero exit, naming each failing file and its exit code.
4. WHEN `kiro-cli` is not installed, THE build script and THE test suite SHALL skip every `kiro-cli` step (upgrade, validate and the idempotence check of criterion 5), SHALL report the skip in one line that names `kiro-cli` as missing, and SHALL still run the structural validation of Requirement 28, which accepts the V3_Fields `permissions`, `kiroUpgrade` and `model` in addition to V2_Fields.
5. THE build script SHALL make no manual edits to Agent_Files, and the only post-upgrade change SHALL be the deterministic finalizeAgent step, so that re-running the whole pipeline yields byte-identical Agent_Files and a second `kiro-cli agent upgrade` leaves every finalized Agent_File unchanged (idempotence property).
6. THE Agent_Files SHALL reference no absolute path and no user home directory, where an absolute path is a string value that starts with `/`, `\`, `~` or a drive letter followed by `:`, and a user home directory is a string value that contains `/home/`, `/Users/` or `\Users\`.
7. IF `kiro-cli agent upgrade` exits with a non-zero code on an Agent_File, THEN THE build script SHALL exit with Exit_Code 1, SHALL print the file name and the `kiro-cli` stderr, and SHALL leave that Agent_File unchanged.
8. THE structural validation SHALL, for each upgraded Agent_File, check the pack invariants of Requirements 19, 20 and 28.21 on the effective permissions: the pre-approved write paths (allow rules with `fs_write`) equal the allowed set of that agent, and a Deny_Rule exists for `fs_write` outside that set.
9. IF `kiro-cli agent validate --path <file>` exits with a non-zero code on an Agent_File during the build, THEN THE build script SHALL exit with Exit_Code 1 and print the file name and the `kiro-cli` stderr.

### Requirement 22: MCP settings template

**User Story:** As a Kiro user, I want the `golem` MCP server registered by `golem init`, so that the agents find the tools.

#### Acceptance Criteria

1. THE Kiro_Pack SHALL contain the Pack_File `settings/mcp.json`, which SHALL be valid JSON with a top-level `mcpServers` object that has exactly one entry, named `golem`.
2. THE `golem` entry SHALL set `command` to the string `golem` and `args` to the array `["mcp"]`.
3. THE `golem` entry SHALL contain no `env` field, no `url` field, no string that matches `://`, and no value that is a secret or a network address.
4. WHEN `golem init` runs in a Project that has no `.kiro/settings/mcp.json`, THE CLI SHALL write that file with content equal to the Pack_File `settings/mcp.json`.
5. WHEN `golem init` runs in a Project whose `.kiro/settings/mcp.json` already exists, THE CLI SHALL add the `golem` entry only if absent, SHALL leave every other `mcpServers` entry and every existing `golem` entry unchanged, and SHALL report which of the two outcomes occurred. WHERE `--force` is also given, THE CLI SHALL replace only the `golem` entry with the template entry, SHALL preserve every other `mcpServers` entry and every other top-level field, and SHALL report that the entry was replaced.
6. WHERE the `golem` binary is not on the path, THE `golem` entry SHALL be replaceable by `command` `npx` with `args` `["golem-spec", "mcp"]`, and the steering file or the Power overview SHALL document this replacement and show the replacement entry.

### Requirement 23: Skills

**User Story:** As a Kiro user, I want skills that teach the agent the two GOLEM routines, so that it applies them without long prompts.

#### Acceptance Criteria

1. THE Kiro_Pack SHALL contain `skills/robot-ears/SKILL.md` and `skills/falsify-and-fix/SKILL.md`, each with front matter that has a `name` equal to its directory name and a non-empty `description` of at most 500 characters.
2. THE skill `robot-ears` SHALL explain how to write robot EARS lines with units and ranges, and SHALL show at least three examples that compile against the Tiny_Test_App lexicon. The explanation SHALL cover the five EARS patterns, the accepted units, and how a range in a trigger defines the search space. Each example SHALL compile with zero errors when checked against the Tiny_Test_App lexicon, and the three examples SHALL use at least three different EARS patterns.
3. THE skill `falsify-and-fix` SHALL explain the loop of falsify, read counterexample, explain margin, fix, re-run and gate. It SHALL list these six steps in this order, and SHALL state that the loop ends when `golem gate` exits 0.
4. THE skill `falsify-and-fix` SHALL state that requirement files are never edited to make a test pass, and that the controller is changed instead.
5. THE `description` of each skill SHALL state when the skill applies, so that Kiro can select it. The description SHALL contain a sentence that names at least one triggering situation, such as writing or editing robot EARS lines for `robot-ears`, or a red requirement or a failed gate for `falsify-and-fix`.

### Requirement 24: Falsify-and-fix workflow

**User Story:** As a robotics engineer, I want a workflow that repeats the tuner until the gate passes, with a cap, so that a repair run ends by itself.

#### Acceptance Criteria

1. THE Workflow_File SHALL be valid JSON and SHALL contain exactly one repeat node with `maxIterations` equal to 6 and `onMaxIterations` equal to `pause`.
2. THE repeat node SHALL, in each iteration, run the Tuner_Agent to completion and then run `golem gate` without `--kiro` in the App_Dir, in that order, exactly once each, so that Exit_Code 2 means a Red_Gate.
3. WHEN `golem gate` exits with Exit_Code 0, THE repeat node SHALL stop without starting another iteration and the workflow SHALL finish with status success.
4. WHEN `golem gate` exits with Exit_Code 2 and fewer than 6 iterations have completed, THE repeat node SHALL start the next iteration.
5. WHEN the iteration count reaches 6 and the last `golem gate` exit was Exit_Code 2, THE workflow SHALL pause and report the full stdout of the last `golem gate` run, which has one line per broken requirement with its reproduction command.
6. IF `golem gate` exits with Exit_Code 1, THEN THE workflow SHALL pause without starting another iteration and SHALL report the last `golem gate` output, so that a usage, compile or runtime error is not counted as a broken requirement.
7. THE Workflow_File SHALL reference the Tuner_Agent by the name `golem-tuner`.

### Requirement 25: Kiro Power

**User Story:** As a Kiro user, I want to install GOLEM as a Power, so that I get the MCP server, skills and steering in one step.

#### Acceptance Criteria

1. THE Power SHALL contain a Plugin_Manifest `plugin.json` in Agent Plugins 1.0 format, with a non-empty name, a version in `MAJOR.MINOR.PATCH` form, a non-empty description and the licence `Apache-2.0`, WHERE the manifest MAY carry its `$schema` URL and any other field that the Agent Plugins 1.0 schema permits, and SHALL contain no field outside that schema. THE Power SHALL contain `skills/` and `mcp.json`, which Kiro finds by convention, and THE Plugin_Manifest SHALL not be required to name their paths.
2. THE Power SHALL contain `mcp.json`, which MAY carry a `$schema` URL, with a server of `type` `stdio` whose `command` is `npx` and whose `args` are `["golem-spec", "mcp"]`.
3. THE Power SHALL contain `skills/robot-ears/SKILL.md` and `skills/falsify-and-fix/SKILL.md`, each byte-for-byte identical to its Kiro_Pack copy.
4. THE Power SHALL contain a Legacy_Power_File `POWER.md` with front matter (`name`, `displayName`, `description`, `keywords`, each non-empty) and an overview that names every MCP_Tool that the MCP_Server exposes, and a `steering/` directory with at least the steering file for the GOLEM dialect.
5. WHEN `kiro-cli powers install ./skeleton/power` runs, THE Power SHALL install with Exit_Code 0 and print no error message.
6. THE Power SHALL contain no executable script (no file with the extension `.sh`, `.bash`, `.ps1`, `.cmd`, `.bat`, `.js`, `.mjs`, `.cjs`, `.ts` or `.py`, and no file with an executable permission bit), no URL other than the `$schema` value of `plugin.json` and of `mcp.json`, no http(s) address used as a command or an endpoint, and no IP address in any file.
7. IF a skill in the Power differs from its Kiro_Pack copy by one or more bytes, THEN THE build script SHALL fail with Exit_Code 1 and print the path of each differing skill.
8. THE Power SHALL include a copy of the Apache-2.0 licence text, identical to the licence text at the repository root.

### Requirement 26: Kiro Crew app

**User Story:** As a team lead, I want a small Crew app that runs the skeptic overnight, so that harsher requirements are waiting for me in the morning.

#### Acceptance Criteria

1. THE Crew_App SHALL contain `app.json` with the fields `agents`, `skills`, `mcpServers` and `crons`, where `crons` holds one entry with a five-field `cron_expr`, a `message` and the `agent` to run. THE `app.json` SHALL contain only fields defined by the Kiro Crew manifest reference (https://kiro.dev/docs/crew/apps/manifest/), so it has no `schedule` block and no time-zone field.
2. THE `agents` field SHALL reference the Tuner_Agent, the Skeptic_Agent and the Scribe_Agent, and THE `skills` field SHALL reference `robot-ears` and `falsify-and-fix`.
3. THE `mcpServers` field SHALL register the `golem` MCP server.
4. THE Nightly_Job SHALL run the Skeptic_Agent exactly once per 24 h, at the time given by `cron_expr`, and the expression SHALL fix both the hour and the minute. The manifest reference has no time-zone field, so the zone is the one the Crew gateway uses.
5. WHEN the Nightly_Job completes, THE Crew_App SHALL end the run with a summary in the run's output that lists the number of proposals written and their requirement IDs, the IDs of the requirements whose Verdict status is `broken`, and the budget used as the number of trials run and the wall time in seconds.
6. THE Nightly_Job SHALL write only to the Proposals_File, and SHALL not create, modify or delete any Requirements_File or any file under `controller/`.
7. THE Crew_App SHALL contain no file beyond `app.json` and the files it references, so that it stays small.
8. THE `app.json` SHALL contain no secret and no network address beyond those of the Kiro services, and SHALL set `permissions.network` to `false`. The summary in 26.5 is text in the run's output and is not a network request. THE `permissions` object SHALL declare only what the app uses, so it has no `cron` permission.
9. IF the Nightly_Job fails before completing, THEN THE Crew_App SHALL end the run with a summary in the run's output that states the failure and the number of proposals written before the failure, and SHALL leave every Requirements_File and controller file unchanged.
10. THE Crew_App SHALL contain README.md, an icon PNG of at least 256 x 256 px with transparency, and one screenshot 1200 px wide at 16:9, and README.md SHALL name the Crew documentation page that defines each pp.json field kept and each field dropped.

### Requirement 27: Determinism, network, licence and horizons

**User Story:** As a maintainer, I want the kit to keep the project rules, so that results stay reproducible and the licence stays clean.

#### Acceptance Criteria

1. THE CLI and THE MCP_Server SHALL not call `Math.random()`, and SHALL derive every seed from the Config_File, a flag or a fixed default, so that a source search of `skeleton/src/cli` and `skeleton/src/mcp` finds no `Math.random` call.
2. WHEN the same requirement, budget, search seed and app are given to `golem test` twice, THE CLI SHALL print byte-identical per-requirement lines and SHALL write a Report_File whose Verdict content is equal field by field, apart from the duration fields (`ms`, `wallMs`) and timestamps.
3. THE CLI and THE MCP_Server SHALL make no network request at runtime, other than fetching static assets, so that a test with outbound network access blocked passes every command and every MCP_Tool.
4. THE CLI and THE MCP_Server SHALL add no runtime dependency beyond `@modelcontextprotocol/sdk` and those named in `tech.md`, so that the `dependencies` field of the `golem-spec` `package.json` lists no other package.
5. THE kit files SHALL carry the Apache-2.0 licence, and THE `package.json` of `golem-spec` SHALL state `Apache-2.0` in its `license` field.
6. THE kit tests that run physics SHALL use a simulated horizon of at most 2 s and a budget of at most 24 trials, and longer campaigns SHALL live in `evidence/`.
7. THE kit SHALL not rename or remove any field of any contract in `interfaces.md`, and any field it adds SHALL be optional. The optional additions that the kit relies on are `CompiledRequirement.predicates`, `RobotApp.signalUnits`, the trace exposure of `golem-sim` for replay and the monitor result field `margins` (Requirement 13.8), each added to a sibling contract.
8. THE kit SHALL reference the app only through the public entry points `golem-spec`, `golem-spec/ui` and `golem-spec/node`, so that no import specifier in a file the kit writes or reads contains `skeleton/src`.

### Requirement 28: Validation and tests

**User Story:** As a maintainer, I want every generated file and exit code tested, so that the Kiro integration cannot silently break.

#### Acceptance Criteria

1. THE kit test suite SHALL use Vitest for examples and fast-check for properties, with the Tiny_Test_App and no MuJoCo, and SHALL run each fast-check property with at least 100 generated cases.
2. THE kit test suite SHALL test that `golem check` exits with Exit_Code 1 on an error line and 0 on valid lines, that `golem gate` (without `--kiro`) exits with Exit_Code 2 when a requirement is broken and with 0 when every requirement is held, and that `golem gate --kiro` prints to stdout exactly one line that parses as JSON with `decision` equal to `"block"` and a non-empty `reason` string, and exits with Exit_Code 0, when a requirement is broken and the Gate_Counter blocks.
3. THE kit test suite SHALL test that a second `golem init` run on the same target creates no file and leaves the content of every existing file byte-identical, and that a run with `--force` replaces the content of every existing Pack_File with the Kiro_Pack content, except that for an existing `settings/mcp.json` it replaces only the `golem` entry and preserves every other `mcpServers` entry.
4. THE kit test suite SHALL test the Requirements_Guard script on payloads: it exits with code 2 for a payload whose target in `path`, `file_path` or `paths` has the final segment `requirements.md` (including `Requirements.md` and `a\..\requirements.md`), and with code 0 for every payload whose targets have another final segment, for invalid JSON and for a payload without a path, and it gives the same result when the environment variables differ.
5. THE kit test suite SHALL connect a client to the MCP_Server through the In_Memory_Transport, SHALL test that the tool list contains exactly eight MCP_Tools, and SHALL call each MCP_Tool once with valid arguments and test that each call returns a Tool_Result without an error flag.
6. THE kit test suite SHALL test that `propose_requirement` appends the proposed line to the Proposals_File and leaves every Requirements_File byte-identical.
7. THE kit test suite SHALL validate that the Hook_File, the `settings/mcp.json`, the Agent_Files, the Workflow_File, `plugin.json`, the Power `mcp.json` and `app.json` each parse as JSON and contain every field that the requirement defining that file lists as required (for the Hook_File, `version`, and for each hook `name`, `trigger` and `action.command`, and `matcher` for PostFileSave hooks; for `plugin.json`, `name`, `version`, `description` and `license`, with no field outside the Agent Plugins 1.0 schema; for the Agent_Files, the V2_Fields of Requirement 21.1 and, after upgrade, no field outside V2_Fields and V3_Fields), and that hook names in the Hook_File are unique and case-insensitively distinct.
8. THE kit test suite SHALL test that every Tool_Result has a first text block that is non-empty and contains no line break, and a second text block that parses as JSON.
9. THE kit test suite SHALL test that every skill file in the Power is byte-identical to the file with the same relative path in the Kiro_Pack, and that the two sets of skill file paths are equal.
10. FOR ALL generated Config_File values, THE Config_File writer and parser SHALL round-trip, so that parsing the written text returns a value equal to the original (round-trip property).
11. FOR ALL generated argument lists for each command, THE Arg_Parser and Arg_Formatter SHALL round-trip, so that parsing the formatted list returns a command equal to the original (round-trip property).
12. FOR ALL generated scenarios and seeds, THE Studio_URL formatter and parser SHALL round-trip, so that parsing the formatted URL returns the same scenario values and seed (round-trip property).
13. FOR ALL generated payloads, THE Requirements_Guard SHALL exit with code 2 if and only if some target path has the final segment `requirements.md` after normalisation (guard property).
14. FOR ALL generated existing-file sets, the first `golem init` run SHALL write exactly the Pack_Files that are missing from the target, and a second run SHALL write no file (idempotence property).
15. FOR ALL generated Verdict lists, THE gate exit-code function without `--kiro` SHALL return 0 if and only if every Verdict has status `held`, and SHALL return 2 otherwise, and WITH `--kiro` THE gate exit-code function SHALL return 0 for every Verdict list and return 1 only for a usage or Config_File error (gate property).
16. FOR ALL generated tool results, THE JSON block limiter SHALL return text that parses as JSON and is at most 32768 bytes in UTF-8 (limit property).
17. FOR ALL generated sequences of (session id, gate green or red) calls to the Gate_Counter, starting from an empty state, THE Gate_Counter SHALL return `allowStop` false for no more than 5 consecutive Red_Gate calls of the same Session_Id, SHALL return `allowStop` true on the 6th consecutive Red_Gate call and reset that count to 0 so that the 7th through 11th consecutive Red_Gate calls are blocked again, SHALL remove the key of a Session_Id on a green gate so that the next 5 Red_Gate calls of that Session_Id are blocked again, and SHALL leave the count of every other Session_Id unchanged by a call (gate counter property).
18. THE kit test suite SHALL test with examples that `golem gate --kiro` blocks (one-line JSON with `decision` `block` on stdout, Exit_Code 0) on the first 5 red runs of one `session_id`, on the 6th red run prints 0 bytes on stdout, exits with Exit_Code 0, prints a message on stderr that contains "RED" and lists the broken requirement ids, and appends a Gate_Override to the Report_File, and on the 7th red run blocks again.
19. THE kit test suite SHALL test with examples that a green run deletes the key of its Session_Id, that two Session_Ids keep independent counters, that a payload without `session_id` uses the key `default`, that an invalid Gate_State_File is treated as empty with a stderr warning, that an entry older than 7 days is pruned, and that the Gate_State_File is written through a temporary file and a rename.
20. THE kit test suite SHALL test that the Hook_File contains no PreToolUse hook and no reference to the Requirements_Guard, so that no workspace-level hook can block a write to `requirements.md` by an agent other than `golem-tuner`.
21. THE kit test suite SHALL test that the `golem-tuner` Agent_File has a `preToolUse` hook whose command is `node .kiro/hooks/golem-guard-requirements.mjs`, that no other Agent_File contains a hook that references the Requirements_Guard, that the `golem-skeptic` Agent_File has no write tool, no pre-approved write path and a Deny_Rule for `fs_write` on `**` with no `exclude`, that the pre-approved write paths of the `golem-scribe` Agent_File equal exactly `[".kiro/specs/*/proposals.md"]` and that it has a Deny_Rule for `fs_write` on `**` excluding exactly that pattern, and that the pre-approved write paths of the `golem-tuner` Agent_File equal exactly its allowed set (`controller/**` and the tuning files) and that it has a Deny_Rule for `fs_write` on `**` excluding exactly that set. These invariants SHALL hold on the upgraded committed files, and a structural test SHALL fail when a Deny_Rule is missing or when any write path outside the allowed set is pre-approved.
22. THE kit test suite SHALL test that `golem init` writes `.kiro/hooks/golem-guard-requirements.mjs` with content byte-identical to the Pack_File.
23. THE kit test suite SHALL test that `explain_margin` uses the `margins` map of the monitor result when present, and recomputes the per-signal margins from the lexicon predicate signals when it is absent, with equal results for a monitor whose `margins` map matches the recomputed values.
24. THE kit test suite SHALL test each Hook_File matcher regular expression against sample paths, so that `(^|[\\/])requirements\.md$` matches `requirements.md`, `specs/a/requirements.md` and `specs\a\requirements.md` and does not match `my-requirements.md`, and `(^|[\\/])controller[\\/]` matches `apps/x/controller/a.ts` and does not match `apps/x/my-controller/a.ts`.
25. THE kit test suite SHALL test that `plugin.json` and the Power `mcp.json` contain no URL other than their `$schema` value, and that the Power contains `skills/` and `mcp.json`.
26. THE kit test suite SHALL test that `golem gate --kiro` exits with Exit_Code 1 and prints 0 bytes on stdout on a usage error or a missing or invalid Config_File, that it exits with Exit_Code 0 and prints a Kiro_Stop_Output whose `reason` lists the Diagnostics on a compile error in a Requirements_File, and that a green `golem gate --kiro` run prints 0 bytes and exits with Exit_Code 0.
27. THE kit test suite SHALL test with examples the Starter_Robot rules of Requirement 9 (criteria 17 to 25) on a memory project, and SHALL run init, check and alsify of the Starter_Robot through the built CLI in an empty project with a CommonJS package.json, including the ES module loading of criterion 26.
