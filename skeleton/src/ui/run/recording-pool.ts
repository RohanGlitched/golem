// RecordingPool: wraps the shared TrialPool so every trial records poses and every run() chunk of
// at most 64 specs is one Generation. Results go back to the falsifier without poses.
import type { TrialPool, TrialResult, TrialSpec } from '../types.js';

export const CHUNK = 64;

export interface RecordingHooks {
  beginGeneration(): void;
  ingest(r: TrialResult): void;
  commit(): void;
}

export function stripPoses(r: TrialResult): TrialResult {
  if (!('poses' in r)) return r;
  const { poses: _drop, ...rest } = r;
  return rest;
}

export class RecordingPool implements TrialPool {
  /** The chunk being run, so an error can name its trial. */
  lastChunk: TrialSpec[] = [];

  /** `appId` fills specs whose app is empty (the falsifier may not know the app). */
  constructor(
    private readonly inner: TrialPool, private readonly hooks: RecordingHooks, private readonly chunk = CHUNK, private readonly appId = '',
  ) {}

  get size(): number { return this.inner.size; }

  async run(specs: TrialSpec[], onResult?: (r: TrialResult) => void, opts?: { signal?: AbortSignal }): Promise<TrialResult[]> {
    const out: TrialResult[] = [];
    for (let i = 0; i < specs.length; i += this.chunk) {
      const chunk = specs.slice(i, i + this.chunk).map((s) => ({ ...s, app: s.app || this.appId, record: 'poses' as const }));
      this.lastChunk = chunk;
      this.hooks.beginGeneration();
      let seen = 0;
      const res = await this.inner.run(chunk, (r) => {
        seen++;
        this.hooks.ingest(r);
        onResult?.(stripPoses(r));
      }, opts);
      // A pool that never calls onResult still feeds the studio once per result.
      if (seen === 0) for (const r of res) { this.hooks.ingest(r); onResult?.(stripPoses(r)); }
      this.hooks.commit();
      for (const r of res) out.push(stripPoses(r));
    }
    return out;
  }

  /** Never closes the shared pool. */
  close(): Promise<void> { return Promise.resolve(); }
}
