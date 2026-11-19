# Design: golem-falsify-hardening

## Overview

All changes stay inside `skeleton/src/falsify` and `skeleton/src/pool`. No other module calls `falsify` yet (`cli` and `mcp` do not import it), so the only cross-module changes are the add-only fields below. The falsifier keeps its four phases. The fixes change how Phase 2 picks elites, how generations are sized under a time limit, where classification runs, and how the shrinker searches a dimension.

## Contract additions (add-only)

Recorded in `.kiro/steering/interfaces.md` under "Approved additions":

```ts
interface Verdict { /* … */ failureRateUpper95Exact?: number }      // exact Clopper-Pearson, set with failureRateUpper95
// .golem/seeds/<app>/<reqId>.json entries may carry, beside the Counterexample fields:
//   classification?: 'robust' | 'seed-sensitive'   (at the original failure)
//   boundarySensitive?: boolean                    (at the shrunk point)
//   verificationSeeds?, verificationRobustness?
```

Falsify-level additions (in `types.ts`, not contract shapes):

```ts
interface FalsifyOptions {
  /* … */
  maxPinned?: number;                                    // cap on Phase 0 trials (D5)
  cem?: { generationSize?; eliteFraction?; smoothing?; lhsFraction?: number };   // D2
  onResult?: (r: TrialResult, info: ResultInfo) => void; // D10
}
interface ResultInfo { phase: 0 | 1 | 2 | 3; generation: number; index: number }
interface ProgressEvent { /* … */ seeds: readonly number[]; elapsedMs: number; timeFraction: number | null;
  cem?: readonly { name: string; kind: 'normal' | 'wrapped' | 'uniform' | 'uniformCircle' | 'fixed'; mu: number | null; sigma: number | null }[] }
interface RunMetadata { /* … */ boundarySensitive?: boolean;
  verification?: { scenario; seeds; robustness; errors };
  boundaryVerification?: { scenario; seeds; robustness; errors };
  replayOptions: ReplayOptions }
type ReplayOptions = Required<Pick<FalsifyOptions, 'appId' | 'budget' | 'searchSeed' | 'mode' | 'phase1Fraction' | 'phase2Fraction' | 'phase1GenerationSize' | 'maxPinned'>> & { cem; shrink }
function replayCounterexample(pool: TrialPool, cx: Counterexample, o?: { appId?: string; record?: 'none' | 'poses'; signal?: AbortSignal }): Promise<TrialResult & { reproduced: boolean }>
```

Pool addition: `physicalCoreCount(): number | undefined` from `golem-spec/node`.

## D1: where classification runs

Phase 3 after the fix:

```
pick = lowest-robustness failing search trial
outcome = shrink(pick)
V  = 3 trials at pick.scenario, seeds verificationSeeds(searchSeed, pick.seed)  -> classification
if outcome.scenario differs from pick.scenario:
   B = 3 trials at outcome.scenario, same seeds  -> boundarySensitive = any >= 0 (unset on error)
else boundarySensitive = classification === 'seed-sensitive'
```

`V` and `B` go to the pool as one batch of 6 specs when both are needed, so the pool keeps its parallelism. The label answers "does this failure need a lucky seed?" at the place the search found it. `boundarySensitive` answers the separate question the UI shows next to the shrunk scenario: at the mildest failing point the margin is about 0, so a re-run with another seed may pass.

## D2: elites, no-information fallback, elitism, LHS mix

`cem.ts` gains:

```ts
type DimDist = … | { kind: 'uniform' }                    // interval dimensions
function eliteSet(obs: Observed[], slots: number): { elites: Observed[]; informative: boolean }
```

- Sort by (robustness, index), which is `selectElites`' total order. `γ` = robustness of the `slots`-th item. `elites` = every item with robustness `<= γ`.
- `informative = false` when every usable observation has the same robustness. Then the fit returns `uniform` / `uniformCircle` for every non-fixed dimension, and the next generation is drawn wholly by LHS.
- `index` is the run order: Phase 1 trial index `i`, Phase 2 trial `n1 + j`, so elites carried across generations keep a total order.

Fit per generation `g`:

```
pool_g = carried ∪ observations of generation g     (carried = the top `slots` of pool_{g-1} by total order)
slots  = ceil(rho · G)
if |pool_g| < 2: keep state
{ elites, informative } = eliteSet(pool_g, slots)
state' = !informative ? uniform : elites.length >= 2 ? smooth(fit(elites), state) : state
carried = first `slots` of pool_g in total order
```

Initial state: `eliteSet(phase1, rho)`. Uninformative or fewer than 2 elites gives uniform, and `carried` starts as the top `slots` of Phase 1.

Sampling a generation of nominal size `G` (D5 prefix rule):

```
m = state is uniform on every dimension ? G : round(lhsFraction · G)
cemDraws = sampleCem(space, state, G - m, searchSeed, g)          // stream SALT.cem (5), unchanged
lhsDraws = latinHypercube(space, m, deriveSeed(searchSeed, SALT.cemLhs = 6, 0), g)
position i is LHS iff floor((i+1)·m/G) > floor(i·m/G)               // interleaved
take the first n (the grant)
```

The uniform kind draws `min + u·width` (one uniform, the same stream position as the other kinds). The interleave keeps the LHS share when a generation is cut short.

Why this works on the flat needle: until a trial fails, every observation is tied, so the distribution stays uniform and Phase 2 is Latin-hypercube sampling, the same distribution as random-only. On the graded needle the elites are strictly ordered and nothing changes except elitism, which keeps the best points if a generation lands badly.

