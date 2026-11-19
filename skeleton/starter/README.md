# Cart-pole starter (GOLEM)

- `app.js` is the robot: a MuJoCo cart-pole, the phrases a requirement may use, and the balance controller. Plain Node ES module, no build step.
- `robot/scene.xml` is the MuJoCo model: a 1 kg cart on a 4 m rail carrying a 0.1 kg pole, driven by a motor limited to 15 N.
- `.kiro/specs/cartpole/requirements.md` holds three EARS lines. `golem.config.json` points at it and at `app.js`.
- `.golem/` appears after a run: pinned counterexamples (`seeds/`), `report.json`, replay traces.
- Run these four, in order (each needs only `golem-spec` installed):

```
npx --no-install golem-spec check              # compiles the 3 lines, exits 0
npx --no-install golem-spec test --budget 24   # real MuJoCo trials; line 1.2 breaks
npx --no-install golem-spec gate               # exits 2 and names 1.2 (red on purpose, see below)
npx --no-install golem-spec replay 1.2         # re-runs the shrunk counterexample, writes .golem/replays/1.2.csv
```

## What to expect

Measured with `test --budget 24` over six search seeds (1, 2, 3, 7, 99, 12345):

| Line | Says | Verdict | Closest margin |
|---|---|---|---|
| 1.1 | push up to 8 N for 0.2 s, pole stays within 30 deg of upright for 3 s | held | +17.1 to +17.9 deg |
| 1.2 | push up to 30 N for 0.2 s, same response | broken | shrunk to a push of 14.5 to 15.1 N; the margin there is -0.13 to -0.93 deg at the edge, or about -300 deg once the pole tumbles |
| 2.1 | the cart stays within 0.3 m of the centre | held | +0.19 to +0.26 m |

1.2 breaks today: the motor gives 15 N. `golem gate` stays red until you change app.js and the motor (a stronger motor and gains that use it), or a person marks 1.2 Expected_Break in an Expectation table. The starter has no Expectation table, so the gate is red on purpose.
A push of about 15 N for 0.2 s cannot be resisted and the pole falls; below that the controller catches it.
To make it hold, change the controller in `app.js` and the motor limit in `robot/scene.xml` (and `FORCE_LIMIT`), never the line. One fix that turns the gate green (checked with search seeds 1 to 5): raise the motor to 60 N (`ctrlrange="-60 60"` in `robot/scene.xml` and `FORCE_LIMIT = 60` in `app.js`) and double the four gains (`KX = 2.5`, `KTH = 58.8`, `KXD = 4.4`, `KTHD = 11.6`). A stronger motor alone is not enough: with the old gains the controller never asks for the extra force, and 1.2 still breaks at about 19 N.
