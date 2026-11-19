// Shared helpers for sim tests: fixed logged fast-check seed, run counts, failure reporting.
import type { Parameters } from 'fast-check';

const envSeed = Number.parseInt(process.env.GOLEM_SEED ?? '', 10);

/** Fixed fast-check seed. Override with GOLEM_SEED. */
export const SEED: number = Number.isFinite(envSeed) ? envSeed : 20251031;

/** Runs for properties that simulate physics (each trial is at most 2 s simulated). */
export const PHYSICS_RUNS = 25;
/** Runs for pure properties. */
export const PURE_RUNS = 100;

console.info(`[golem-sim] fast-check seed ${SEED}`);

export const physicsConfig: Parameters<unknown> = { numRuns: PHYSICS_RUNS, seed: SEED, verbose: true };
export const pureConfig: Parameters<unknown> = { numRuns: PURE_RUNS, seed: SEED, verbose: true };

/** One line that reproduces a failing trial: app id, requirement id, scenario and seed. */
export function describeTrial(spec: { app: string; reqId: string; scenario: unknown; seed: number }): string {
  return `app ${spec.app}, requirement ${spec.reqId}, scenario ${JSON.stringify(spec.scenario)}, seed ${spec.seed}`;
}

/** Runs `fn`; when it throws, rethrows with the trial description prepended. */
export async function reportFailure<T>(
  spec: { app: string; reqId: string; scenario: unknown; seed: number },
  fn: () => Promise<T> | T,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Property failed for ${describeTrial(spec)}: ${msg}`, { cause: e });
  }
}
