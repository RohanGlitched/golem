// The only file that names falsifier options (signal, seeds, onProgress, generationSize) and the only one
// that calls golem-falsify. `golemFalsify` maps the studio's call onto `falsify()` and its result back:
//
//   studio                                    golem-falsify
//   budget { maxTrials, maxMs }            -> budget { maxTrials, maxWallMs }
//   seeds (pinned counterexamples)         -> seedDb.read(), run first as Phase 0
//   generationSize (ghosts per generation) -> phase1GenerationSize, and the cross-entropy generation size up to 16
//   onProgress { phase, generation, trials } <- ProgressEvent, one per generation of trials
//   Verdict + counterexample.classification <- FalsifyResult.verdict + meta.classification
//
// A verdict with status 'error' is thrown as an Error that carries the reasons the falsifier recorded, so the
// studio shows them on the line instead of a bare "the run failed".
import { falsify } from '../../falsify/index.js';
import type { FalsifyOptions, PinnedSeedEntry } from '../../falsify/index.js';
import type { Budget, ClassifiedCounterexample, Counterexample, FalsifyFn, CompiledRequirement, TrialPool } from '../types.js';

export type { FalsifyFn };

export const DEFAULT_BUDGET: Required<Budget> = { maxTrials: 240, maxMs: 30000 };

/** The ghost swarm holds 64 ghosts; a larger generation would only be counted, not drawn. */
const MAX_GENERATION = 64;
/** The falsifier's own cross-entropy generation size; the studio lowers it only for a smaller swarm. */
const CEM_GENERATION = 16;

export interface FalsifyCallOptions {
  signal?: AbortSignal | undefined;
  seeds?: Counterexample[] | undefined;
  generationSize?: number | undefined;
  appId?: string | undefined;
  onProgress?: ((e: { phase: 0 | 1 | 2 | 3; generation: number; trials: number }) => void) | undefined;
}

/** Calls a falsifier with the studio's options, mapped to the falsifier's option names. */
export function callFalsify(
  fn: FalsifyFn, req: CompiledRequirement, pool: TrialPool, budget: Budget, searchSeed: number, o: FalsifyCallOptions,
): ReturnType<FalsifyFn> {
  const options: Parameters<FalsifyFn>[4] = {};
  if (o.signal) options.signal = o.signal;
  if (o.seeds && o.seeds.length > 0) options.seeds = o.seeds;
  if (o.generationSize !== undefined) options.generationSize = o.generationSize;
  if (o.appId !== undefined) options.appId = o.appId;
  if (o.onProgress) options.onProgress = o.onProgress;
  return fn(req, pool, budget, searchSeed, options);
}

export function abortError(): Error {
  const e = new Error('The run was cancelled');
  e.name = 'AbortError';
  return e;
}

export const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

/** Why a run ended as `error`, from the falsifier's recorded errors. */
function errorMessage(errors: readonly { message: string }[]): string {
  const first = errors[0]?.message ?? 'the falsifier could not complete a trial';
  return errors.length > 1 ? `${first} (and ${errors.length - 1} more)` : first;
}

/** golem-falsify, bound to the studio's call. */
export const golemFalsify: FalsifyFn = async (req, pool, budget, searchSeed, options) => {
  const gen = Math.max(1, Math.min(MAX_GENERATION, Math.floor(options.generationSize ?? MAX_GENERATION)));
  const seeds = options.seeds ?? [];
  const o: FalsifyOptions = {
    appId: options.appId ?? 'studio',
    budget: { maxTrials: budget.maxTrials ?? DEFAULT_BUDGET.maxTrials, maxWallMs: budget.maxMs ?? DEFAULT_BUDGET.maxMs },
    searchSeed: Math.floor(searchSeed) >>> 0,
    phase1GenerationSize: gen,
    cem: { generationSize: Math.min(gen, CEM_GENERATION) },
    seedDb: { read: async () => seeds.map((s): PinnedSeedEntry => ({ ...s, scenario: { ...s.scenario } })) },
  };
  if (options.signal) o.signal = options.signal;
  const progress = options.onProgress;
  if (progress) o.onProgress = (e) => progress({ phase: e.phase, generation: e.generation, trials: e.trialsUsed });
  const { verdict, meta } = await falsify(req, pool, o);
  if (verdict.status === 'error') throw new Error(errorMessage(meta.errors));
  const ce = verdict.counterexample;
  if (!ce) return verdict;
  const classified: ClassifiedCounterexample = { ...ce };
  if (meta.classification) classified.classification = meta.classification;
  return { ...verdict, counterexample: classified };
};

/** The falsifier the studio uses when no test hook replaces it. */
export const defaultFalsify: FalsifyFn = golemFalsify;
