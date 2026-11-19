import type { Counterexample, Scenario, TrialResult, Verdict } from './contract.js';

/** At least one limit is required. */
export interface Budget { maxTrials?: number; maxWallMs?: number }

/** Reads pinned seeds. The falsifier only ever reads (design D2). */
export interface SeedReader { read(appId: string, reqId: string): Promise<PinnedSeedEntry[]> }

export interface PinnedSeedEntry extends Counterexample {
  classification?: 'robust' | 'seed-sensitive';
  /** Any verification seed passes at the shrunk scenario (golem-falsify-hardening defect 1). */
  boundarySensitive?: boolean;
  verificationSeeds?: number[];
  verificationRobustness?: (number | null)[];
}

/** The distribution one Phase 2 dimension was sampled from; `mu`, `sigma` null for uniform and fixed. */
export interface CemDimInfo {
  readonly name: string;
  readonly kind: 'normal' | 'wrapped' | 'uniform' | 'uniformCircle' | 'fixed';
  readonly mu: number | null;
  readonly sigma: number | null;
}

export interface ProgressEvent {
  readonly phase: 0 | 1 | 2 | 3;
  readonly generation: number;
  readonly scenarios: readonly Readonly<Scenario>[];
  /** Trial seeds, aligned with `scenarios`. */
  readonly seeds: readonly number[];
  readonly robustness: readonly number[];
  /** Minimum robustness so far (Math.min semantics: -0 is below 0). */
  readonly lowestRobustness: number;
  readonly trialsUsed: number;
  readonly trialsRemaining: number | null;
  /** Milliseconds since the run started, from the run's clock. */
  readonly elapsedMs: number;
  /** elapsedMs / maxWallMs; null without a wall limit. */
  readonly timeFraction: number | null;
  /** Phase 2 only: the distribution the generation was drawn from, one entry per dimension. */
  readonly cem?: readonly CemDimInfo[];
}

/** Second argument of `onResult`. Phase 3: generation 0 = shrink trials, 1 = verification trials. */
export interface ResultInfo { phase: 0 | 1 | 2 | 3; generation: number; index: number }

export interface FalsifyOptions {
  appId: string;
  budget: Budget;
  searchSeed: number;
  mode?: 'full' | 'random-only';
  phase1Fraction?: number;
  phase2Fraction?: number;
  phase1GenerationSize?: number;
  /** At most this many pinned seeds run in Phase 0 (default: no limit beyond the trial budget). */
  maxPinned?: number;
  /** Defaults: generationSize 32, eliteFraction 0.25, smoothing 1, lhsFraction 0.2 (share of each Phase 2 generation drawn by LHS). */
  cem?: { generationSize?: number; eliteFraction?: number; smoothing?: number; lhsFraction?: number };
  /**
   * `tolerance` and `maxTrials` as in the design. The shrink trials come from a reserve on top of
   * the search budget: `max(reserveMin, ceil(reserveFraction * maxTrials))`, defaults 0.15 and 12.
   */
  shrink?: { tolerance?: number; maxTrials?: number; reserveFraction?: number; reserveMin?: number };
  seedDb?: SeedReader;
  signal?: AbortSignal;
  onProgress?: (e: ProgressEvent) => void | Promise<void>;
  onResult?: (r: TrialResult, info: ResultInfo) => void;
  clock?: () => number;
}

export interface ResolvedConfig {
  phase1Fraction: number;
  phase2Fraction: number;
  phase1GenerationSize: number;
  /** null: no limit. */
  maxPinned: number | null;
  cem: { generationSize: number; eliteFraction: number; smoothing: number; lhsFraction: number };
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
  /** From the three verification seeds at the original (unshrunk) failure. */
  classification?: 'robust' | 'seed-sensitive';
  /**
   * True when any verification seed passes at the shrunk scenario. Equal to
   * `classification === 'seed-sensitive'` when the shrink changed nothing; unset when a trial errored.
   */
  boundarySensitive?: boolean;
  /**
   * Options that rerun this run trial for trial with a trial limit instead of a clock (same requirement,
   * trial function, seed database and search seed). Pass them to falsify as they are.
   */
  replayOptions: ReplayOptions;
  verification?: { scenario: Scenario; seeds: number[]; robustness: (number | null)[]; errors: string[] };
  /** The same seeds at the shrunk scenario; absent when the shrink changed nothing. */
  boundaryVerification?: { scenario: Scenario; seeds: number[]; robustness: (number | null)[]; errors: string[] };
}

/** The deterministic subset of FalsifyOptions that reproduces a run (golem-falsify-hardening defect 5). */
export interface ReplayOptions {
  appId: string;
  budget: { maxTrials: number };
  searchSeed: number;
  mode: 'full' | 'random-only';
  phase1Fraction: number;
  phase2Fraction: number;
  phase1GenerationSize: number;
  maxPinned: number;
  cem: { generationSize: number; eliteFraction: number; smoothing: number; lhsFraction: number };
  shrink: { tolerance: number; maxTrials: number; reserveFraction: number; reserveMin: number };
}

export interface FalsifyResult { verdict: Verdict; meta: RunMetadata; pinEntry?: PinnedSeedEntry }
