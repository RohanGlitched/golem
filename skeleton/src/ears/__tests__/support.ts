import type { Parameters } from 'fast-check';

const envSeed = Number.parseInt(process.env.GOLEM_SEED ?? '', 10);

/** Fixed seed for property tests. Override with the GOLEM_SEED environment variable. */
export const SEED: number = Number.isFinite(envSeed) ? envSeed : 20251031;

/** Shared fast-check parameters: 100 runs, fixed seed, verbose output on failure. */
export const propConfig: Parameters<unknown> = {
  numRuns: 100,
  seed: SEED,
  verbose: true,
};

/**
 * Recursively freezes an object graph so tests can detect mutation. Returns the same value.
 * Typed arrays and other ArrayBuffer views are left unfrozen (JS forbids freezing views with
 * elements); the objects that contain them are frozen.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value) || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value as object)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return value;
}
