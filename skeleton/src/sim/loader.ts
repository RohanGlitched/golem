// Loads @mujoco/mujoco once per worker (module instance). Same call in Node and the browser.
// In Vite, add `optimizeDeps.exclude: ['@mujoco/mujoco']` (a consumer concern).
import load from '@mujoco/mujoco';
import { SimError, errorMessage } from './errors.js';
import type { Mj } from './types.js';

const defaultLoad = (): Promise<Mj> => load() as Promise<Mj>;

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
