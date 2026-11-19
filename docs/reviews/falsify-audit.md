# golem-falsify / pool audit (independent review, Nov 19 2026)

**Verdict: KEEP; fix defects 1 and 2 before the demo.** The numerics are exact (Clopper-Pearson matches exact binomial inversion to 6.7e-12), budgets and abort work, the pools are deterministic and leak-free, and guided search clearly beats random on graded needles.

## Probe results (synthetic functions, 30 search seeds)
| Region (volume) | Budget | Random-only: found, median trials | GOLEM (LHS + CEM): found, median |
|---|---|---|---|
| angle 130–140°, force > 180 N, graded (0.78%) | 200 | 26/30, 80.5 | 30/30, 79 |
| angle 130–135°, force > 230 N, graded (0.11%) | 400 | **9/30, not found** | **30/30, 211** |
| same, graded | 1000 | 21/30, 717 | 30/30, 435 |
| same, **flat robustness** | 1000 | 21/30, 717 | **9/30, not found** (defect 2) |
| 0.78% plus 4 extra dims | 1000 | 27/30, 388 | 30/30, 392 |

Other results:
- Phase-1 fraction 0.2 instead of 0.4 gives a median of 127, against 211.
- Wrap-around region [355°, 5°]: full search finds it 30/30, random-only 19/30.
- Shrinking: 30 of 30 runs land inside the tolerance of the true boundary, and the result is never more severe.
- Node pool with real MuJoCo: 1 → 8 workers gives ×3.2 trials/s, about 30–44 MB per worker, no leak.

## Defects, ranked
1. **Classification at the shrunk point mislabels robust failures as seed-sensitive.** The shrunk point sits on the boundary, where the margin is about 0. A failure with a margin of −0.4 got the label "seed-sensitive" 23 times in 30.
   - Fix: verify the 3 seeds at the original unshrunk failure, and report the shrunk point's sensitivity separately (`boundarySensitive`).
2. **CEM collapses on flat robustness.** Tied elites are picked by index, so σ shrinks onto an arbitrary cluster and the search does worse than random.
   - Fix: when there is no information, keep or widen the distribution. Always draw about 20% of each generation from LHS. Keep elites across generations. Default generation size 32.
3. **A property test is commented out by accident** (beta.property.test.ts:33: literal `\n` inside a comment).
4. **Wall-time overrun on small pools.** The budget doesn't account for time left × pool size.
5. **A timed run can't be replayed:** emit `meta.replayOptions`. Fraction flooring also wastes a trial.
6. **Windows rmSync race in the Node test cleanup.** Use maxRetries.
7. **The shrinker is single-pass and assumes monotonicity.** Add a coarse 8-point sweep before bisecting, and a second pass.
8. **The Node pool size defaults to cores − 1.** Use physical cores, or benchmark at startup.
9. **The design doc has drifted** on the numerical methods.
10. **UI API gaps:**
    - the progress event lacks per-trial seeds, the CEM μ/σ per dimension, `elapsedMs` and the time fraction;
    - `onResult` lacks phase and generation;
    - add `replayCounterexample(pool, cx, { record: 'poses' })`.

## Test gap
No test checks search *effectiveness*. Add a CI property: on the needle benchmark, CEM's success rate is at least random's.

## Publish
- A search-efficiency benchmark with CIs (the 0.11% needle as the headline).
- A calibration confusion matrix for the robust vs seed-sensitive label.
- Exact Clopper-Pearson next to the rule of three.
- A pool scaling chart.
