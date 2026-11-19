# Hover: a Skydio X2 that holds a point in the wind

App 3 of GOLEM. A Skydio X2 quadrotor from MuJoCo Menagerie holds a hover point 1.0 m above the floor while wind gusts, a sagging battery and a lagging position estimate act on it. GOLEM tests it against the EARS lines in `.kiro/specs/hover-hold/requirements.md`. It is the smallest of the three apps (one rigid body, four thrust motors) and exists to show that the skeleton does not care what the robot is: the app is a lexicon, a controller and a model file.

The X2 model needed no changes. Its four `motor` actuators already act along the body z axis at each rotor site, with a yaw reaction torque in the gear, which is what a mixer needs. Only `scene.xml` is ours (finer timestep, floor, hover marker).

## Measured result

Measured with the real CLI (`npx --no-install golem-spec test --budget 64`), with six search seeds (1 to 6) and one run at budget 256. The raw output of three runs (seeds 2, 3 and 1), plus check, alsify and gate, is in `docs/cli-transcript.md`. A margin is the distance from failure in the line's own unit: positive means the line held. A held line means no counterexample was found within 64 trials, not a proof.

| Line | Expectation | Verdict at budget 64 | Measured margin (search seeds 1 to 6) | What the line says |
|---|---|---|---|---|
| 1.1 | Expected_Hold | held | +0.097 to +0.112 m | a gust of up to 2 N: stays within 0.25 m of the hover point, so the worst excursion is 0.14 to 0.15 m |
| 1.2 | Expected_Hold | held | +10.7 to +11.9 deg | a gust of up to 3 N: tilt stays below 30 deg, so the worst tilt is 18 to 19 deg |
| 1.3 | Expected_Break | broken | -0.003 to -0.027 m at the shrunk scenario | a gust of up to 20 N: breaks from about 10 N (9.97 N to 10.2 N after shrinking, at several directions); at 20 N the drone ends 2.7 m outside the 1.0 m ball |
| 2.1 | Expected_Hold | held | +0.217 to +0.243 m | battery down to 60%: stays above 0.5 m, so the lowest altitude is 0.72 to 0.74 m (see the note below) |
| 3.1 | Expected_Hold | held | +0.134 to +0.159 m | gust up to 2 N with an estimate lag up to 0.10 s: stays within 0.35 m |
| 3.2 | Expected_Break | broken | -0.001 to -0.067 m at the shrunk scenario | estimate lag up to 0.30 s: breaks from a lag of 0.266 s to 0.285 s, with a gust of 0 N to 0.16 N |

Note on 2.1: the margin is measured against 0.5 m, so +0.22 m means the lowest altitude seen was about 0.72 m. At a 60% battery the drone dips about 0.28 m and recovers to the hover point (the integral term raises the commanded thrust).

The verdicts were the same at every search seed and at budget 256. What changes with the seed is the closest margin of a held line (about 0.015 m for 1.1 and 3.1) and the exact counterexample of a broken line.

## Why the two broken lines break

- **1.3, a strong gust.** The position loop never asks for more than 35 deg of tilt, because a drone that leans further loses the vertical thrust that holds it up. At 35 deg it can decelerate at about 6.9 m/s2. A 10 N gust for 0.5 s gives the 1.3 kg body 3.8 m/s, and the drone leaves the 1.0 m ball before it stops. The line is Expected_Break: the controller is plainly not built for a gust of 75% of its weight.
- **3.2, a late position estimate.** The position loop works on a delayed position and velocity. At a lag of about 0.27 s to 0.28 s the loop gains too much phase lag and the hover point turns into a growing oscillation. The counterexample needs almost no gust (0 N to 0.16 N), so the oscillation grows from the small error that is left after the warm-up. Line 3.1 (0.10 s) holds with margin, so the boundary sits between 0.10 s and 0.27 s. In a scratch run with these gains (not a requirement line), a lag of 0.15 s let a 2 N gust move the drone 0.91 m.

## Controller

`controller/` is a cascaded PD controller, written plainly (gains in `controller/law.ts`):

1. Position: `a = kp * error - kd * velocity + ki * integral` per axis, on the estimate (which may lag). The integral term is limited to 12 m/s2 and its state is clamped with it.
2. Force: `m * (a + g)`, with the horizontal part cut back so the force leans at most 35 deg.
3. Attitude: the body torques come from the angle between the body up axis and the force direction, and from the body rates (PD, scaled by the inertia).
4. Mixer: `controller/mixer.ts` inverts thrust, roll, pitch and yaw to four motor thrusts, from the site positions and gears in the model, limited to 0 to 13 N.

## Layout

- `robot/`: the Skydio X2 files, our `scene.xml`, the upstream `LICENSE`, and `SOURCE.json` (commit, every file, SHA-256 of each)
- `controller/`: `law.ts` (position, force, attitude), `mixer.ts`, `delay.ts` (estimate lag), `index.ts` (`HoverController`)
- `constants.ts`, `signals.ts`, `predicates.ts`, `perturbations.ts`, `lexicon.ts`: what requirement lines can say
- `app.ts`: the `RobotApp` definition
- `scripts/fetch-assets.mjs`: downloads the four model files at the pinned commit and writes `scene.xml`
- `test/`: Vitest and fast-check tests
- `.kiro/specs/hover-hold/requirements.md`: the app's own requirements, with the Expectation table
- `web/`: the studio page (`index.html`, `main.ts`, `worker.ts`, `vite.config.ts`)
- `docs/cli-transcript.md`: real CLI output

## What a line can say

| Phrase | Kind |
|---|---|
| `a gust of up to <force> hits it for <duration> from <direction>` | perturbation: a horizontal force on the body. The direction is the side the gust comes from, counterclockwise from +x, the same convention as the G1's push direction |
| `the battery sags to <ratio>` | perturbation: every motor's thrust and largest thrust scale by the ratio |
| `the position estimate lags by up to <duration>` | perturbation: the controller sees its position and velocity from that long ago |
| `a gust ... while the position estimate lags by up to <duration>` | both at once (the lag only matters when something moves the drone) |
| `stay within <length> of its hover point` | predicate, in m |
| `keep its tilt below <angle>` | predicate, in deg |
| `stay above <length>` | predicate, in m |

The templates read `a gust of {range:force}` and `lags by {range:duration}`; the word "up to" in a line is part of the range, so it is written in the requirement and not in the template.

## Studio

The studio page is served with the `dev` script of this package (http://localhost:5189/) and built with the `build` script. On the site it lives at `/hover/`. Summon ghosts on a requirement to see the gusts: ghosts that leave the allowed ball turn cinnabar.

## Regenerating the robot folder

```
npm run assets
```

This downloads `x2.xml`, the OBJ mesh, its texture and the `LICENSE` of `skydio_x2` from MuJoCo Menagerie at the pinned commit `370c43965323c0944b433b202aac5058b5f907a9`, checks each file against the SHA-256 recorded in the script, and writes `scene.xml`. When every file is already current it prints `Assets are current.` and makes no request. `npm run assets -- --check` reports the state without network access.

## Licences

- App code: Apache-2.0 (`LICENSE`).
- Skydio X2 model and assets: Apache-2.0, Skydio and Google DeepMind (MuJoCo Menagerie). The notice is kept unchanged in `robot/LICENSE`.
