// Contract shapes used by falsify and pool. They mirror .kiro/steering/interfaces.md exactly (plus the
// approved add-only fields). These modules never import from ears or sim at the type level, so the
// shapes are repeated here; structural typing keeps them compatible. Not re-exported from the barrels.

export type Kind =
  | 'force' | 'duration' | 'length' | 'speed' | 'angle' | 'mass' | 'ratio' | 'count' | 'phase';
export interface Dimension {
  name: string; kind: Kind; min: number; max: number;
  severity: 'up' | 'down' | 'none'; wrap?: boolean;
}
export interface ScenarioSpace { dims: Dimension[] }
export type Scenario = Record<string, number>;

/** The part of a CompiledRequirement the falsifier reads. */
export interface FalsifiableRequirement { id: string; space: ScenarioSpace }

export interface TrialSpec { app: string; reqId: string; scenario: Scenario; seed: number; record?: 'none' | 'poses' }
export interface TrialResult {
  spec: TrialSpec; robustness: number; worstAt: number; unit: string;
  wallMs: number;
  poses?: { fps: number; nbody: number; frames: Float32Array };
}
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

export interface RunOptions { signal?: AbortSignal }

export interface TrialPool {
  run(
    specs: TrialSpec[],
    onResult?: (r: TrialResult) => void | Promise<void>,
    opts?: RunOptions,
  ): Promise<TrialResult[]>;
  size: number;
  close(): Promise<void>;
}
