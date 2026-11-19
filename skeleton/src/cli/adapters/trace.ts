// The default `KitDeps.runTraced`: one trial with its Trace (design D7, approved optional additions).
// 1. The sim may return `TrialResult.trace` when asked with `recordTrace: true` (the approved optional exposure).
// 2. Otherwise the kit captures the Trace through the sim's existing `earlyStop` hook, which receives the live trace
//    arrays and the number of valid samples after every control step. The hook never decides, so the result is the
//    one a plain trial gives.
// 3. A sim that offers neither gives a TraceUnavailableError that names the missing golem-sim capability.
import { TraceUnavailableError, type KitDeps, type TracedRun } from '../deps.js';
import type { CompiledRequirement, RobotApp, Trace, TracedTrialResult, TrialSpec } from '../sibling-types.js';

export interface SimLike {
  runTrial(
    app: RobotApp, req: CompiledRequirement, spec: TrialSpec,
    opts: { cache: unknown; recordTrace?: boolean; earlyStop?: (trace: Trace, n: number) => undefined },
  ): Promise<TracedTrialResult>;
  ModelCache: new () => { dispose(): void };
}

export function copyTrace(trace: Trace, n: number): Trace {
  const signals: Record<string, Float64Array> = {};
  for (const k of Object.keys(trace.signals)) signals[k] = (trace.signals[k] as Float64Array).slice(0, n);
  return { t: trace.t.slice(0, n), signals, events: trace.events.map((e) => ({ ...e })) };
}

export function createTraceRunner(loadSim: () => Promise<SimLike>): { runTraced: KitDeps['runTraced']; dispose(): Promise<void> } {
  const caches = new Map<RobotApp, { dispose(): void }>();
  return {
    async runTraced(app, req, spec): Promise<TracedRun> {
      const sim = await loadSim();
      let cache = caches.get(app);
      if (cache === undefined) { cache = new sim.ModelCache(); caches.set(app, cache); }
      let live: Trace | undefined;
      let n = 0;
      const result = await sim.runTrial(app, req, spec, {
        cache, recordTrace: true,
        earlyStop: (trace, count) => { live = trace; n = count; return undefined; },
      });
      if (result.trace !== undefined) return { result, trace: result.trace };
      if (live === undefined || n === 0) throw new TraceUnavailableError();
      const { trace: _drop, ...plain } = result;
      return { result: plain, trace: copyTrace(live, n) };
    },
    async dispose() {
      for (const c of caches.values()) c.dispose();
      caches.clear();
    },
  };
}
