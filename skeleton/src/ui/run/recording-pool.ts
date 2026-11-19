// RecordingPool: wraps the shared TrialPool so every trial records poses, and hands each result, with its
// poses, to the studio as it arrives. Results go back to the falsifier without poses.
//
// The pool does not decide what a Generation is. golem-falsify submits some generations as one `run` (Phase 1
// and 2) and others as many (each pinned seed, each shrink trial), and reports each generation in one progress
// event. The RunController therefore closes a Generation on that event.
import type { TrialPool, TrialResult, TrialSpec } from '../types.js';

export interface RecordingHooks {
  ingest(r: TrialResult): void;
}

export function stripPoses(r: TrialResult): TrialResult {
  if (!('poses' in r)) return r;
  const { poses: _drop, ...rest } = r;
  return rest;
}

export class RecordingPool implements TrialPool {
  /** The specs of the latest `run` call, so an error can name its trial. */
  lastChunk: TrialSpec[] = [];

  /** `appId` fills specs whose app is empty (the falsifier may not know the app). */
  constructor(private readonly inner: TrialPool, private readonly hooks: RecordingHooks, private readonly appId = '') {}

  get size(): number { return this.inner.size; }

  async run(specs: TrialSpec[], onResult?: (r: TrialResult) => void, opts?: { signal?: AbortSignal }): Promise<TrialResult[]> {
    const recorded = specs.map((s) => ({ ...s, app: s.app || this.appId, record: 'poses' as const }));
    this.lastChunk = recorded;
    let seen = 0;
    const res = await this.inner.run(recorded, (r) => {
      seen++;
      this.hooks.ingest(r);
      onResult?.(stripPoses(r));
    }, opts);
    // A pool that never calls onResult still feeds the studio once per result.
    if (seen === 0) for (const r of res) { this.hooks.ingest(r); onResult?.(stripPoses(r)); }
    return res.map(stripPoses);
  }

  /** Never closes the shared pool. */
  close(): Promise<void> { return Promise.resolve(); }
}
