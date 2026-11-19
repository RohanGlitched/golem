# The GOLEM Power, installed in Kiro CLI

`skeleton/power` installed with kiro-cli 3.5.0 (`install.txt`):

```
$ kiro-cli powers install ./skeleton/power
Installed power "golem"
```

After the install, the Power's two skills (`plugin::golem::skill::falsify-and-fix`, `plugin::golem::skill::robot-ears`) are in every session's catalogue. Its MCP server is not: `kiro-cli mcp list` in an empty folder shows no `golem` server, and a session there has no golem tools (below).

Three headless sessions (default agent, Sonnet 5.5), two of them in `apps/hover`, each told to use only the golem MCP tools and to edit nothing. Their logs are `power`, `power2` and `power3` in `evidence/kiro-sessions/`, with the prompts.

- **`power`** (0.23 credits): the agent read only the skills in the catalogue, tried two tool IDs that do not exist, and reported that the MCP tools were missing. It did not fall back to the shell.
- **`power2`** (0.6 credits): told to list every golem ID in the catalogue, the agent found the eight `tool::golem::*` tools. It then ran `list_requirements`, `falsify` on 1.3, `explain_margin` and `falsify` on 1.1, through the golem MCP server:

| Line | Expectation | Verdict | Margin |
|---|---|---|---|
| 1.3 | Expected_Break | broken at a 10.04 N gust from 11.1 deg (pinned seed, found on the first trial) | -0.015 m |
| 1.1 | Expected_Hold | no counterexample in 32 trials | +0.12 m |

The agent in `power2` corrected itself: the tools were in the catalogue from the start, and the 20 s wait it ran was not needed. So the first session's report was the agent's mistake, not a missing server.

- **`power3`** (0.21 credits): a fresh starter project from the 0.1.2 tarball with its `.kiro/settings/mcp.json` and agents removed, so the Power was the only possible source of golem tools. The catalogue held the Power's two skills and no golem tool.

So in kiro-cli 3.5.0 headless, the installed Power contributes its skills but its MCP server does not start. The tools in `power2` came from `apps/hover/.kiro/settings/mcp.json`, which `golem init` writes into every project. That is the supported path: `golem init` installs the MCP entry, and the Power adds the skills and steering. We have not tried the Power in the Kiro IDE.
