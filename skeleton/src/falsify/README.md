# falsify

`falsify(requirement, pool, options)` searches a requirement's scenario space for a trial whose
robustness is below zero. Robustness is the monitor's margin in physical units: `+0.12 m` means the
requirement held with 12 cm to spare, `-0.04 m` means it broke by 4 cm.

The module imports no Node module. It reads pinned seeds through an injected `FileSystem`
(`memoryFileSystem()` in tests, `nodeFileSystem()` from `golem-spec/node` in the CLI) and runs trials
through any `TrialPool`.

## Phases

| Phase | What runs | Budget |
|---|---|---|
| 0 | Pinned seeds from `.golem/seeds/<app>/<reqId>.json`, lowest stored robustness first | taken from the total as they run |
| 1 | Latin hypercube random sampling, generations of 32 | 40% of `maxTrials` (`phase1Fraction`) |
| 2 | Cross-entropy search toward the lowest margin, generations of 16, elite fraction 0.25 | the rest (`phase2Fraction`), plus what Phase 1 left unused |
| 3 | Shrinking toward the mildest failing scenario, then 3 verification seeds | a separate shrink reserve: `max(12, ceil(0.15 * maxTrials))`, on top of `maxTrials` |

The first failing trial ends the search. Its generation still finishes, because the falsifier submits
a generation as one `run` call. Phase 3 then bisects each dimension whose `severity` is `'up'` or
`'down'` toward its milder end, keeping the seed fixed, until the interval is at most 1% of the
dimension width (`shrink.tolerance`) or 60 shrink trials have run (`shrink.maxTrials`). Dimensions with
`severity: 'none'` and fixed dimensions are not changed. Because the shrink reserve is separate, a
counterexample found in the last generation is still shrunk.

`mode: 'random-only'` runs Phase 0 and Phase 1 only, with the whole budget, as a baseline.

## What a verdict means

- `broken`: a trial had robustness below zero. `counterexample` holds the scenario, the seed and
  the robustness, for example `push.force = 168 N`, `push.angle = 2.356 rad`, seed `2780164117`,
  robustness `-0.04 m`.
- `held`: **no counterexample was found in N trials**, where N is `verdict.trials`. This is never a
  proof that the requirement holds. `failureRateUpper95` is the 95% upper bound on the failure rate
  from the Phase 1 random trials only (with 0 failures in 100 trials it is about 3%, the rule of three).
- `error`: the pool failed or no trial completed. `meta.errors` says why.

A verdict is a pure function of the requirement, budget, search seed, configuration and trial results.
The pool kind, the pool size and the completion order do not change it.

## Reproducing a counterexample

A trial is a pure function of `(app, reqId, scenario, seed)`. To reproduce a counterexample, run one
`TrialSpec` with exactly those four values. The CLI does this with `golem replay`.

```ts
import { falsify, InProcessPool, createSeedDatabase, memoryFileSystem } from 'golem-spec';
import type { TrialSpec, TrialResult } from 'golem-spec';

// A synthetic robustness function: the requirement breaks above 150 N.
const trial = (spec: TrialSpec): TrialResult => ({
  spec,
  robustness: (150 - (spec.scenario['push.force'] ?? 0)) / 1000, // metres of margin
  worstAt: 2.4,
  unit: 'm',
  wallMs: 0,
});

const requirement = {
  id: 'R2',
  space: {
    dims: [
      { name: 'push.force', kind: 'force' as const, min: 0, max: 200, severity: 'up' as const },
      { name: 'push.angle', kind: 'angle' as const, min: 0, max: 2 * Math.PI, severity: 'none' as const, wrap: true },
    ],
  },
};

const pool = new InProcessPool(trial);
const seedDb = createSeedDatabase(memoryFileSystem());
const { verdict, meta, pinEntry } = await falsify(requirement, pool, {
  appId: 'stagger',
  budget: { maxTrials: 200 },
  searchSeed: 1,
  seedDb,
});
if (verdict.status === 'broken' && verdict.counterexample) {
  const { scenario, seed } = verdict.counterexample;
  // Reproduce: the same app, reqId, scenario and seed give the same robustness.
  const [again] = await pool.run([{ app: 'stagger', reqId: 'R2', scenario, seed }]);
  console.log(`R2 broke at ${scenario['push.force']} N, margin ${again?.robustness} m, after ${meta.phaseTrials.p1} random trials`);
  // The falsifier never writes the seed database. Pinning is the caller's choice:
  if (pinEntry) await seedDb.add('stagger', pinEntry);
}
await pool.close();
```

## Seed files

`.golem/seeds/<app>/<reqId>.json` holds a JSON array of `Counterexample` objects, written in canonical
form: sorted keys, 2-space indent, one trailing newline. Writes go to a temporary file first and are
renamed into place, so a failed write leaves the previous file intact. Entries may also carry
`classification` (`'robust'` or `'seed-sensitive'`, from the 3 verification seeds), `verificationSeeds`
and `verificationRobustness`.

```json
[
  {
    "foundAfter": 57,
    "reqId": "R2",
    "robustness": -0.04,
    "scenario": { "push.angle": 2.356, "push.force": 168 },
    "seed": 2780164117,
    "shrunk": true
  }
]
```

App and requirement ids must be non-empty and contain no `/`, `\`, `..` or NUL; otherwise the database
rejects them with a `SeedDbError` before touching the file system. Phase 0 skips an invalid file or entry,
lists the path and reason in `meta.skippedSeedFiles` or `meta.skippedPinned`, and leaves the file unchanged.

## Options and errors

| Option | Default | Allowed |
|---|---|---|
| `budget.maxTrials` / `budget.maxWallMs` | none (one is required) | positive integer / positive ms |
| `phase1Fraction`, `phase2Fraction` | 0.4, remainder | each in [0, 1], sum at most 1 |
| `phase1GenerationSize` | 32 | integer ≥ 1 |
| `cem` | `{ generationSize: 16, eliteFraction: 0.25, smoothing: 1 }` | |
| `shrink` | `{ tolerance: 0.01, maxTrials: 60, reserveFraction: 0.15, reserveMin: 12 }` | tolerance in (0, 1) |
| `signal` | none | `AbortSignal`; `falsify` rejects with `AbortError` and touches no file |
| `onProgress`, `onResult` | none | callback errors are ignored |

Invalid options throw a `RangeError` that names the field and the value, before any trial runs.
Error classes have a stable `name`: `AbortError`, `TrialError`, `TrialCrashError`, `RestartLimitError`,
`LoadError`, `PoolClosedError`, `CancelledError`, `SeedDbError`. Each keeps the original error in `cause`.
