// Node adapter (golem-spec/node only): one worker_threads Worker per slot, driven by the shared TrialScheduler.
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { LoadError, errorMessage } from '../falsify/errors.js';
import type { WorkerConfig, WorkerMessage } from './protocol.js';
import { TrialScheduler, type SchedulerOptions } from './scheduler.js';
import type { PoolOptions } from './types.js';
import type { WorkerFactory, WorkerLike } from './worker-like.js';

export interface NodePoolOptions extends PoolOptions {
  appId: string;
  /** Passed to every worker. `trialModule` selects a synthetic trial function (no MuJoCo is loaded). */
  config?: WorkerConfig;
  /** The worker script. Default: the compiled `node-entry.js` next to this file. */
  entry?: string | URL;
  timers?: SchedulerOptions['timers'];
  /** Diagnostics: called with every Worker the pool creates (tests use it to check that none is left running). */
  onWorker?: (w: Worker) => void;
}

export function defaultNodePoolSize(): number {
  return Math.max(1, availableParallelism() - 1);
}

function nodeWorker(entry: string | URL, onWorker?: (w: Worker) => void): WorkerLike {
  const w = new Worker(entry);
  onWorker?.(w);
  let terminating = false;
  let crashed = false;
  const crashCbs: ((r: string) => void)[] = [];
  const crash = (reason: string): void => {
    if (terminating || crashed) return;
    crashed = true;
    for (const cb of crashCbs) cb(reason);
  };
  w.on('error', (e: unknown) => crash(`worker error: ${errorMessage(e)}`));
  w.on('exit', (code: number) => crash(`worker exited with code ${code}`));
  return {
    post(msg, transfer = []) { w.postMessage(msg, transfer); },
    onMessage(cb) { w.on('message', (m: WorkerMessage) => cb(m)); },
    onCrash(cb) { crashCbs.push(cb); },
    async terminate() {
      if (terminating) return;
      terminating = true;
      await w.terminate();
    },
  };
}

/**
 * Starts `size` workers and resolves once every one has loaded. On a load failure it terminates every
 * worker it started and rejects with a LoadError naming the worker index, with the worker's error as cause.
 */
export async function createNodePool(options: NodePoolOptions): Promise<TrialScheduler> {
  const size = options.size ?? defaultNodePoolSize();
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`size must be an integer of at least 1, got ${String(options.size)}`);
  }
  const entry = options.entry ?? new URL('./node-entry.js', import.meta.url);
  const factory: WorkerFactory = () => nodeWorker(entry, options.onWorker);
  const pool = new TrialScheduler({
    size,
    factory,
    appId: options.appId,
    config: options.config ?? {},
    ...(options.deliveryBound !== undefined ? { deliveryBound: options.deliveryBound } : {}),
    ...(options.maxRestarts !== undefined ? { maxRestarts: options.maxRestarts } : {}),
    ...(options.abortGraceMs !== undefined ? { abortGraceMs: options.abortGraceMs } : {}),
    ...(options.timers !== undefined ? { timers: options.timers } : {}),
  });
  try {
    await pool.ready;
  } catch (e) {
    await pool.close();
    if (e instanceof LoadError) throw e;
    throw new LoadError(`node pool failed to start: ${errorMessage(e)}`, { cause: e });
  }
  return pool;
}
