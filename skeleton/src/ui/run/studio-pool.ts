// The studio's trial pool: golem-pool's browser Web Worker pool, with the in-process pool as the fallback
// when Workers are unavailable (no `Worker` global) or cannot start (the pool reports a LoadError before
// any trial ran). The fallback keeps the studio working, on the page thread.
//
// The studio registers each compiled requirement with the pool (`register`). Workers cannot receive a
// compiled requirement, so the pool sends the line in the reqId (see req-key.ts) and puts the original id
// back on every result, which keeps the line a user edited as the line that is tested.
import { createBrowserPool } from '../../pool/index.js';
import { InlinePool, type RegisteringPool } from './inline-pool.js';
import { decodeReqKey, encodeReqKey } from './req-key.js';
import type { CompiledRequirement, RobotApp, TrialPool, TrialResult, TrialSpec } from '../types.js';

export interface StudioPoolOptions {
  /** URL of the module the workers import: it exports `app` and `requirements` (see `golem-spec/ui/worker`). */
  workerUrl: string | URL;
  /** The worker script. Default: the pool's own `browser-entry.js`. */
  entry?: string | URL;
  /** The only URL a worker fetches robot files from. */
  assetBase?: string;
  /** Number of workers. Default: the pool's default (`hardwareConcurrency - 1`, 1 to 8). */
  size?: number;
}

export const NO_WORKERS_TEXT = 'Web Workers are not available here, so trials run on the page thread and the page may pause while they run';
export const workersFailedText = (why: string): string =>
  `The trial workers could not start (${why}), so trials run on the page thread and the page may pause while they run`;

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function absoluteUrl(u: string | URL): string {
  const base = (globalThis as { location?: { href?: string } }).location?.href;
  try { return new URL(String(u), base).href; } catch { return String(u); }
}

export class StudioPool implements RegisteringPool {
  /** Set when the pool runs in-process from the start. */
  notice: string | undefined;
  /** Called when the pool falls back after it was built. */
  onFallback: ((text: string) => void) | undefined;
  private workers: TrialPool | undefined;
  private inline: InlinePool | undefined;
  private readonly reqs = new Map<string, CompiledRequirement>();
  private closed = false;

  constructor(private readonly app: RobotApp, workers: TrialPool | undefined, notice?: string) {
    this.workers = workers;
    this.notice = notice;
    if (!workers) this.inline = new InlinePool(app);
  }

  get mode(): 'workers' | 'inline' { return this.workers ? 'workers' : 'inline'; }
  get size(): number { return this.workers ? this.workers.size : 1; }

  register(req: CompiledRequirement): void {
    this.reqs.set(req.id, req);
    this.inline?.register(req);
  }

  private keyed(spec: TrialSpec): TrialSpec {
    const req = this.reqs.get(spec.reqId);
    return req ? { ...spec, reqId: encodeReqKey(req.id, req.source) } : spec;
  }

  private static unkey(r: TrialResult): TrialResult {
    const k = decodeReqKey(r.spec.reqId);
    return k ? { ...r, spec: { ...r.spec, reqId: k.id } } : r;
  }

  async run(specs: TrialSpec[], onResult?: (r: TrialResult) => void, opts?: { signal?: AbortSignal }): Promise<TrialResult[]> {
    if (this.closed) throw new Error('The trial pool is closed');
    const w = this.workers;
    if (w) {
      let seen = 0;
      try {
        const res = await w.run(
          specs.map((s) => this.keyed(s)),
          (r) => { seen++; onResult?.(StudioPool.unkey(r)); },
          opts,
        );
        return res.map(StudioPool.unkey);
      } catch (e) {
        // A LoadError is raised before any trial ran, so no result was delivered and the run can start over.
        if (!(e instanceof Error && e.name === 'LoadError' && seen === 0 && this.workers === w && !this.closed)) throw e;
        this.fallBack(workersFailedText(e.message));
      }
    }
    return (this.inline as InlinePool).run(specs, onResult, opts);
  }

  private fallBack(text: string): void {
    const w = this.workers;
    this.workers = undefined;
    this.inline = new InlinePool(this.app);
    for (const r of this.reqs.values()) this.inline.register(r);
    if (w) void w.close().catch(() => {});
    this.onFallback?.(text);
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([this.workers?.close(), this.inline?.close()]);
  }
}

/** Builds the pool; it never throws: when Workers cannot be created the pool is the in-process one. */
export function createStudioPool(app: RobotApp, o: StudioPoolOptions): StudioPool {
  try {
    const workers = createBrowserPool({
      appId: app.id,
      config: { appModule: absoluteUrl(o.workerUrl), ...(o.assetBase !== undefined ? { assetBase: o.assetBase } : {}) },
      ...(o.entry !== undefined ? { entry: o.entry } : {}),
      ...(o.size !== undefined ? { size: o.size } : {}),
    });
    // golem-pool's TrialResult is the contract shape without the sim's add-only `hash` and `diagnostics`. The
    // sim fills both in every result a worker returns, so the studio's TrialResult describes them correctly.
    return new StudioPool(app, workers as unknown as TrialPool);
  } catch (e) {
    const noWorker = typeof (globalThis as { Worker?: unknown }).Worker === 'undefined';
    return new StudioPool(app, undefined, noWorker ? NO_WORKERS_TEXT : workersFailedText(errText(e)));
  }
}
