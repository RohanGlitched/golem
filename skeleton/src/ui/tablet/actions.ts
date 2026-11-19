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
}

export interface StoreLike {
  subscribe(l: () => void): () => void;
  getState(): StudioState;
}

export function useStudio<T>(store: StoreLike, select: (s: StudioState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()), () => select(store.getState()));
}
