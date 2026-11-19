import type { TrialResult, TrialSpec } from '../falsify/contract.js';
import type { HandleTracker } from './worker-runner.js';

export type { RunOptions, TrialPool } from '../falsify/contract.js';

export interface PoolOptions {
  size?: number;
  /** Integer >= 1, default 2 * size. */
  deliveryBound?: number;
  /** Per worker slot, default 5. */
  maxRestarts?: number;
  /** 100..60000 ms, default 2000. */
  abortGraceMs?: number;
}

/** The optional second argument is a per-trial handle tracker (worker pools); in-process pools omit it. */
export type TrialFn = (spec: TrialSpec, tracker?: HandleTracker) => TrialResult | Promise<TrialResult>;
