# Changelog

## 0.1.1

- The Kiro pack runs every command as `npx --no-install golem-spec <command>`. Kiro's hook shells and MCP launcher do not have `node_modules/.bin` on the path, so the bare `golem` of 0.1.0 was not found, and a bare `npx golem` resolves to an unrelated npm package. `--no-install` makes npx use the copy installed by `npm i -D golem-spec` and never download another.
- The MCP entry is now `{ "command": "npx", "args": ["--no-install", "golem-spec", "mcp"] }` in `settings/mcp.json`, the three agents, the Power and the Crew app.
- Changed in the pack: `hooks/golem.json`, the agents (shell allow-lists, Stop hook), skills, steering, the `falsify-and-fix` workflow and the pack README.
- The CLI help, usage errors and `reproduce:` lines print `npx golem-spec <command>`. The bin is still named `golem`.
- `scripts/build-pack.ts` rejects agents that use the old `golem` command forms.
- Projects that ran `golem init` with 0.1.0 should run `npx golem-spec init --force` to replace the installed pack.

## 0.1.0

First release.
