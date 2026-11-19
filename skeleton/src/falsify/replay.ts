// Re-run one counterexample, by default with pose recording, for the reel (golem-falsify-hardening D10).
import type { Counterexample, TrialPool, TrialResult, TrialSpec } from './contract.js';

export interface ReplayCounterexampleOptions {
  /** `TrialSpec.app`; default ''. Pools load their app at construction, so it is informational. */
  appId?: string;
  /** Default 'poses'. */
  record?: 'none' | 'poses';
  signal?: AbortSignal;
}

export type ReplayedTrial = TrialResult & {
  /** True when the re-run gives exactly the stored robustness (trials are pure in (scenario, seed)). */
  reproduced: boolean;
};

export async function replayCounterexample(
  pool: TrialPool, cx: Counterexample, opts: ReplayCounterexampleOptions = {},
): Promise<ReplayedTrial> {
  const spec: TrialSpec = {
    app: opts.appId ?? '', reqId: cx.reqId, scenario: { ...cx.scenario }, seed: cx.seed, record: opts.record ?? 'poses',
  };
  const [r] = await pool.run([spec], undefined, opts.signal === undefined ? undefined : { signal: opts.signal });
  if (r === undefined) throw new Error(`replayCounterexample: the pool returned no result for ${cx.reqId} seed ${cx.seed}`);
  return { ...r, reproduced: r.robustness === cx.robustness };
}
