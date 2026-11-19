# golem-sim hardening: results

Spec: `.kiro/specs/golem-sim-hardening/` (bugfix.md, design.md, tasks.md). Audit: `sim-audit.md`. Branch `fix/sim`, commits `golem-sim-hardening: 0` to `15`.

Every defect has a regression test that failed on the code before its fix (checked by running the new test against the previous commit's `episode.ts`, or before the edit). Tests use the contact-rich models in `skeleton/src/sim/test-models.ts`: `boxDropApp` (three boxes on a plane), `stoolApp` (torso on four splayed hinged legs, 50 Hz policy, 500 Hz PD in `substep`) and `jitterApp` (a velocity servo that is unstable under explicit Euler at 0.01 s).

## Before and after, per defect

| # | Defect | Before (measured) | After (measured) | Regression test |
|---|---|---|---|---|
| 1 | Auto-reset never disabled | Probe 3.6: 1e30 N kick gives robustness +0.48, no `diverged` event, `data.time` runs backwards (0.2 s → 0.002 s) | `mjDSBL_AUTORESET` set during every trial, flags restored; probe 3.6: `diverged` at 0.202 s, time monotonic | `episode.hardening.test.ts` › defect 1 |
| 2 | Divergence = "qpos is NaN" | Probe 1: with auto-reset off qpos reaches 1.6e27, finite, so no event | qpos, qvel, qacc checked against 1e10 after every step; event has `cause: 'qpos'`, index 4, value 4e24, `BADQACC: 1`, solver iterations, contacts; a BAD* counter alone also counts | › defect 2 (3 tests), Property 11 |
| 3 | No per-sim-step controller hook | `substep` never called; the stool collapses (robustness < 0) | `substep(ctx, tSim)` before every `mj_step`: 100 + 250 calls with exact `tSim`; stool stands with margin > 0.02 m | › defect 3 (4 tests) |
| 4 | No `mj_forward` after `initState` | Probe 4: sample 0 z = 0 m (qpos z = 0.9), sensor [0,0,0] | Probe 4: z = 0.9 m, sensor [0,0,1] | › defect 4 |
| 5 | Poses claim 30 fps, deliver 25 | Probe 3.3: 51 frames over 2 s (25.00 fps) | Probe 3.3: 61 frames over 2 s (30.00 fps); frame f within one simDt of f/30 s | › defect 5, Property 12 (rewritten) |
| 6 | Model guard is an allow-list | Probe 3.5: ctrlrange 50 → 1, stiffness 0 → 7, body_pos 1 → 3 leak into the next trial | Whole `model.buffer` + every `opt` field restored; probe 3.5 before = after; `changedModelFields()` names any diff | › defect 6 (3 tests), Property 14 (rewritten; fails on the old runner with an `actuator_acc0` edit) |
| 7 | No "once at trigger" hook | `begin` never called; edits in `apply` compound every step | `begin(ctx, values)` once per call, in order, at t = warmup, before sample 0 | › defect 7 |
| 8 | Warm-up divergence throws | `Simulation diverged during warm-up at t = …` error | Broken result, `phase: 'warmup'`, empty trace, no trigger | › defect 8 (2 tests), error catalogue Req 7.11 (amended) |
| 9 | Early-stop value ignored | Probe 3.4: hook says 123, result −2.27 | Probe 3.4: 123 | › defect 9 (2 tests) |
| 10 | −Infinity → `null` in JSON | Diverged robustness −Infinity, `JSON.stringify` gives `null` | `DIVERGED_ROBUSTNESS` = −1.7976931348623157e308 round-trips; monitor ±Infinity clamped; NaN robustness / non-finite worstAt rejected | › defect 10 (4 tests), Property 11 |
| 11a | Horizon rounded silently | 0.205 s at 0.02 s ran 10 steps (0.20 s) | 11 steps (0.22 s), reported in `diagnostics.horizon` | › defect 11 |
| 11b | Unused `warmupSimSteps` | Present | Removed | › defect 11 |
| 11c | Stale signal persists | Later samples repeat the last written value | NaN | › defect 11 |
| 11d | Meshes stay in the in-memory FS | `/robot/scene.xml` exists after compile | Unlinked right after `from_xml_path` | › defect 11 |
| 11e | `any` where typed bindings exist | 20 code lines with `any` in sim internals at the audit commit (28 just before task 14, after the new code) | 0 outside the contract `SimContext` | › source hygiene |
| 11f | BOMs | 26 files in `skeleton/src/sim` | 0 | › source hygiene |

## Improvements

| # | Improvement | Result | Tests |
|---|---|---|---|
| 1 | Numerical vs physical failure | `TrialResult.diagnostics`: horizon, simSteps, timestep, integrator, warning counters, max solver iterations, saturated solver steps, max contacts, divergence record, `numerical` flag | › defect 2 |
| 2 | Timestep / integrator re-check | `RunOptions.numerics` and `recheckTrial()`; the limp stool's fall survives simDt/2 and implicitfast (`survives: true`); `jitterApp` fails at 0.01 s Euler but holds at 0.005 s and with implicitfast (`numericalSuspect: true`) | `recheck.test.ts` (6) |
| 3 | Trajectory hash | `TrialResult.hash`, 16 hex digits, matches an independent DataView reference; unchanged by pose recording; in Properties 1 and 13 | › improvement 3 (3) |
| 4 | Sim-rate PD hook + torque saturation | `Controller.substep`; `createSaturationMeter(model)`; stool logs `saturation` (< 1 at rest, ≥ 1 under an 800 N shove) | › defect 3, `saturation.property.test.ts` |
| 5 | Full snapshot/restore | Compile-time copy of `model.buffer` + `opt`, restored after every trial; `changedModelFields()` | › defect 6, Property 14 |

Contract additions recorded in `.kiro/steering/interfaces.md`: `Controller.substep?`, `PerturbationTemplate.begin?`, `TrialResult.hash`.

## Test totals

- `skeleton/src/sim`: 194 tests in 20 files before, 241 in 24 files after.
- Whole `skeleton` (`npx vitest run`): 83 files, 559 tests, all pass. `tsc --noEmit` is clean.

## Probe output after the fixes (`npx tsx ../docs/reviews/sim-probe<n>.mts` from `skeleton/`)

The probes now import this checkout by relative path. Probes 1 and 2 drive raw MuJoCo and do not use the runner, so their output is unchanged; probe 1's "warning read failed" is a bug in the probe (it indexes `w[i]` on the embind vector), not in sim.

```
=== sim-probe1.mts
mjDSBL_AUTORESET 65536
opt is same obj? false gravity view? true
gravity write via view sticks: -1
timestep write sticks: 0.004
autoreset enabled: anyNaN=false final z=0.2998922125569972 time=0.7820000000000006 warnings=["warning read failed TypeError: Cannot read properties of undefined (reading 'number')"]
autoreset DISABLED: anyNaN=false final z=1.582000000000008e+27 time=1.0000000000000007 warnings=["warning read failed TypeError: Cannot read properties of undefined (reading 'number')"]

=== sim-probe2.mts
warning vec size 7
warnings (autoreset on): {"0":0,"1":0,"2":0,"3":0,"4":0,"5":1,"6":0} z 0.2998922125569972

=== sim-probe3.mts
1 determinism robustness -2.1471401063707773 -2.1471401063707773 bit-identical true
  trace len 101 t0 0.2 tN 2.2 data.time at last sample 2.1999999999999793 data.time at t0 0.20000000000000015
2 runner: 56 k steps/s
  raw loop: 63 k steps/s; runner overhead 12%
3 poses fps=30 nbody=4 frames=61 over 2 s => actual fps 30.00
4 early stop: hook calls 10 trace len 10 robustness returned 123 (hook said 123)
5 before {"mass":0.2,"g":-9.81,"ctrlrange":50,"stiff":0,"bodypos":1} 
  after  {"mass":0.2,"g":-9.81,"ctrlrange":50,"stiff":0,"bodypos":1}
6 kick: robustness -1.7976931348623157e+308 events [{"name":"trigger","t":0.2},{"name":"diverged","t":0.202,"phase":"trial","cause":"qpos","index":4,"value":4e+24,"warnings":{"INERTIA":0,"CONTACTFULL":0,"CNSTRFULL":0,"BADQPOS":0,"BADQVEL":0,"BADQACC":1,"BADCTRL":0},"solverIterations":0,"contacts":0}] box z max 0.8057620000000003 data.time went backwards? false
7 200 trials: handles 1 -> 1 wasm heap 17629184 -> 17629184 rss MB 143 -> 144
  next 200: rss MB 144 -> 144 wasm heap 17629184
8 throw: Trial failed (app cp, requirement R1, seed 7): boom in signals | cause kept true | handles 1 -> 1

=== sim-probe4.mts
warmup=0: pelvis z at sample 0 = 0.9 (qpos z set to 0.9); sensordata at first controller step = {"firstCtrlSensor":[0,0,1]}
```

The same probes before the fixes gave, for the lines that changed: 3.2 overhead 29% (62 vs 79 k steps/s; both runs are single, noisy timings), 3.3 `frames=51 … actual fps 25.00`, 3.4 `robustness returned -2.2661104377133032 (hook said 123)`, 3.5 `after {"ctrlrange":1,"stiff":7,"bodypos":3}`, 3.6 `robustness 0.4767907443025297 events [{"name":"trigger","t":0.2}] box z max 1 data.time went backwards? true`, 4 `pelvis z at sample 0 = 0 … [0,0,0]`.

## Open items (not in this spec)

- `forEachContact` never deletes the `MjContact` copies that `vec.get(i)` returns. Measured: 100 000 reads of 4 contacts grew WASM memory from 17.6 MB to 273.5 MB; deleting each element keeps it flat. The fix changes the helper's contract (a visitor must not keep the contact), so it needs a decision.
- Audit improvement 6 (G1 benchmarks in `evidence/`) and updating `evidence/sim-cross-runtime.ts` to compare `TrialResult.hash` across Node and browsers are outside the staged paths of this branch.
