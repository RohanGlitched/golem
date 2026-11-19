# pool

A `TrialPool` runs `TrialSpec`s and returns `TrialResult`s in input order. Every pool gives bit-identical
`robustness`, `worstAt`, `unit` and `poses` for the same spec; only `wallMs` differs.

| Pool | Where | `size` |
|---|---|---|
| `InProcessPool(trialFn)` | the calling thread, one trial at a time | 1 |
| `createNodePool(options)` (`golem-spec/node`) | `worker_threads`, one MuJoCo instance per worker | default: CPU cores − 1, at least 1 |
| `createBrowserPool(options)` | module Web Workers | default: `navigator.hardwareConcurrency − 1`, clamped to 1..8 |

The Node and browser pools are thin adapters over one `TrialScheduler`, so dispatch order, errors and
restart behaviour are the same in both.

## Options

| Option | Default | Meaning |
|---|---|---|
| `size` | see above | number of workers; integer ≥ 1 (browser: 1 to 8) |
| `deliveryBound` | `2 * size` | for `record: 'poses'`, the most results that may wait for an async `onResult` |
| `maxRestarts` | 5 | consecutive worker restarts allowed per slot; a completed trial resets the count |
| `abortGraceMs` | 2000 | after an abort, how long a worker may keep running the cancelled trial before it is replaced (100 to 60000 ms) |
| `config.trialModule` | none | URL of a module exporting `createTrialFn(appId, config)`; replaces MuJoCo |
| `config.appModule` | none | URL of a module exporting `app` (a `RobotApp`) and `requirements` |
| `config.assetBase` | none | the only URL a browser worker fetches robot files from |

Invalid options throw a `RangeError` naming the field and the value, before any worker starts.

## Behaviour

- Each worker holds at most one trial. Specs wait in one queue, ordered by `run` call and then input index.
- `onResult` is called once per result, in completion order, before `run` resolves.
- `run(specs, onResult, { signal })`: an abort rejects with `AbortError` in the same turn, drops the
  run's queued specs and ignores its late results. Other runs keep their order. A worker still busy
  after `abortGraceMs` is terminated and replaced; this is not counted as a restart.
- A worker crash (uncaught error or exit) replaces the worker in the same slot and retries the trial once,
  at the front of the queue. A second crash rejects that run with `TrialCrashError`, for example
  `trial R2 seed 2780164117 (app stagger) crashed two workers: worker exited with code 134`.
- More than `maxRestarts` consecutive restarts of one slot fail the pool with `RestartLimitError`, which
  names the slot and the last failure. `close()` still resolves.
- A worker that fails to load MuJoCo or the app fails the pool with `LoadError`. `createNodePool` rejects
  and terminates every worker it started; `createBrowserPool` returns at once and `run` rejects.
- A trial that throws rejects its run with `TrialError` naming app, `reqId` and seed, with the original
  error as `cause`. The pool stays usable.
- `close()` is idempotent, rejects pending runs with `CancelledError`, and no `onResult` fires after it
  resolves. `run` after `close` rejects with `PoolClosedError`.

## Injecting a synthetic trial function

Tests replace MuJoCo with a pure function of the spec. `InProcessPool` takes the function directly:

```ts
import { InProcessPool } from 'golem-spec';
import type { TrialSpec, TrialResult } from 'golem-spec';

// The pelvis stays above 0.6 m unless the push exceeds 150 N.
const trial = (spec: TrialSpec): TrialResult => ({
  spec,
  robustness: 0.6 - (spec.scenario['push.force'] ?? 0) / 250, // metres above the 0.6 m threshold
  worstAt: 2.0,
  unit: 'm',
  wallMs: 0,
});

const pool = new InProcessPool(trial);
const results = await pool.run([
  { app: 'stagger', reqId: 'R2', scenario: { 'push.force': 120 }, seed: 7 },
  { app: 'stagger', reqId: 'R2', scenario: { 'push.force': 180 }, seed: 7 },
]);
console.log(results.map((r) => `${r.spec.scenario['push.force']} N -> ${r.robustness.toFixed(3)} ${r.unit}`));
await pool.close();
```

A worker cannot receive a function, so worker pools take the URL of a module instead. The module exports
`createTrialFn(appId, config)`, which returns the trial function. With a `trialModule` no worker loads
MuJoCo or app files.

```ts
import { createNodePool } from 'golem-spec/node';

const pool = await createNodePool({
  appId: 'stagger',
  size: 4,
  config: { trialModule: new URL('./synthetic-trial.mjs', import.meta.url).href },
});
const ac = new AbortController();
const results = await pool.run(
  [{ app: 'stagger', reqId: 'R2', scenario: { 'push.force': 168 }, seed: 2780164117, record: 'poses' }],
  (r) => console.log(`margin ${r.robustness} ${r.unit} at t = ${r.worstAt} s`),
  { signal: ac.signal },
);
console.log(results.length);
await pool.close();
```

For scheduler tests without threads, `golem-spec/testing` exports `fakeWorkerFactory` and `FakeTimers`:
fake workers run the real worker loop in the same thread and can be scripted to delay, crash, fail to
load or report trial errors.
