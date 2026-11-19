// Browser adapter: one module Web Worker per slot, driven by the shared TrialScheduler (Requirement 15).
import type { WorkerConfig, WorkerMessage } from './protocol.js';
import { TrialScheduler, type SchedulerOptions } from './scheduler.js';
import type { PoolOptions } from './types.js';
import type { WorkerFactory, WorkerLike } from './worker-like.js';

export interface BrowserPoolOptions extends PoolOptions {
  appId: string;
  /** Passed to every worker. `assetBase` is the only URL the worker fetches from. */
  config?: WorkerConfig;
  /** The worker script. Default: the compiled `browser-entry.js` next to this file. */
  entry?: string | URL;
  timers?: SchedulerOptions['timers'];
}

const MAX_BROWSER_WORKERS = 8;

/** `hardwareConcurrency - 1` clamped to 1..8, or 1 when the value is not a positive integer. */
export function defaultBrowserPoolSize(): number {
  const hc = (globalThis as { navigator?: { hardwareConcurrency?: unknown } }).navigator?.hardwareConcurrency;
  if (typeof hc !== 'number' || !Number.isInteger(hc) || hc < 1) return 1;
  return Math.min(MAX_BROWSER_WORKERS, Math.max(1, hc - 1));
}

interface WorkerCtor {
  new (url: string | URL, opts: { type: 'module'; name?: string }): BrowserWorker;
}
interface BrowserWorker {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message' | 'error' | 'messageerror', cb: (e: { data?: unknown; message?: string }) => void): void;
  terminate(): void;
}

function browserWorker(Ctor: WorkerCtor, entry: string | URL, slot: number, generation: number): WorkerLike {
  const w = new Ctor(entry, { type: 'module', name: `golem-${slot}-${generation}` });
  let terminated = false;
  let crashed = false;
  const crashCbs: ((r: string) => void)[] = [];
  const crash = (reason: string): void => {
    if (terminated || crashed) return;
    crashed = true;
    for (const cb of crashCbs) cb(reason);
  };
  w.addEventListener('error', (e) => crash(`worker error: ${e.message ?? 'unknown error'}`));
  w.addEventListener('messageerror', () => crash('worker message could not be deserialised'));
  return {
    post(msg, transfer = []) { w.postMessage(msg, transfer); },
    onMessage(cb) { w.addEventListener('message', (e) => { if (!terminated) cb(e.data as WorkerMessage); }); },
    onCrash(cb) { crashCbs.push(cb); },
    terminate() {
      if (!terminated) { terminated = true; w.terminate(); }
      return Promise.resolve();
    },
  };
}

/**
 * Creates the pool at once. Workers load in the background; a load failure makes `run` reject with
 * an error that includes the worker's message.
 */
export function createBrowserPool(options: BrowserPoolOptions): TrialScheduler {
  let size: number;
  if (options.size === undefined) {
    size = defaultBrowserPoolSize();
  } else {
    size = options.size;
    if (!Number.isInteger(size) || size < 1 || size > MAX_BROWSER_WORKERS) {
      throw new RangeError(`size must be an integer from 1 to ${MAX_BROWSER_WORKERS}, got ${String(options.size)}`);
    }
  }
  const Ctor = (globalThis as { Worker?: WorkerCtor }).Worker;
  if (Ctor === undefined) throw new Error('createBrowserPool needs a global Worker (run it in a browser)');
  const entry = options.entry ?? new URL('./browser-entry.js', import.meta.url);
  const factory: WorkerFactory = (slot, generation) => browserWorker(Ctor, entry, slot, generation);
  return new TrialScheduler({
    size,
    factory,
    appId: options.appId,
    config: options.config ?? {},
    ...(options.deliveryBound !== undefined ? { deliveryBound: options.deliveryBound } : {}),
    ...(options.maxRestarts !== undefined ? { maxRestarts: options.maxRestarts } : {}),
    ...(options.abortGraceMs !== undefined ? { abortGraceMs: options.abortGraceMs } : {}),
    ...(options.timers !== undefined ? { timers: options.timers } : {}),
  });
}
