// A scripted `falsify` for command tests: each requirement gets a fixed outcome, no trial runs.
import { AbortError } from '../../src/falsify/index.js';
import type { FalsifyResult, RunMetadata } from '../../src/falsify/index.js';
import type { KitDeps } from '../../src/cli/deps.js';

export type Scripted = 'held' | 'broken' | 'error' | 'throw' | 'abort';

export function scriptedFalsify(script: Record<string, Scripted>, fallback: Scripted = 'held'): KitDeps['falsify'] {
  return (async (req, _pool, opts): Promise<FalsifyResult> => {
    const s = script[req.id] ?? fallback;
    if (s === 'throw') throw new Error('scripted failure');
    if (s === 'abort') throw new AbortError();
    const meta = {
      app: opts.appId, reqId: req.id, mode: 'full', budget: opts.budget, searchSeed: opts.searchSeed,
      errors: s === 'error' ? [{ phase: 1, message: 'scripted error' }] : [], resolvedPinned: [], skippedPinned: [], skippedSeedFiles: [], pinnedNotRun: 0,
    } as unknown as RunMetadata;
    const scenario = { 'push.force': 150 };
    return {
      meta,
      verdict: {
        reqId: req.id, status: s, trials: 5, randomTrials: 5, guidedTrials: 0,
        closest: { robustness: s === 'broken' ? -0.1 : 0.2, scenario, seed: 9 },
        ...(s === 'broken' ? { counterexample: { reqId: req.id, scenario, seed: 9, robustness: -0.1, shrunk: true, foundAfter: 2 } } : {}),
        ms: 1,
      },
    };
  }) as KitDeps['falsify'];
}
