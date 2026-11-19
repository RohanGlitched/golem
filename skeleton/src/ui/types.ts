// Studio-local types. The interfaces.md shapes are repeated structurally where the sibling module
// that owns them (falsify, pool) has not landed yet; TypeScript's structural typing keeps them
// compatible with the real ones.
import type {
  CompiledRequirement, Diagnostic, Dimension, Kind, Lexicon, PerturbationCall, PerturbationTemplate as EarsPerturbationTemplate,
  Quantity, Scenario, ScenarioSpace,
} from '../ears/index.js';
import type { RobotApp, SimContext, TrialResult, TrialSpec } from '../sim/types.js';

export type { CompiledRequirement, Diagnostic, Dimension, Kind, Lexicon, PerturbationCall, Quantity, Scenario, ScenarioSpace };
export type PerturbationTemplate = EarsPerturbationTemplate;
export type { RobotApp, SimContext, TrialResult, TrialSpec };

// ---- contract shapes owned by falsify and pool (interfaces.md) ----
export interface Counterexample {
  reqId: string; scenario: Scenario; seed: number; robustness: number; shrunk: boolean; foundAfter: number;
}
export interface Verdict {
  reqId: string; status: 'held' | 'broken' | 'error';
  trials: number; randomTrials: number; guidedTrials: number;
  closest: { robustness: number; scenario: Scenario; seed: number };
  counterexample?: Counterexample;
  failureRateUpper95?: number;
  ms: number;
}
export interface TrialPool {
  run(specs: TrialSpec[], onResult?: (r: TrialResult) => void, opts?: { signal?: AbortSignal }): Promise<TrialResult[]>;
  size: number;
  close(): Promise<void>;
}

// ---- additive optional field on the PerturbationTemplate contract ----
/** `visual` of a PerturbationTemplate: a hint the studio uses to draw the push arrow. */
export type PerturbationVisual = NonNullable<EarsPerturbationTemplate['visual']>;

// ---- studio-local ----
export type Reason = 'simulating' | 'dragging' | 'replaying' | 'ghosts-running' | 'transition';
export type LineStatus = 'untested' | 'running' | 'held' | 'broken' | 'error';
export type V3 = readonly [number, number, number];
export type ThemeName = 'dark' | 'light';

export interface Budget { maxTrials?: number; maxMs?: number }

export interface ClassifiedCounterexample extends Counterexample { classification?: 'robust' | 'seed-sensitive' }

export interface LineModel {
  id: string;
  group?: string;
  original: string;
  text: string;
  diagnostics: Diagnostic[];
  compiled?: CompiledRequirement;
  status: LineStatus;
  progress?: { trials: number };
  verdict?: Verdict;
  stale: boolean;
  counterexample?: ClassifiedCounterexample | undefined;
  summary?: string;
  /** Unit of the monitor's robustness, from the first trial result. */
  unit?: string;
  /** Error message of the last run, when its status is `error`. */
  error?: string;
}

export interface VerdictRow { label: string; value: string }
export interface VerdictRows { rows: VerdictRow[]; sentence: string }

export interface StudioState {
  lines: LineModel[];
  selectedId?: string;
  run?: { runId: number; lineId: string; trials: number; phase?: number; generation: number };
  aura: { total: number; ignored: number; summary: string };
  verdictRows?: VerdictRows;
  replay?: { playing: boolean; t: number; duration: number; worstTau: number; fps: number; active: boolean; lineId: string };
  theme: ThemeName;
  reducedMotion: boolean;
  hero: 'loading' | 'running' | 'sleeping' | 'replaying' | 'failed' | 'no-webgl';
  messages: { id: string; kind: 'info' | 'warning' | 'error'; text: string }[];
  stageFrames: number;
  poolConfigured: boolean;
}

export interface Retained { spec: TrialSpec; robustness: number; worstAt: number; poses?: TrialResult['poses'] }

export interface TokenSet {
  ground: string; ground2: string; ink: string; ink2: string; clay: string; ghost: string;
  break: string; hold: string; breakText: string; holdText: string;
}

export interface ShareState { lines: Record<string, string>; pick?: { reqId: string; seed: number; scenario: Scenario } }

export type FalsifyFn = (
  req: CompiledRequirement, pool: TrialPool, budget: Budget, searchSeed: number,
  options: {
    signal?: AbortSignal; seeds?: Counterexample[]; generationSize?: number;
    onProgress?: (e: { phase: 0 | 1 | 2 | 3; generation: number; trials: number }) => void;
  },
) => Promise<Verdict & { counterexample?: ClassifiedCounterexample }>;

export interface StudioTestHooks {
  raf?: (cb: (ts: number) => void) => number;
  caf?: (id: number) => void;
  now?: () => number;
  storage?: Storage | undefined;
  matchMedia?: (q: string) => { matches: boolean; addEventListener?: (t: string, cb: () => void) => void; removeEventListener?: (t: string, cb: () => void) => void };
  falsify?: FalsifyFn;
  loadHero?: unknown;
  createRenderer?: unknown;
  clipboard?: { writeText(s: string): Promise<void> };
  /** Feeds `n` synthetic pose results through the swarm (perf and e2e tests). */
  summonSynthetic?: boolean;
}

export interface StudioOptions {
  pool?: TrialPool;
  workerUrl?: string | URL;
  seed?: number;
  budget?: Budget;
  theme?: ThemeName;
  autorun?: boolean;
  shoveStiffness?: number;
  primaryPushBody?: string;
  ghostGenerationSize?: number;
  idleSleepMs?: number;
  stepCap?: number;
  fontBaseUrl?: string;
  summaryPhrases?: Partial<Record<Kind, string>>;
  testHooks?: StudioTestHooks;
}

export interface StudioHandle {
  readonly ready: Promise<void>;
  getState(): Readonly<StudioState>;
  dispose(): void;
}
