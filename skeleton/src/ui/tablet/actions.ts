// What the React panels can ask the studio to do. mount.ts implements it; tests pass a fake.
import { useSyncExternalStore } from 'react';
import type { Counterexample, Diagnostic, StudioState } from '../types.js';

export interface StudioActions {
  summon(lineId: string): void;
  summonAll(): void;
  stop(): void;
  select(lineId: string): void;
  /** Recompiles the line text; does not run. */
  compile(lineId: string, text: string): { diagnostics: Diagnostic[] };
  /** Commits an edited line: recompiles, updates the Share_Hash and starts a run when it compiles. */
  commitLine(lineId: string, text: string): void;
  reset(): void;
  toggleTheme(): void;
  // reel
  replay(lineId: string): void;
  backToLive(): void;
  play(): void;
  pause(): void;
  seekTime(t: number): void;
  stepFrame(dir: 1 | -1): void;
  copySeed(ce: Counterexample): Promise<boolean>;
  pin(ce: Counterexample): void;
  removePin(ce: Counterexample): void;
  pinsOf(lineId: string): Counterexample[];
  /** Counterexample_Summary of a counterexample of a line. */
  summaryOf(lineId: string, ce: Counterexample): string;
  /** "Replay the fall" or "Replay the failure". */
  replayLabelOf(lineId: string): string;
  /** Replay poses of the line's counterexample: retained poses, or one pool trial with poses. */
  loadReplay(lineId: string, signal: AbortSignal): Promise<ReelData>;
  /** Renders the eight filmstrip frames, one per animation frame. Returns an abort function. */
  renderFilmstrip(data: ReelData, canvases: (HTMLCanvasElement | null)[]): () => void;
  /** A quantity is being dragged or stepped: `text` is the line as it would read. Draws the push on the stage. */
  previewQuantity?(lineId: string, text: string): void;
  /** Words of a Response_Clause that tilt with the lean (StudioOptions.tiltWords added to the defaults). */
  tiltWords?: readonly string[];
}

export interface ReelData {
  poses: { fps: number; nbody: number; frames: Float32Array };
  worstTau: number;
  entries: { frame: number; tau: number; isWorst: boolean }[];
  labels: string[];
}

export interface StoreLike {
  subscribe(l: () => void): () => void;
  getState(): StudioState;
}

export function useStudio<T>(store: StoreLike, select: (s: StudioState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()), () => select(store.getState()));
}