## D4 and D5: time-aware grants, generation prefix, replay options

`BudgetClock` keeps quotas and deadlines and gains:

```ts
observe(n: number, ms: number, poolSize: number): void     // waveMs = 0.5·waveMs + 0.5·ms/ceil(n/poolSize); first sample sets it
waveMs(): number | null
grant(phase, wanted, poolSize = 1): { n: number; timeLimited: boolean }
grantShrink(): 0 | 1                                        // also checks elapsed + waveMs <= shrink deadline
```

Grant, with `W` set and an estimate present: `fit = floor((deadline(phase) - elapsed) / waveMs) · poolSize`; `n = min(wanted, quota left, fit)`; `timeLimited = fit < min(wanted, quota left)`. Without `W`, the clock is never read.

Falsifier generation loop (Phases 1 and 2):

```
{ n, timeLimited } = grant(phase, G, pool.size); if n == 0 break
scen = generationPrefix(G)[0:n]
if W set and no estimate and n > pool.size:
    run scen[0:pool.size]; observe
    { n2, tl2 } = grant(phase, n - pool.size, pool.size)      // the first wave already counted
    run scen[pool.size : pool.size + n2]; timeLimited ||= tl2 || n2 < n - pool.size
else run scen; observe
emit one progress event for the generation
if failed or error or timeLimited: break
```

Quotas use `floor(x + 1e-9)` and a cumulative Phase 1+2 cap (bugfix 5.4).

`meta.replayOptions`:

```
budget: { maxTrials: p0 + p1 + p2 }       // no maxWallMs
phase1Fraction: p1 / T, phase2Fraction: p2 / T   (T = p0 + p1 + p2; both 0 when T = 0 is impossible: T >= 1 when a trial ran)
maxPinned: p0
shrink: { tolerance, maxTrials: max(1, k), reserveFraction: 0, reserveMin: k }   (k = shrink trials run)
plus searchSeed, mode, appId, phase1GenerationSize, cem
```

The replay reproduces the run because every generation except the last of a phase is full size in both runs, and the last one is a prefix of the same full-size draw. `floor(p1/T · T + 1e-9) = p1` for every `T < 2^31`.

## D7: shrinker

```
pass(dims):
  for d in dims (space order), severity dimensions only:
    hi = s(current[d]); if hi == 0 continue
    if attempt(s = 0) fails: accept; continue
    lo = 0
    for k = 1..7: s = k·hi/8; if attempt(s) fails: hi = s; break; else lo = s
    bisect (lo, hi) to tolerance·width
    lastShrunk[d] = counter; if current[d] changed: changedAt[d] = ++counter
pass(all)
pass({ d : some other dimension e has changedAt[e] > lastShrunk[d] })
```

A single severity dimension gets no second pass. A half-space costs `1 + k + log2((hi/8) / (tol·width))` trials, about 12 for `hi = width` against 8 before. `maxTrials` (60) and the shrink reserve still cap the total.

## D8: physical cores

`physicalCoreCount()` in `pool/cores.ts` (Node only). Linux reads `/proc/cpuinfo`; macOS runs `sysctl -n hw.physicalcpu`; Windows runs `powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Measure-Object NumberOfCores -Sum).Sum"` with a 5 s timeout. The result is cached, so the cost (about 0.5 s on Windows) is paid once, only when no `size` is given. The parsers are exported for tests.

## D10: UI API

- Seeds: the falsifier already has the specs; the event copies `spec.seed` in the same order as `scenarios`.
- `cem`: the state used for `sampleCem` of that generation, mapped to `{ name, kind, mu, sigma }`.
- `elapsedMs` from the budget clock (the injected clock in tests); `timeFraction = elapsedMs / maxWallMs` or null.
- `ResultInfo`: the falsifier wraps `onResult` per batch with the phase, generation and the index of the spec in the batch (matched by spec identity).
- `replayCounterexample` lives in `falsify/replay.ts` and only needs a `TrialPool`.

## Item A and E: benchmark

`falsify/search.benchmark.property.test.ts` uses fast-check to draw the base of the search-seed set with a fixed logged fast-check seed, 2 cases, 100 search seeds per case. It is a statistical property, so a fixed seed keeps CI deterministic; the bound (8% of runs) is about two standard deviations of the paired difference measured on the flat needle.

`docs/reviews/falsify-bench.mts` runs the cases of bugfix E.1 with 100 search seeds each and prints found / runs with a 95% Clopper-Pearson interval and the median `foundAfter`.

## Item B: calibration

`falsify/classify.calibration.test.ts` runs `falsify` on `(θ - force)/250 + σ·N(0,1)` for σ in {0.01, 0.02, 0.05, 0.1} and θ in {150, 200, 240} N, 25 search seeds each, reads `meta.verification.scenario`, computes `p = Φ(-base/σ)` and builds the confusion matrix of bugfix B.1. The rule "all three seeds fail" labels a point with failure probability `p` as robust with probability `p³`, so the expected rates are at least 0.97 (p ≥ 0.99) and at least 0.875 (p ≤ 0.5).

## Testing

Every defect gets a regression test that fails on the unfixed code; the failing output is recorded in the task's commit message. Old tests that encode a superseded behaviour are rewritten, and the commit says why. Properties use fast-check; physics is not involved (all falsify tests use synthetic trial functions).
