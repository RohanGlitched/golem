import type { Counterexample, Scenario, TrialResult, Verdict } from './contract.js';

/** At least one limit is required. */
export interface Budget { maxTrials?: number; maxWallMs?: number }

/** Reads pinned seeds. The falsifier only ever reads (design D2). */
export interface SeedReader { read(appId: string, reqId: string): Promise<PinnedSeedEntry[]> }

export interface PinnedSeedEntry extends Counterexample {
  classification?: 'robust' | 'seed-sensitive';
  verificationSeeds?: number[];
  verificationRobustness?: (number | null)[];
}

export interface ProgressEvent {
  readonly phase: 0 | 1 | 2 | 3;
  readonly generation: number;
  readonly scenarios: readonly Readonly<Scenario>[];
  readonly robustness: readonly number[];
  readonly lowestRobustness: number;
  readonly trialsUsed: number;
  readonly trialsRemaining: number | null;
}

export interface FalsifyOptions {
  appId: string;
  budget: Budget;
  searchSeed: number;
  mode?: 'full' | 'random-only';
  phase1Fraction?: number;
  phase2Fraction?: number;
  phase1GenerationSize?: number;
  cem?: { generationSize?: number; eliteFraction?: number; smoothing?: number };
  /**
   * `tolerance` and `maxTrials` as in the design. The shrink trials come from a reserve on top of
   * the search budget: `max(reserveMin, ceil(reserveFraction * maxTrials))`, defaults 0.15 and 12.
   */
  shrink?: { tolerance?: number; maxTrials?: number; reserveFraction?: number; reserveMin?: number };
  seedDb?: SeedReader;
  signal?: AbortSignal;
  onProgress?: (e: ProgressEvent) => void | Promise<void>;
  onResult?: (r: TrialResult) => void;
  clock?: () => number;
}

export interface ResolvedConfig {
  phase1Fraction: number;
  phase2Fraction: number;
  phase1GenerationSize: number;
  cem: { generationSize: number; eliteFraction: number; smoothing: number };
  shrink: { tolerance: number; maxTrials: number; reserveFraction: number; reserveMin: number };
}

export interface RunMetadata {
  app: string;
  reqId: string;
  mode: 'full' | 'random-only';
  budget: Budget;
  searchSeed: number;
  config: ResolvedConfig;
  phaseTrials: { p0: number; p1: number; p2: number; p3: number };
  p3Detail: { shrink: number; verification: number };
  /** Shrink trials allowed on top of `maxTrials`; null when the budget has no trial limit. */
  shrinkReserve: number | null;
  stopReason: 'completed' | 'trial-budget' | 'time-budget' | 'failure-found' | 'error';
  budgetExhausted: boolean;
  resolvedPinned: { scenario: Scenario; seed: number; robustness: number }[];
  skippedPinned: { index: number; reason: string }[];
  skippedSeedFiles: { path: string; reason: string }[];
  pinnedNotRun: number;
  errors: { phase: 0 | 1 | 2 | 3; message: string; seed?: number }[];
  classification?: 'robust' | 'seed-sensitive';
  verification?: { seeds: number[]; robustness: (number | null)[]; errors: string[] };
}

export interface FalsifyResult { verdict: Verdict; meta: RunMetadata; pinEntry?: PinnedSeedEntry }
