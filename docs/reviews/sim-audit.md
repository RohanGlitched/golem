# golem-sim audit (independent review, Nov 19 2026)

**Verdict: FIX.** The runner core is sound: deterministic, leak-free (400 trials, heap flat), clean errors and browser-clean. But three gaps would silently give wrong verdicts or block the G1 app. They sit in about 60 lines of `episode.ts`.

## Measured
| Check | Result |
|---|---|
| Determinism | Bit-identical traces |
| Overhead vs a raw MuJoCo loop | About 25% on a tiny model; much less for G1 |
| Leaks, 400 trials | Handles at 1, heap flat |
| 1e30 N kick through runTrial | **robustness +0.48, "held", no `diverged` event.** The robot was silently auto-reset |
| Raw MuJoCo with auto-reset off | qpos reaches 1e27 but stays finite. Only the BADQACC warning counter shows it |
| Poses | The file says 30 fps, but frames are actually 25 fps |
| Model restore | actuator_ctrlrange, jnt_stiffness and body_pos stay changed for the next trial |

## Defects, ranked
1. **CRITICAL: auto-reset is never disabled** (episode.ts:190-195).
   - Fix: set `model.opt.disableflags |= mjDSBL_AUTORESET` (65536 in 4.0.1) during trials.
2. **CRITICAL: divergence means only "qpos is NaN".**
   - Fix: every sim step, check that qpos and qvel are finite and |x| < 1e10. Every control step, read the `data.warning` counters (BADQPOS, BADQVEL, BADQACC) and record which one fired.
3. **BLOCKER for G1: there is no per-sim-step controller hook.** Unitree's loop computes PD torque at 500 Hz and runs the policy at 50 Hz.
   - Fix: an optional `Controller.substep?(ctx, tSim)`, called before every mj_step during warm-up and during the trial.
4. **No mj_forward after initState.** The first controller step sees stale xpos and zero sensordata.
5. **Pose recording claims 30 fps but delivers 25.** Frames land only on control-step boundaries.
   - Fix: record on sim-step boundaries, or report the true rate.
6. **The model guard is an allow-list,** so body_pos, ctrlrange, stiffness, solref, armature and eq_data leak between trials.
   - Fix: snapshot every writable model array at compile time, and restore the ones that changed.
7. **Templates run every sim step with no "once at trigger" hook,** so compounding edits are a trap.
   - Fix: an optional `begin(ctx, values)` on templates.
8. **Divergence during warm-up throws** instead of producing a counterexample.
9. **The early-stop hook's returned number is ignored.**
10. **-Infinity robustness serialises as null.**
11. **Low:**
    - The horizon is rounded silently.
    - Unused `warmupSimSteps`.
    - A stale signal value persists when the app stops writing it (reset it to NaN).
    - Meshes stay in the in-memory FS, doubling memory per worker (unlink them).
    - 20 `any` types where typed MjModel/MjData exist.
    - BOMs in 26 files.

## Test gaps
- P11 (divergence) is hollow: the fixture disables auto-reset and writes NaN itself.
- P12 asserts the 25 fps bug.
- P14 checks the same field list it guards.
- All physics properties run on a 1-DOF pendulum with no contacts.
- Missing: a real blow-up must give `diverged`; the substep count is right; body_pos is restored; the reported fps matches the frame spacing.

## Improvements for expert robotics judges
1. Separate numerical failure from physical failure (auto-reset off; warning counters, solver iterations and contact counts recorded).
2. A timestep check on each shrunk counterexample: re-run at simDt/2 and with another integrator, and report whether it still fails.
3. A cross-runtime determinism certificate: a hash of the qpos trajectory, the same in Node, Chrome and Firefox.
4. A first-class 500 Hz PD hook that logs torque saturation as a signal.
5. Full-model snapshot and restore, so domain randomisation is provably isolated.
6. G1 benchmarks in evidence/: steps/s, overhead and real-time factor.

Probe scripts: docs/reviews/sim-probe1..4.mts.
