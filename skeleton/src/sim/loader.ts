// Loads @mujoco/mujoco once per worker (module instance). Same call in Node and the browser.
// In Vite, add `optimizeDeps.exclude: ['@mujoco/mujoco']` (a consumer concern).
import load from '@mujoco/mujoco';
import { SimError, errorMessage } from './errors.js';
import type { Mj } from './types.js';

/**
 * Emscripten prints "still waiting on run dependencies" (with "dependency: wasm-instantiate" and "(end of list)") to
 * stderr every few seconds while a cold WASM download is in flight. That is progress, not an error, so it is dropped;
 * everything else MuJoCo prints to stderr still goes to console.error.
 */
export function isLoadProgressNoise(text: string): boolean {
  return /^(still waiting on run dependencies:|dependency: wasm-instantiate|\(end of list\))/.test(text.trim());
}
const printErr = (text: string): void => { if (!isLoadProgressNoise(text)) console.error(text); };

const defaultLoad = (): Promise<Mj> => (load as unknown as (opts: object) => Promise<Mj>)({ printErr });

let loadFn: () => Promise<Mj> = defaultLoad;
let inflight: Promise<Mj> | undefined;

export function loadMujoco(): Promise<Mj> {
  if (inflight) return inflight;
  const p: Promise<Mj> = Promise.resolve()
    .then(() => loadFn())
    .catch((cause: unknown) => {
      // Clear before any waiter sees the rejection, so a retry from a catch block starts anew.
      if (inflight === p) inflight = undefined;
      throw new SimError(`Failed to load @mujoco/mujoco: ${errorMessage(cause)}`, { cause });
    });
  inflight = p;
  return p;
}
/** Test seam: replaces the load function and clears the memo. Not exported from index.ts. */
export function __setLoadFnForTests(fn: (() => Promise<Mj>) | undefined): void {
  loadFn = fn ?? defaultLoad;
  inflight = undefined;
}
