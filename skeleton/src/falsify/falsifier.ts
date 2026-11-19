// The falsifier: Phase 0 (pinned seeds), Phase 1 (Latin hypercube), Phase 2 (cross-entropy),
// Phase 3 (shrink and classify). It never writes the seed database (design D2) and never calls
// Math.random(); every random choice comes from mulberry32 streams derived from the search seed.
import { BudgetClock, validateBudget, type SearchPhase } from './budget.js';
import { clopperPearsonUpper, failureRateUpper95 } from './beta.js';
import {
  initCem, refitCem, sampleGeneration, validateCemParams, type CemParams, type CemState, type DimDist, type Observed,
} from './cem.js';
import { classify, verificationSeeds } from './classify.js';
import type {
  Counterexample, FalsifiableRequirement, Scenario, TrialPool, TrialResult, TrialSpec, Verdict,
} from './contract.js';
import { AbortError, errorMessage } from './errors.js';
import { latinHypercube } from './lhs.js';
import { deriveSeed, SALT } from './prng.js';
import { ProgressEmitter, safeInvoke } from './progress.js';
import { shrink, type ShrinkTrialOutcome } from './shrink.js';
import type {
  CemDimInfo, FalsifyOptions, FalsifyResult, PinnedSeedEntry, ReplayOptions, ResolvedConfig, ResultInfo, RunMetadata,
} from './types.js';

interface Completed { phase: 0 | 1 | 2 | 3; scenario: Scenario; seed: number; robustness: number; run: number }

/** Default share of the trial budget (and of the wall time) given to the Phase 1 Latin hypercube. */
export const DEFAULT_PHASE1_FRACTION = 0.2;

