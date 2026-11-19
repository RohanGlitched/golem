# Changelog

## 0.1.1

- The Kiro pack runs every command as `npx --no-install golem-spec <command>`. Kiro's hook shells and MCP launcher do not have `node_modules/.bin` on the path, so the bare `golem` of 0.1.0 was not found, and a bare `npx golem` resolves to an unrelated npm package. `--no-install` makes npx use the copy installed by `npm i -D golem-spec` and never download another.
- The MCP entry is now `{ "command": "npx", "args": ["--no-install", "golem-spec", "mcp"] }` in `settings/mcp.json`, the three agents, the Power and the Crew app.
- Changed in the pack: `hooks/golem.json`, the agents (shell allow-lists, Stop hook), skills, steering, the `falsify-and-fix` workflow and the pack README.
- The CLI help, usage errors and `reproduce:` lines print `npx golem-spec <command>`. The bin is still named `golem`.
- `scripts/build-pack.ts` rejects agents that use the old `golem` command forms.
- Projects that ran `golem init` with 0.1.0 should run `npx golem-spec init --force` to replace the installed pack.
- `golem init` in a project with no robot also writes a starter cart-pole robot (`app.js`, `robot/scene.xml`, `.kiro/specs/cartpole/requirements.md`, `README.md`) and a `golem.config.json` that points at it, so `check`, `test --budget 24`, `gate` and `replay 1.2` work straight after `npm i -D golem-spec` with no TypeScript and no build step. Line 1.2 of the starter breaks on purpose. The starter ships in the package (`starter/`).
- `golem init` never overwrites `app.js`, `robot/`, the cartpole spec or `README.md`, and writes no starter when `golem.config.json` already names an app that exists. The new flag `--no-starter` skips it. `--force` still applies to the pack only, and no longer replaces a `golem.config.json` that names an app that exists. An earlier empty placeholder config is replaced when the starter is written. `golem init` prints `next: npx --no-install golem-spec check` after writing the starter.
- A `.js` app written as an ES module now loads when the nearest `package.json` has no `"type": "module"` (the default after `npm init -y`). The kit imports a copy under `node_modules/.cache/golem/` with `import.meta.url` still pointing at the original file. An app that also imports other files still needs `"type": "module"`, and the error says so.

## 0.1.0

First release.
