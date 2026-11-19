// The only file that names falsifier options (signal, seeds, onProgress, generationSize).
//
// golem-falsify is built on a parallel branch. Until it lands, `defaultFalsify` is a small
// in-process stand-in: Phase 0 re-runs pinned seeds, then Phase 1 samples the ScenarioSpace
// uniformly in Generations through the pool, and stops at the first Generation with a break or
// when the Budget is spent. It never shrinks and never claims more than it searched.
// To swap in the real falsifier, bind `defaultFalsify` to golem-falsify's `falsify()` here.
import { deriveSeed, mulberry32 } from '../core/prng.js';
import type {
  Budget, ClassifiedCounterexample, CompiledRequirement, Counterexample, FalsifyFn, Scenario, ScenarioSpace, TrialPool,
  TrialResult, TrialSpec, Verdict,
} from '../types.js';

export type { FalsifyFn };

export const DEFAULT_BUDGET: Required<Budget> = { maxTrials: 240, maxMs: 30000 };

export interface FalsifyCallOptions {
  signal?: AbortSignal | undefined;
  seeds?: Counterexample[] | undefined;
  generationSize?: number | undefined;
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
  if (o.onProgress) options.onProgress = o.onProgress;
  return fn(req, pool, budget, searchSeed, options);
}

export function abortError(): Error {
  const e = new Error('The run was cancelled');
  e.name = 'AbortError';
  return e;
}

export const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

/** A uniformly random scenario inside the space; fixed dimensions keep their value. */
export function sampleScenario(space: ScenarioSpace, rng: () => number): Scenario {
  const s: Scenario = {};
  for (const d of space.dims) s[d.name] = d.min === d.max ? d.min : d.min + rng() * (d.max - d.min);
  return s;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The in-process stand-in for golem-falsify (see the file comment). */
export const standInFalsify: FalsifyFn = async (req, pool, budget, searchSeed, options) => {
  const t0 = now();
  const maxTrials = budget.maxTrials ?? DEFAULT_BUDGET.maxTrials;
  const maxMs = budget.maxMs ?? DEFAULT_BUDGET.maxMs;
  const gen = Math.max(1, Math.min(64, options.generationSize ?? 64));
  const rng = mulberry32(deriveSeed(searchSeed, `falsify:${req.id}`));
  const signal = options.signal;
  let trials = 0, randomTrials = 0, failures = 0;
  let closest: Verdict['closest'] = { robustness: Infinity, scenario: {}, seed: 0 };
  let ce: ClassifiedCounterexample | undefined;
  const see = (r: TrialResult, random: boolean): void => {
    trials++;
    if (random) randomTrials++;
    if (r.robustness < closest.robustness || trials === 1) closest = { robustness: r.robustness, scenario: r.spec.scenario, seed: r.spec.seed };
    if (r.robustness < 0) {
      if (random) failures++;
      // The stand-in does not shrink; it keeps the mildest failure it saw (robustness closest to 0).
      if (!ce || r.robustness > ce.robustness) {
        ce = { reqId: req.id, scenario: r.spec.scenario, seed: r.spec.seed, robustness: r.robustness, shrunk: false, foundAfter: trials };
      }
    }
  };
  const check = (): void => { if (signal?.aborted) throw abortError(); };
  check();
  // Phase 0: pinned seeds first.
  const seeds = options.seeds ?? [];
  if (seeds.length > 0) {
    const specs: TrialSpec[] = seeds.map((s) => ({ app: '', reqId: req.id, scenario: s.scenario, seed: s.seed }));
    const rs = await pool.run(specs, undefined, signal ? { signal } : undefined);
    check();
    for (const r of rs) see(r, false);
    options.onProgress?.({ phase: 0, generation: 0, trials });
  }
  // Phase 1: random generations.
  for (let g = 1; !ce && trials < maxTrials && now() - t0 < maxMs; g++) {
    const n = Math.min(gen, maxTrials - trials);
    const specs: TrialSpec[] = [];
    for (let k = 0; k < n; k++) {
      const scenario = sampleScenario(req.space, rng);
      specs.push({ app: '', reqId: req.id, scenario, seed: (rng() * 0x100000000) >>> 0 });
    }
    const rs = await pool.run(specs, undefined, signal ? { signal } : undefined);
    check();
    for (const r of rs) see(r, true);
    options.onProgress?.({ phase: 1, generation: g, trials });
  }
  const v: Verdict & { counterexample?: ClassifiedCounterexample } = {
    reqId: req.id, status: ce ? 'broken' : 'held', trials, randomTrials, guidedTrials: 0,
    closest, ms: Math.round(now() - t0),
  };
  if (ce) v.counterexample = ce;
  if (failures === 0 && randomTrials > 0) v.failureRateUpper95 = Math.min(1, 3 / randomTrials);
  return v;
};

/** The falsifier the studio uses when no test hook replaces it. */
export const defaultFalsify: FalsifyFn = standInFalsify;
