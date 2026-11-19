# Implementation Plan: golem-sim-hardening

Rules for every task:
- Write the regression test first, run it on the unfixed code and record the failure, then fix. Use the contact-rich models, not only the pendulum.
- Never weaken an assertion to make a test pass. Where an old test encoded a defect, replace it and say why in the commit message.
- Physics tests simulate at most 2 s per trial; physics properties run 25 cases with the fixed logged seed.
- Commit after each task as `golem-sim-hardening: <n> <what>`, staging only `skeleton/`, `docs/reviews/` and `.kiro/`.

## Tasks

- [ ] 1. Contact-rich test models and probe paths
  - Add `skeleton/src/sim/test-models.ts` with `boxDropApp`, `stoolApp` and a requirement helper; add example tests that the models load, make contacts and (for the stool) stand only under PD control.
  - Point the probe scripts at this checkout (relative imports), so they test the code they sit next to.
  - _Bugfix: test strategy_

- [ ] 2. Disable auto-reset during trials (defect 1)
  - Test: a 1e30 N kick on `boxDropApp` gives a `diverged` event and a broken verdict; `data.time` never decreases; `disableflags` is restored.
  - _Bugfix: 1.2–1.5_

- [ ] 3. Bounded divergence check and numerical diagnostics (defect 2, improvement 1)
  - Check `qpos`, `qvel`, `qacc` against mjMAXVAL after every step; divergence event with cause, index, value, warnings, solver iterations and contacts; end-of-trial BAD* warning check; `TrialResult.diagnostics`.
  - Test: with auto-reset already off (the app sets it), a finite 1.6e27 blow-up is reported as `diverged` with `cause` and `BADQACC > 0`; healthy stool trials report contacts and solver iterations.
  - Rewrite hollow P11 to use a real blow-up through the runner.
  - _Bugfix: 2.3–2.7, 1.I1–1.I2_

- [ ] 4. `mj_forward` after `initState` (defect 4)
  - Test: with warm-up 0, sample 0 and the first controller step see the `initState` pose and a non-zero site sensor.
  - _Bugfix: 4.2–4.3_

- [ ] 5. `Controller.substep` and the saturation meter (defect 3, improvement 4)
  - Test: substep call count and `tSim` values; the stool stands with a 500 Hz PD in `substep`; `createSaturationMeter` property and an example.
  - _Bugfix: 3.2–3.5, 4.I1–4.I2_

- [ ] 6. `PerturbationTemplate.begin` (defect 7)
  - Test: `begin` is called once per call at `data.time === warmup` before sample 0 and the first `apply`, in array order; a mass doubling in `begin` does not compound.
  - _Bugfix: 7.2–7.3_

- [ ] 7. Full model snapshot and restore (defect 6, improvement 5)
  - Add `model-snapshot.ts`, snapshot in `ModelCache.compile`, restore in the runner, export `changedModelFields`.
  - Test: `body_pos`, `actuator_ctrlrange`, `jnt_stiffness`, `geom_solref`, `dof_armature`, `eq_data` and `opt.o_margin` are restored. Rewrite hollow P14 to mutate random fields from the full array list.
  - _Bugfix: 6.2–6.5, 5.I1_

- [ ] 8. Pose frames on the sim-step schedule (defect 5)
  - Test: a 1.8 s horizon at controlDt 0.02 s gives 55 frames (the old recorder gave 46), each the state at step `ceil(f/(30·simDt))`. Rewrite P12, which asserted the 25 fps bug.
  - _Bugfix: 5.2–5.4_

- [ ] 9. Warm-up divergence is a counterexample (defect 8)
  - Test: a warm-up blow-up on `boxDropApp` returns a broken result with a `phase: 'warmup'` event. Replace the error-catalogue entry that asserted the throw.
  - _Bugfix: 8.2–8.3_

- [ ] 10. Keep the early-stop hook's decided value (defect 9)
  - Test: a hook returning 123 gives robustness 123 and the monitor's worstAt and unit.
  - _Bugfix: 9.2–9.3_

- [ ] 11. JSON-safe robustness (defect 10)
  - `DIVERGED_ROBUSTNESS`, clamp of monitor infinities, rejection of NaN robustness and non-finite worstAt.
  - Test: JSON round trip of diverged and infinite-monitor results; NaN rejected.
  - _Bugfix: 10.2–10.5_

- [ ] 12. Trajectory hash (improvement 3)
  - Test: the hash equals a reference computed from qpos logged in `substep`; it is stable across repeats and pose recording, and changes with the seed.
  - _Bugfix: 3.I1–3.I2_

- [ ] 13. Timestep and integrator re-check (improvement 2)
  - `RunOptions.numerics` and `recheckTrial`.
  - Test: the half-step variant runs twice the sim steps; the integrator is restored; a real stool failure survives; a timestep-only artefact is flagged as numerical.
  - _Bugfix: 2.I1–2.I3_

- [ ] 14. Low-severity defects (defect 11)
  - Horizon rounded up and reported; `warmupSimSteps` removed; signals reset to NaN; robot files unlinked after compile; typed `MjModel`/`MjData` in internals; BOMs removed.
  - Tests for each.
  - _Bugfix: 11.7–11.13_

- [ ] 15. Final checkpoint
  - Full sim suite, typecheck, probe scripts; before/after table per defect in `docs/reviews/sim-hardening.md`.
