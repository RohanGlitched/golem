// Outcome and report shapes shared by the CLI and the MCP server. Types only.
import type { Diagnostic } from '../ears/index.js';
import type { PinnedSeedEntry, ProgressEvent, RunMetadata } from '../falsify/index.js';
import type { Expectation, MarkChange } from './expectation.js';
import type { CompiledRequirement, Verdict } from './sibling-types.js';

export interface FileDiagnostic extends Diagnostic { file: string }

export interface CompileOutcome {
  requirements: CompiledRequirement[];
  diagnostics: FileDiagnostic[];
  /** Files in listed order, so diagnostics can be sorted by file order. */
  files: string[];
  /** The text of every file that was read, by path: the one source of the requirements and of the Expectation table. */
  texts: Record<string, string>;
}

export interface RunOptions {
  /** Restrict to one requirement id. */
  req?: string;
  budget?: number;
  timeS?: number;
  workers?: number;
  searchSeed?: number;
  mode: 'full' | 'random-only';
  /** Selects defaults and the pinned-seed arithmetic (assumption A1). */
  budgetKind: 'test' | 'gate' | 'mcp-run' | 'mcp-falsify';
  signal?: AbortSignal;
  onProgress?: (e: ProgressEvent, req: CompiledRequirement) => void;
  /** Called after each requirement finished (and was pinned), so commands can print its line at once. */
  onOutcome?: (o: RequirementOutcome) => void;
  onResult?: (r: { robustness: number; unit: string; spec: { seed: number; scenario: Record<string, number> } }, req: CompiledRequirement) => void;
}

export interface RequirementOutcome {
  req: CompiledRequirement;
  verdict: Verdict;
  meta: RunMetadata;
  /** Monitor unit captured through the falsify `onResult` callback (assumption A5). */
  unit: string | undefined;
  pinned?: 'added' | 'duplicate';
  pinEntry?: PinnedSeedEntry;
  /** Number of pinned seeds that were valid for this run. */
  pinnedValid: number;
}

// ---------------------------------------------------------------- stored files

export type GateState = Record<string, { count: number; updatedAt: string }>;

export interface ReportMeta {
  budget: { maxTrials?: number; maxWallMs?: number };
  commit?: string;
  durationS: number;
  searchSeed: number;
  lastGateExitCode?: number;
  /** Marks of the Expectation table that differ from HEAD, written by the gate. Omitted when none moved. */
  expectationChanges?: MarkChange[];
}

/** Additive fields (A5): `unit` of the monitor, `ears` source line; `expectation` and `met` from the Expectation table. */
export interface ReportVerdict extends Verdict { unit?: string; ears?: string; partial?: boolean; expectation?: Expectation; met?: boolean }

export interface GateOverride { sessionId: string; timestamp: string; count: number; brokenReqIds: string[] }

export interface ReportFile {
  schema: 1;
  verdicts: ReportVerdict[];
  meta: ReportMeta;
  gateOverrides: GateOverride[];
}
