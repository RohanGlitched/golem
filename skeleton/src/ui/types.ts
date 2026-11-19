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
  /** Where a broken line fractures: the Response_Clause word of the signal that broke first, and its margin. */
  fracture?: { start: number; end: number; margin: number; unit: string; signal?: string } | undefined;
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
    /** The app id the falsifier puts in its trial specs. */
    appId?: string;
    /** Called once per generation of trials, after the generation's results were delivered to the pool's onResult. */
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
  /** Replaces the MuJoCo loader of the hero (returns the `@mujoco/mujoco` module instance). */
  loadHero?: () => Promise<unknown>;
  /** Replaces WebGLRenderer creation; skips the WebGL probe. */
  createRenderer?: (canvas: HTMLCanvasElement) => unknown;
  /** Overrides the WebGL probe result. */
  webgl?: boolean;
  /** Replaces the pool the studio builds from `workerUrl`. */
  createPool?: (workerUrl: string | URL) => TrialPool;
  clipboard?: { writeText(s: string): Promise<void> };
  /** Adds `summonSynthetic(n, seconds)` to the handle: feeds `n` synthetic pose results through the swarm (perf and e2e tests). */
  summonSynthetic?: boolean;
  /** Replaces the AudioContext the Sound toggle creates (returns an AudioContext-like object). */
  createAudio?: () => unknown;
}

export interface StudioOptions {
  pool?: TrialPool;
  /**
   * URL of the module the trial workers import. It exports `app` and `requirements`; build `requirements` with
   * `studioRequirements` from `golem-spec/ui/worker`. Used to build a Web Worker pool when `pool` is absent.
   * Trials run on the page thread when Workers are unavailable.
   */
  workerUrl?: string | URL;
  /** The worker script of the pool. Default: golem-pool's `browser-entry.js`; a dev server that serves TypeScript needs its own URL. */
  workerEntry?: string | URL;
  /** Number of workers. Default: `hardwareConcurrency - 1`, 1 to 8. */
  workerCount?: number;
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
  /**
   * The incised "emet" on the robot: `body` names the head body; `at` (body frame, m), `normal` and `width` (m) override
   * the placement found from the body's drawn geometry. `false` draws no decal. Default: the body that reaches highest.
   */
  emet?: { body: string; at?: [number, number, number]; normal?: [number, number, number]; width?: number } | false;
  /** Extra words of a Response_Clause that tilt with the robot's lean (default: "upright", "level", ...). */
  tiltWords?: string[];
  /** Signal name → the Response_Clause words it binds to, for the fracture of a broken line. */
  signalWords?: Record<string, string[]>;
  testHooks?: StudioTestHooks;
}

export interface StudioHandle {
  readonly ready: Promise<void>;
  getState(): Readonly<StudioState>;
  dispose(): void;
}
