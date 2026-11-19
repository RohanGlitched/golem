import type { Parameters } from 'fast-check';

const envSeed = Number.parseInt(process.env.GOLEM_SEED ?? '', 10);

/** Fixed seed for property tests. Override with the GOLEM_SEED environment variable. */
export const SEED: number = Number.isFinite(envSeed) ? envSeed : 20251031;

/** 100 runs, fixed seed. */
export const propConfig: Parameters<unknown> = { numRuns: 100, seed: SEED };

/** Same as `propConfig` with another run count (for properties that spawn heavier work). */
export const runs = (n: number): Parameters<unknown> => ({ numRuns: n, seed: SEED });
