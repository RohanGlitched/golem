import type { TrialResult, TrialSpec } from '../falsify/contract.js';

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

export type TrialFn = (spec: TrialSpec) => TrialResult | Promise<TrialResult>;