function isAbortLike(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

function resolveConfig(o: FalsifyOptions): { cfg: ResolvedConfig; randomOnly: boolean } {
  if (typeof o.appId !== 'string' || o.appId.length === 0) throw new RangeError('appId must be a non-empty string');
  if (!Number.isInteger(o.searchSeed) || o.searchSeed < 0 || o.searchSeed > 0xffffffff) {
    throw new RangeError(`searchSeed must be an integer in [0, 2^32), got ${String(o.searchSeed)}`);
  }
  const mode = o.mode ?? 'full';
  if (mode !== 'full' && mode !== 'random-only') throw new RangeError(`mode must be 'full' or 'random-only', got ${String(mode)}`);
  // 0.2 since golem-falsify-hardening item E (docs/reviews/falsify-hardening.md): at equal budgets it finds
  // needles at least as often as 0.4 and sooner; the cost is a looser failureRateUpper95 (fewer random trials).
  const f1 = o.phase1Fraction ?? DEFAULT_PHASE1_FRACTION;
  const f2 = o.phase2Fraction ?? Math.max(0, 1 - f1);
  validateBudget(o.budget, f1, f2);
  const g1 = o.phase1GenerationSize ?? 32;
  if (!Number.isInteger(g1) || g1 < 1) throw new RangeError(`phase1GenerationSize must be a positive integer, got ${String(g1)}`);
  const maxPinned = o.maxPinned ?? Infinity;
  if (!(maxPinned === Infinity || (Number.isInteger(maxPinned) && maxPinned >= 0))) {
    throw new RangeError(`maxPinned must be a non-negative integer, got ${String(o.maxPinned)}`);
  }
  const sh = { tolerance: 0.01, maxTrials: 60, reserveFraction: 0.15, reserveMin: 12, ...stripUndefined(o.shrink ?? {}) };
  if (!(sh.tolerance > 0 && sh.tolerance < 1)) throw new RangeError(`shrink.tolerance must be in (0, 1), got ${String(sh.tolerance)}`);
  if (!Number.isInteger(sh.maxTrials) || sh.maxTrials < 1) throw new RangeError(`shrink.maxTrials must be an integer of at least 1, got ${String(sh.maxTrials)}`);
  if (!(sh.reserveFraction >= 0 && sh.reserveFraction <= 1)) throw new RangeError(`shrink.reserveFraction must be in [0, 1], got ${String(sh.reserveFraction)}`);
  if (!Number.isInteger(sh.reserveMin) || sh.reserveMin < 0) throw new RangeError(`shrink.reserveMin must be a non-negative integer, got ${String(sh.reserveMin)}`);
  const cem = { generationSize: 32, eliteFraction: 0.25, smoothing: 1, lhsFraction: 0.2, ...stripUndefined(o.cem ?? {}) };
  const randomOnly = mode === 'random-only';
  return {
    randomOnly,
    cfg: {
      phase1Fraction: randomOnly ? 1 : f1,
      phase2Fraction: randomOnly ? 0 : f2,
      phase1GenerationSize: g1,
      maxPinned: maxPinned === Infinity ? null : maxPinned,
      cem,
      shrink: sh,
    },
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

function pinnedProblem(space: FalsifiableRequirement['space'], reqId: string, e: PinnedSeedEntry): string | undefined {
  if (e.reqId !== reqId) return `reqId "${e.reqId}" does not match requirement "${reqId}"`;
  const names = new Set(space.dims.map((d) => d.name));
  for (const k of Object.keys(e.scenario)) {
    if (!names.has(k)) return `dimension "${k}" is not in the scenario space`;
  }
  for (const d of space.dims) {
    const v = e.scenario[d.name];
    if (v === undefined) return `dimension "${d.name}" is missing`;
    if (!(v >= d.min && v <= d.max)) return `${d.name}=${v} is outside [${d.min}, ${d.max}]`;
  }
  return undefined;
}

/**
 * Options that rerun a finished run trial for trial without a clock (golem-falsify-hardening 5.3).
 * Every generation but the last of a phase is full size in both runs, and the last is the prefix of
 * the same full-size draw, so fixing the per-phase trial counts reproduces the run.
 */
function replayOptionsOf(appId: string, searchSeed: number, meta: RunMetadata, cfg: ResolvedConfig): ReplayOptions {
  const { p0, p1, p2 } = meta.phaseTrials;
  const T = p0 + p1 + p2;
  const k = meta.p3Detail.shrink;
  const shrinkRan = meta.verification !== undefined || k > 0;
  return {
    appId,
    budget: { maxTrials: Math.max(1, T) },
    searchSeed,
    mode: meta.mode,
    phase1Fraction: T > 0 ? p1 / T : 0,
    phase2Fraction: T > 0 ? p2 / T : 0,
    phase1GenerationSize: cfg.phase1GenerationSize,
    maxPinned: p0,
    cem: { ...cfg.cem },
    shrink: shrinkRan
      ? { tolerance: cfg.shrink.tolerance, maxTrials: Math.max(1, k), reserveFraction: 0, reserveMin: k }
      : { ...cfg.shrink },
  };
}

/** The Phase 2 distribution as shown in progress events (golem-falsify-hardening 10.5). */
function cemInfo(space: FalsifiableRequirement['space'], state: CemState): CemDimInfo[] {
  return space.dims.map((d, i) => {
    const dist = state.dists[i] as DimDist;
    const ms = dist.kind === 'normal' || dist.kind === 'wrapped' ? { mu: dist.mu, sigma: dist.sigma } : { mu: null, sigma: null };
    return { name: d.name, kind: dist.kind, ...ms };
  });
}

function sameSpec(a: TrialSpec, b: TrialSpec): boolean {
  if (a === b) return true;
  if (a.seed !== b.seed || a.reqId !== b.reqId || a.app !== b.app) return false;
  const ka = Object.keys(a.scenario);
  return ka.length === Object.keys(b.scenario).length && ka.every((k) => a.scenario[k] === b.scenario[k]);
}

export async function falsify(
  req: FalsifiableRequirement, pool: TrialPool, opts: FalsifyOptions,
): Promise<FalsifyResult> {
  const { cfg, randomOnly } = resolveConfig(opts);
  const { appId, searchSeed, signal } = opts;
  const space = req.space;
  const now = opts.clock ?? (() => performance.now());
  const budget = new BudgetClock(opts.budget, {
    phase1Fraction: cfg.phase1Fraction,
    phase2Fraction: cfg.phase2Fraction,
    randomOnly,
    reserveFraction: cfg.shrink.reserveFraction,
    reserveMin: cfg.shrink.reserveMin,
  }, now);
  const aborted = (): boolean => signal?.aborted === true;
  const abortError = (cause?: unknown): AbortError => new AbortError('falsification aborted', cause === undefined ? undefined : { cause });
  if (aborted()) throw abortError();
  budget.start();
  const emitter = new ProgressEmitter(opts.onProgress);

  const meta: RunMetadata = {
    app: appId, reqId: req.id, mode: randomOnly ? 'random-only' : 'full', budget: { ...opts.budget }, searchSeed,
    config: cfg,
    phaseTrials: { p0: 0, p1: 0, p2: 0, p3: 0 }, p3Detail: { shrink: 0, verification: 0 },
    shrinkReserve: budget.shrinkReserve, stopReason: 'completed', budgetExhausted: false,
    resolvedPinned: [], skippedPinned: [], skippedSeedFiles: [], pinnedNotRun: 0, errors: [],
    replayOptions: undefined as unknown as RunMetadata['replayOptions'], // set before returning
  };

  // ---- run state
  let trialsRun = 0;
  const completed: Completed[] = [];
  let lowest = Infinity;
  let closest: Verdict['closest'] | undefined;
  let errorSeen = false;
  let firstFailAt = 0; // foundAfter
  const failures: Completed[] = [];
  let phase1Done = 0;
  let phase1Failed = 0;
  const phase1Obs: Observed[] = [];

  const used = (): number => trialsRun;
  const remaining = (): number | null => {
    const r = budget.maxTrials === null ? null : Math.max(0, budget.maxTrials - used());
    return r;
  };
  const emit = (
    phase: 0 | 1 | 2 | 3, generation: number,
    got: { scenarios: Scenario[]; seeds: number[]; robustness: number[] }, cem?: CemDimInfo[],
  ): void => {
    if (aborted()) { emitter.stop(); throw abortError(); }
    const elapsedMs = budget.elapsedMs();
    emitter.emit({
      phase, generation, scenarios: got.scenarios, seeds: got.seeds, robustness: got.robustness,
      lowestRobustness: lowest, trialsUsed: used(), trialsRemaining: remaining(),
      elapsedMs, timeFraction: budget.maxWallMs === null ? null : elapsedMs / budget.maxWallMs,
      ...(cem !== undefined ? { cem } : {}),
    });
  };

  const note = (phase: 0 | 1 | 2 | 3, spec: TrialSpec, r: TrialResult): void => {
    trialsRun++;
    if (phase !== 3) meta.phaseTrials[`p${phase}` as 'p0' | 'p1' | 'p2'] += 1;
    if (Number.isNaN(r.robustness)) {
      if (phase !== 3) errorSeen = true;
      meta.errors.push({ phase, message: `trial returned NaN robustness (seed ${spec.seed})`, seed: spec.seed });
      return;
    }
    const c: Completed = { phase, scenario: spec.scenario, seed: spec.seed, robustness: r.robustness, run: trialsRun };
    completed.push(c);
    if (closest === undefined || r.robustness < closest.robustness) {
      closest = { robustness: r.robustness, scenario: { ...spec.scenario }, seed: spec.seed };
    }
    // Math.min semantics: -0 is below 0 (golem-falsify-hardening 10.8)
    if (r.robustness < lowest || (r.robustness === 0 && lowest === 0 && Object.is(r.robustness, -0))) lowest = r.robustness;
    if (r.robustness < 0 && phase !== 3) {
      if (failures.length === 0) firstFailAt = trialsRun;
      failures.push(c);
    }
  };

  /**
   * Runs one batch. Throws AbortError on abort. Returns results aligned to specs (undefined = no result).
   * `where` labels the results passed to `opts.onResult` (phase, generation, index of the first spec).
   */
  const runBatch = async (
    specs: TrialSpec[], where: { phase: 0 | 1 | 2 | 3; generation: number; offset: number },
  ): Promise<{ results: (TrialResult | undefined)[]; rejected?: unknown }> => {
    if (aborted()) { emitter.stop(); throw abortError(); }
    const received: TrialResult[] = [];
    const byIdentity = new Map<TrialSpec, number>(specs.map((s, k) => [s, k]));
    const told = new Set<number>();
    const userCb = opts.onResult;
    const forward = (r: TrialResult): void => {
      received.push(r);
      if (userCb === undefined) return;
      let k = byIdentity.get(r.spec);
      if (k === undefined || told.has(k)) k = specs.findIndex((s, j) => !told.has(j) && sameSpec(s, r.spec));
      if (k >= 0) told.add(k);
      const info: ResultInfo = { phase: where.phase, generation: where.generation, index: where.offset + Math.max(0, k) };
      safeInvoke((x: TrialResult) => userCb(x, info), r);
    };
    try {
      const res = await pool.run(specs, forward, signal === undefined ? undefined : { signal });
      if (aborted()) { emitter.stop(); throw abortError(); }
      if (res.length !== specs.length) throw new Error(`pool returned ${res.length} results for ${specs.length} trials`);
      return { results: res };
    } catch (e) {
      if (e instanceof AbortError && aborted()) throw e;
      if (isAbortLike(e) || aborted()) { emitter.stop(); throw abortError(e); }
      const aligned: (TrialResult | undefined)[] = specs.map(() => undefined);
      for (const r of received) {
        const i = specs.findIndex((s, k) => aligned[k] === undefined && sameSpec(s, r.spec));
        if (i >= 0) aligned[i] = r;
      }
      return { results: aligned, rejected: e };
    }
  };

  /** Ingests a batch in input order. Returns arrays for the progress event and whether the batch had an error. */
  const ingest = (
    phase: 0 | 1 | 2 | 3, specs: TrialSpec[], b: { results: (TrialResult | undefined)[]; rejected?: unknown },
  ): { scenarios: Scenario[]; seeds: number[]; robustness: number[]; error: boolean; failed: boolean } => {
    const scenarios: Scenario[] = [];
    const seeds: number[] = [];
    const robustness: number[] = [];
    let error = false;
    let failed = false;
    let blamed = false;
    specs.forEach((spec, k) => {
      const r = b.results[k];
      if (r !== undefined) {
        const before = failures.length;
        note(phase, spec, r);
        scenarios.push({ ...spec.scenario });
        seeds.push(spec.seed);
        robustness.push(r.robustness);
        if (Number.isNaN(r.robustness)) error = true;
        if (failures.length > before) failed = true;
      } else if (b.rejected !== undefined && !blamed) {
        blamed = true;
        error = true;
        trialsRun++;
        if (phase !== 3) { meta.phaseTrials[`p${phase}` as 'p0' | 'p1' | 'p2'] += 1; errorSeen = true; }
        meta.errors.push({ phase, message: errorMessage(b.rejected), seed: spec.seed });
        scenarios.push({ ...spec.scenario });
        seeds.push(spec.seed);
        robustness.push(NaN);
      }
    });
    if (b.rejected !== undefined && !blamed) {
      error = true;
      if (phase !== 3) errorSeen = true;
      meta.errors.push({ phase, message: errorMessage(b.rejected) });
    }
    return { scenarios, seeds, robustness, error, failed };
  };

  const specFor = (scenario: Scenario, seed: number): TrialSpec => ({ app: appId, reqId: req.id, scenario, seed });
  const countOf = (b: { results: (TrialResult | undefined)[]; rejected?: unknown }): number =>
    b.results.filter((r) => r !== undefined).length + (b.rejected !== undefined && b.results.some((r) => r === undefined) ? 1 : 0);

  // ---- wall-time estimate (golem-falsify-hardening defect 4): only read the clock under a wall limit
  const timed = budget.maxWallMs !== null;
  const poolSize = Number.isInteger(pool.size) && pool.size >= 1 ? pool.size : 1;
  type Where = Parameters<typeof runBatch>[1];
  const measured = async (specs: TrialSpec[], where: Where): Promise<Awaited<ReturnType<typeof runBatch>>> => {
    if (!timed) return runBatch(specs, where);
    const t0 = now();
    const b = await runBatch(specs, where);
    budget.observe(countOf(b), now() - t0, poolSize);
    return b;
  };

  type Batch = Awaited<ReturnType<typeof runBatch>>;
  type Ingested = ReturnType<typeof ingest>;
  /**
   * Runs one generation of `specs` (already granted). Without a wave estimate under a wall limit, the
   * first wave runs alone so the rest of the generation can be granted by the time left. Returns the
   * specs that ran, their aligned results, the ingest summary and whether time cut the generation.
   */
  const runGeneration = async (
    phase: 1 | 2, generation: number, specs: TrialSpec[], timeLimited: boolean,
  ): Promise<{ ran: TrialSpec[]; results: (TrialResult | undefined)[]; got: Ingested; timeLimited: boolean }> => {
    const split = timed && budget.waveMs() === null && specs.length > poolSize;
    const first = split ? specs.slice(0, poolSize) : specs;
    const b1: Batch = await measured(first, { phase, generation, offset: 0 });
    budget.record(phase, countOf(b1));
    const got1 = ingest(phase, first, b1);
    if (!split || got1.error || got1.failed) {
      return { ran: first, results: b1.results, got: got1, timeLimited: timeLimited || (split && first.length < specs.length) };
    }
    const wanted = specs.length - first.length;
    const n2 = budget.grant(phase, wanted, poolSize);
    const cut = budget.lastGrantTimeLimited || n2 < wanted;
    const second = specs.slice(first.length, first.length + n2);
    if (second.length === 0) return { ran: first, results: b1.results, got: got1, timeLimited: true };
    const b2: Batch = await measured(second, { phase, generation, offset: first.length });
    budget.record(phase, countOf(b2));
    const got2 = ingest(phase, second, b2);
    return {
      ran: [...first, ...second],
      results: [...b1.results, ...b2.results],
      got: {
        scenarios: [...got1.scenarios, ...got2.scenarios],
        seeds: [...got1.seeds, ...got2.seeds],
        robustness: [...got1.robustness, ...got2.robustness],
        error: got2.error, failed: got2.failed,
      },
      timeLimited: timeLimited || cut,
    };
  };

  // =========================================================== Phase 0
  let seeds: PinnedSeedEntry[] = [];
  if (opts.seedDb !== undefined) {
    try {
      seeds = await opts.seedDb.read(appId, req.id);
    } catch (e) {
      const db = opts.seedDb as { pathFor?: (a: string, r: string) => string };
      let path = `${appId}/${req.id}`;
      try { path = db.pathFor?.(appId, req.id) ?? path; } catch { /* keep default */ }
      meta.skippedSeedFiles.push({ path, reason: errorMessage(e) });
      seeds = [];
    }
  }
  const valid: PinnedSeedEntry[] = [];
  seeds.forEach((e, index) => {
    const problem = pinnedProblem(space, req.id, e);
    if (problem === undefined) valid.push(e); else meta.skippedPinned.push({ index, reason: problem });
  });
  const ordered = valid.map((e, i) => ({ e, i })).sort((a, b) => a.e.robustness - b.e.robustness || a.i - b.i).map((x) => x.e);
  const p0Scenarios: Scenario[] = [];
  const p0Seeds: number[] = [];
  const p0Robustness: number[] = [];
  let p0Error = false;
  let ranP0 = 0;
  for (const e of ordered) {
    if (aborted()) { emitter.stop(); throw abortError(); }
    if (cfg.maxPinned !== null && ranP0 >= cfg.maxPinned) break;
    if (budget.grant(0, 1) === 0) break;
    const spec = specFor({ ...e.scenario }, e.seed);
    const b = await measured([spec], { phase: 0, generation: 0, offset: ranP0 });
    budget.record(0, countOf(b) || 1);
    ranP0++;
    const got = ingest(0, [spec], b);
    p0Scenarios.push(...got.scenarios);
    p0Seeds.push(...got.seeds);
    p0Robustness.push(...got.robustness);
    if (got.error) { p0Error = true; continue; }
    const r = got.robustness[0] as number;
    if (r >= 0) meta.resolvedPinned.push({ scenario: { ...spec.scenario }, seed: spec.seed, robustness: r });
    if (got.failed) break;
  }
  meta.pinnedNotRun = ordered.length - ranP0;
  emit(0, 0, { scenarios: p0Scenarios, seeds: p0Seeds, robustness: p0Robustness });

  // =========================================================== Phase 1
  const fixedOnly = space.dims.every((d) => d.min === d.max);
  if (failures.length === 0 && !p0Error) {
    let g = 0;
    let i1 = 0;
    for (;;) {
      if (aborted()) { emitter.stop(); throw abortError(); }
      const size = budget.grant(1, cfg.phase1GenerationSize, poolSize);
      if (size === 0) break;
      const cutByTime = budget.lastGrantTimeLimited;
      // the generation prefix: a shortened generation is the start of the full-size hypercube (5.5)
      const scenarios = latinHypercube(space, cfg.phase1GenerationSize, searchSeed, g).slice(0, size);
      const specs = scenarios.map((s, k) => specFor(s, deriveSeed(searchSeed, SALT.phase1, i1 + k)));
      const gen = await runGeneration(1, g, specs, cutByTime);
      const got = gen.got;
      gen.results.forEach((r, k) => {
        if (r === undefined || Number.isNaN(r.robustness)) return;
        phase1Done++;
        if (r.robustness < 0) phase1Failed++;
        phase1Obs.push({ scenario: gen.ran[k]!.scenario, robustness: r.robustness, index: i1 + k });
      });
      emit(1, g, got);
      if (got.error || got.failed || gen.timeLimited) break;
      g++;
      i1 += gen.ran.length;
    }
  }

  // =========================================================== Phase 2
  if (!randomOnly && failures.length === 0 && !errorSeen && !fixedOnly && budget.grant(2, 1) > 0) {
    const params: CemParams = {
      genSize: cfg.cem.generationSize, eliteFraction: cfg.cem.eliteFraction, smoothing: cfg.cem.smoothing,
      lhsFraction: cfg.cem.lhsFraction,
    };
    const problem = validateCemParams(params);
    if (problem !== undefined) {
      errorSeen = true;
      meta.errors.push({ phase: 2, message: problem });
    } else {
      let state = initCem(space, phase1Obs, params);
      const runOffset = phase1Obs.reduce((m, o) => Math.max(m, o.index + 1), 0);
      let g = 0;
      let i2 = 0;
      for (;;) {
        if (aborted()) { emitter.stop(); throw abortError(); }
        const size = budget.grant(2, params.genSize, poolSize);
        if (size === 0) break;
        const cutByTime = budget.lastGrantTimeLimited;
        const scenarios = sampleGeneration(space, state, params.genSize, size, params.lhsFraction, searchSeed, g);
        const specs = scenarios.map((s, k) => specFor(s, deriveSeed(searchSeed, SALT.phase2, i2 + k)));
        const gen = await runGeneration(2, g, specs, cutByTime);
        const got = gen.got;
        emit(2, g, got, cemInfo(space, state));
        if (got.error || got.failed || gen.timeLimited) break;
        const obs: Observed[] = gen.ran.map((s, k) => ({
          scenario: s.scenario, robustness: (gen.results[k] as TrialResult).robustness, index: runOffset + i2 + k,
        }));
        state = refitCem(space, state, obs, params);
        g++;
        i2 += gen.ran.length;
      }
    }
  }

  // =========================================================== Phase 3
  let counterexample: Counterexample | undefined;
  let pinEntry: PinnedSeedEntry | undefined;
  if (failures.length > 0) {
    let pick = failures[0] as Completed;
    for (const f of failures) if (f.robustness < pick.robustness) pick = f;
    counterexample = {
      reqId: req.id, scenario: { ...pick.scenario }, seed: pick.seed, robustness: pick.robustness,
      shrunk: false, foundAfter: firstFailAt,
    };
    if (!errorSeen) {
      const p3Scen: Scenario[] = [];
      const p3Seeds: number[] = [];
      const p3Rob: number[] = [];
      let abortedInShrink = false;
      const outcome = await shrink(
        { scenario: pick.scenario, seed: pick.seed, robustness: pick.robustness }, space,
        (cand): Promise<ShrinkTrialOutcome> | null => {
          if (abortedInShrink || aborted()) return null;
          if (budget.grantShrink() === 0) return null;
          return (async (): Promise<ShrinkTrialOutcome> => {
            const spec = specFor(cand, pick.seed);
            let b: Awaited<ReturnType<typeof runBatch>>;
            try {
              b = await measured([spec], { phase: 3, generation: 0, offset: meta.p3Detail.shrink });
            } catch (e) {
              if (e instanceof AbortError) { abortedInShrink = true; return { error: 'aborted' }; }
              throw e;
            }
            budget.recordShrink(1);
            meta.p3Detail.shrink++;
            meta.phaseTrials.p3++;
            const got = ingest(3, [spec], b);
            p3Scen.push(...got.scenarios);
            p3Seeds.push(...got.seeds);
            p3Rob.push(...got.robustness);
            const r = b.results[0];
            if (r === undefined) return { error: errorMessage(b.rejected) };
            return { robustness: r.robustness };
          })();
        },
        { tolerance: cfg.shrink.tolerance, maxTrials: cfg.shrink.maxTrials },
      );
      if (abortedInShrink || aborted()) { emitter.stop(); throw abortError(); }
      counterexample = {
        ...counterexample, scenario: { ...outcome.scenario }, robustness: outcome.robustness, shrunk: outcome.shrunk,
      };
      for (const m of outcome.errors) meta.errors.push({ phase: 3, message: `shrink trial: ${m}` });

      // Verification: always runs, even with the budget gone. The label comes from the original
      // failure (where the search found it); the shrunk point, whose margin is about 0, is checked
      // separately and reported as `boundarySensitive` (golem-falsify-hardening defect 1).
      const vSeeds = verificationSeeds(searchSeed, pick.seed);
      const origScenario = { ...pick.scenario };
      const shrunkScenario = { ...counterexample!.scenario };
      const needBoundary = space.dims.some((d) => shrunkScenario[d.name] !== origScenario[d.name]);
      const vSpecs = vSeeds.map((s) => specFor({ ...origScenario }, s));
      const bSpecs = needBoundary ? vSeeds.map((s) => specFor({ ...shrunkScenario }, s)) : [];
      const allSpecs = [...vSpecs, ...bSpecs];
      const vb = await runBatch(allSpecs, { phase: 3, generation: 1, offset: 0 });
      const vGot = ingest(3, allSpecs, vb);
      meta.p3Detail.verification += vGot.scenarios.length;
      meta.phaseTrials.p3 += vGot.scenarios.length;
      p3Scen.push(...vGot.scenarios);
      p3Seeds.push(...vGot.seeds);
      p3Rob.push(...vGot.robustness);
      const robAt = (k: number): number | null => {
        const r = vb.results[k];
        return r === undefined || Number.isNaN(r.robustness) ? null : r.robustness;
      };
      const errorsFor = (specs: TrialSpec[], offset: number): string[] => {
        const out: string[] = [];
        specs.forEach((s, k) => {
          if (robAt(offset + k) === null) out.push(`seed ${s.seed}: ${vb.rejected !== undefined ? errorMessage(vb.rejected) : 'NaN robustness'}`);
        });
        return out;
      };
      const vRob = vSpecs.map((_, k) => robAt(k));
      const cls = classify(vRob);
      if (cls !== undefined) meta.classification = cls;
      meta.verification = { scenario: origScenario, seeds: [...vSeeds], robustness: vRob, errors: errorsFor(vSpecs, 0) };
      let boundarySensitive: boolean | undefined;
      if (needBoundary) {
        const bRob = bSpecs.map((_, k) => robAt(vSpecs.length + k));
        meta.boundaryVerification = {
          scenario: shrunkScenario, seeds: [...vSeeds], robustness: bRob, errors: errorsFor(bSpecs, vSpecs.length),
        };
        const bCls = classify(bRob);
        if (bCls !== undefined) boundarySensitive = bCls === 'seed-sensitive';
      } else if (cls !== undefined) {
        boundarySensitive = cls === 'seed-sensitive';
      }
      if (boundarySensitive !== undefined) meta.boundarySensitive = boundarySensitive;
      emit(3, 0, { scenarios: p3Scen, seeds: p3Seeds, robustness: p3Rob });
      pinEntry = {
        ...counterexample,
        ...(cls !== undefined ? { classification: cls } : {}),
        ...(boundarySensitive !== undefined ? { boundarySensitive } : {}),
        verificationSeeds: [...vSeeds],
        verificationRobustness: vRob,
      };
    }
    if (pinEntry === undefined) pinEntry = { ...counterexample };
  }

  // =========================================================== verdict
  const broken = failures.length > 0;
  const status: Verdict['status'] = broken ? 'broken' : errorSeen || completed.length === 0 ? 'error' : 'held';
  if (!broken && completed.length === 0 && meta.errors.length === 0) {
    meta.errors.push({ phase: 1, message: 'no trial completed: the budget ended before any trial ran' });
  }
  const trialsExhausted = budget.trialsExhausted();
  const timeUp = budget.maxWallMs !== null && (budget.timeStopped || budget.elapsedMs() >= budget.maxWallMs);
  meta.budgetExhausted = trialsExhausted || timeUp;
  meta.stopReason = broken ? 'failure-found' : status === 'error' && errorSeen ? 'error'
    : timeUp ? 'time-budget' : trialsExhausted ? 'trial-budget' : 'completed';
  meta.replayOptions = replayOptionsOf(appId, searchSeed, meta, cfg);

  const verdict: Verdict = {
    reqId: req.id,
    status,
    trials: trialsRun,
    randomTrials: meta.phaseTrials.p1,
    guidedTrials: meta.phaseTrials.p2,
    closest: closest ?? { robustness: Infinity, scenario: {}, seed: 0 },
    ms: budget.elapsedMs(),
  };
  const rate = failureRateUpper95(phase1Done, phase1Failed);
  if (rate !== undefined) {
    verdict.failureRateUpper95 = rate;
    // exact one-sided 95% Clopper-Pearson beside the rule of three (golem-falsify-hardening item C)
    verdict.failureRateUpper95Exact = clopperPearsonUpper(phase1Done, phase1Failed, 0.95);
  }
  if (counterexample !== undefined) verdict.counterexample = counterexample;
  const result: FalsifyResult = { verdict, meta };
  if (pinEntry !== undefined) result.pinEntry = pinEntry;
  return result;
}

