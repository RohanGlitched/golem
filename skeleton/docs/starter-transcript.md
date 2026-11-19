# First-minute transcript: starter robot from the packed tarball

What a new user sees after `npm i -D golem-spec` and `npx golem-spec init` in an empty project, and after the one fix that turns the gate green. Run from the tarball that `npm pack` makes in `skeleton/`, installed into a fresh directory outside the repository, so nothing comes from the source tree.

- Node v21.7.0, npm 10.5.0, Windows. No TypeScript, no build step, no other dependency installed.
- `golem-spec` 0.1.2. Margins change a little with the search seed (the starter's README gives the range over six seeds); the numbers below are the run recorded here, with the default search seed.

## Pack and install

```
$ cd skeleton
$ npm run build
$ npm pack
golem-spec-0.1.2.tgz

$ mkdir judge2 && cd judge2
$ npm init -y
$ npm i -D ./golem-spec-0.1.2.tgz
added 97 packages, and audited 98 packages in 14s
found 0 vulnerabilities
```

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
3 requirements: 1 broken, 2 held, 0 error, in 3.29 s (search budget 24 trials per requirement; held means no counterexample found within that budget, not a proof)
[exit 2]

$ npx --no-install golem-spec gate
1.2: WHEN the cart is pushed with up to 30 N for 0.2 s THE robot SHALL keep the pole within 30 deg of upright for 3 s
  scenario: push.force = 14.5 N (seed 3909821944)
  margin: -0.421 deg
  reproduce: npx golem-spec replay 1.2

gate RED: 1 of 3 requirements is not held
[exit 2]

$ npx --no-install golem-spec replay 1.2
replay 1.2: seed 3909821944, push.force = 14.5 N
robustness -0.421 deg at t = 0.84 s (the worst moment)
signals: minimum, maximum, and value at the worst moment
  pole_angle: min -0.531 rad, max 0.288 rad, at worst -0.531 rad
  cart_x: min -1.88 m, max 0.242 m, at worst 0.198 m
trace: .golem/replays/1.2.csv (161 samples)
studio: this app has no studio page (set studioUrl in golem.config.json to link one)
[exit 0]
```

`test` and `gate` exit 2 when a line breaks: that is the result, not a crash.

## Make it green

The starter's README gives this fix: a 60 N motor (`ctrlrange` in `robot/scene.xml` and `FORCE_LIMIT` in `app.js`) and doubled gains. The edit, as a diff of `app.js` against the starter, and the motor range afterwards:

```
-const KX = 1.25;
-const KTH = 29.4;
-const KXD = 2.2;
-const KTHD = 5.8;
-const FORCE_LIMIT = 15; // N, the same limit as ctrlrange in scene.xml
+const KX = 2.5;
+const KTH = 58.8;
+const KXD = 4.4;
+const KTHD = 11.6;
+const FORCE_LIMIT = 60; // N, the same limit as ctrlrange in scene.xml
ctrlrange="-60 60"
```

```
$ npx --no-install golem-spec gate
no counterexample in 106 trials (3 requirements, pinned seeds first, then the quick budget)
confirmed: 3 Expected_Hold lines searched again with a second search seed derived from the first (search seed 1, then confirmation seed 588244584; 24 trials per line; 53 confirmation trials, 106 in total)
[exit 0]
```

The pinned 14.5 N counterexample from the red run re-runs first and now holds. Before printing green, the gate searches each line again with a second search seed derived from the first.

## Notes

- `golem gate` is red on purpose at first. 1.2 breaks today: the motor gives 15 N. The starter has no Expectation table, so 1.2 counts as Expected_Hold.
- Line 1.2 breaks at a push of 14.5 N because the starter's motor gives at most 15 N. The pole's worst angle is -0.531 rad (-30.4 deg) against the 30 deg limit.
- A stronger motor alone does not fix it: with a 60 N motor and the old gains, 1.2 still breaks at about 19 N, because the controller never asks for the extra force.
