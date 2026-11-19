# First-minute transcript: starter robot from the packed tarball

What a new user sees after `npm i -D golem-spec` and `npx golem-spec init` in an empty project. Run from the tarball that `npm pack` makes in `skeleton/`, installed into a fresh directory outside the repository (`%TEMP%\judge1`, not under the repo), so nothing comes from the source tree.

- Node v21.7.0, npm 10.5.0, Windows (PowerShell). No TypeScript, no build step, no other dependency installed.
- Source commit before the change: `bff3921` (branch `feat/starter`). `golem-spec` 0.1.1.
- Margins change a little with the search seed (the README of the starter gives the range over six seeds); the numbers below are the run recorded here, with the default search seed.

## Pack and install

```
$ cd skeleton
$ npm run build
$ npm pack --pack-destination %TEMP%
golem-spec-0.1.1.tgz   (525.6 kB, 836 files; includes starter/app.js, starter/README.md, starter/requirements.md, starter/robot/scene.xml)

$ mkdir judge1 && cd judge1
$ npm init -y
$ npm i -D ./golem-spec-0.1.1.tgz
added 97 packages, and audited 98 packages in 7s
found 0 vulnerabilities
```

`package.json` after the install has no `"type"` field (npm 10 `init -y`). The loader copes with both that and `"type": "commonjs"` (see `test/starter.e2e.test.ts`).

## The four commands

```
$ npx golem-spec init
wrote .kiro/agents/golem-scribe.json
wrote .kiro/agents/golem-skeptic.json
wrote .kiro/agents/golem-tuner.json
wrote .kiro/hooks/golem-guard-requirements.mjs
wrote .kiro/hooks/golem.json
wrote .kiro/settings/mcp.json
wrote .kiro/skills/falsify-and-fix/SKILL.md
wrote .kiro/skills/robot-ears/SKILL.md
wrote .kiro/steering/golem-ears.md
wrote .kiro/workflows/falsify-and-fix.workflow.json
wrote app.js (starter cart-pole robot)
wrote robot/scene.xml
wrote .kiro/specs/cartpole/requirements.md
wrote README.md
wrote golem.config.json
next: npx --no-install golem-spec check
[exit 0]

$ npx --no-install golem-spec check
3 requirements compiled, 0 warnings
[exit 0]

$ npx --no-install golem-spec test --budget 24
1.1  HELD  closest margin +17.9 deg  no counterexample in 24 trials; from the 4 uniformly random ones, failure rate below 75 % (95 % confidence)
1.2  BROKEN  margin -0.421 deg  21 trials  push.force = 14.5 N  (shrunk, seed 3909821944)
2.1  HELD  closest margin +0.193 m  no counterexample in 4 trials; from the 4 uniformly random ones, failure rate below 75 % (95 % confidence)
3 requirements: 1 broken, 2 held, 0 error, in 2.38 s (search budget 24 trials per requirement; held means no counterexample found within that budget, not a proof)
[exit 2]

$ npx --no-install golem-spec gate
1.2: WHEN the cart is pushed with up to 30 N for 0.2 s THE robot SHALL keep the pole within 30 deg of upright for 3 s
  scenario: push.force = 14.5 N (seed 3909821944)
  margin: -0.421 deg
  reproduce: npx golem-spec replay 1.2

gate RED: 1 of 3 requirements are not held
[exit 2]

$ npx --no-install golem-spec replay 1.2
replay 1.2: seed 3909821944, push.force = 14.5 N
robustness -0.421 deg at t = 0.84 s (the worst moment)
signals: minimum, maximum, and value at the worst moment
  pole_angle: min -0.531 rad, max 0.288 rad, at worst -0.531 rad
  cart_x: min -1.88 m, max 0.242 m, at worst 0.198 m
trace: .golem/replays/1.2.csv (161 samples)
studio: apps/cartpole/web/index.html#r=1.2&seed=3909821944&d.push.force=14.537130555640942
[exit 0]
```

Files in the project afterwards (besides `node_modules/`): `.golem/`, `.kiro/`, `robot/scene.xml`, `app.js`, `golem.config.json`, `README.md`, `package.json`, `package-lock.json`.

## Notes

- `replay` prints a `studio:` link to `apps/cartpole/web/index.html`. The starter has no browser studio, so that path does not exist; it is the kit's default for an app without `studioUrl`.
- Line 1.2 breaks at a push of 14.5 N because the starter's motor gives at most 15 N. The pole's worst angle is -0.531 rad (-30.4 deg) against the 30 deg limit.
