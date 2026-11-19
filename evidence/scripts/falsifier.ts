// Experiment 1: guided search against random-only sampling at equal trial budgets (PREREG.md).
import type { CompiledRequirement, FalsifyOptions, FalsifyResult, TrialPool } from 'golem-spec';
import { latestAttempts, recordKey, type Arm, type FalsifierRecord } from './core/falsifier-summary.js';
import { severity } from './core/severity.js';

export type FalsifyFn = (req: CompiledRequirement, pool: TrialPool, opts: FalsifyOptions) => Promise<FalsifyResult>;

export interface RunOneInput {
  app: string;
  req: Pick<CompiledRequirement, 'id' | 'space'>;
  arm: Arm;
  searchSeed: number;
  attempt: number;
  budget: number;
  falsify: FalsifyFn;
  pool: TrialPool;
  now(): number;
}

/** One falsify call, reduced to a record. Never throws: an error becomes `status: 'error'`. */
export async function runOne(i: RunOneInput): Promise<FalsifierRecord> {
  const t0 = i.now();
  const dims = i.req.space.dims;
  let sevFound: number | null = null;
  const base = { app: i.app, reqId: i.req.id, arm: i.arm, searchSeed: i.searchSeed, attempt: i.attempt, budget: i.budget };
  try {
    const res = await i.falsify(i.req as CompiledRequirement, i.pool, {
      appId: i.app,
      budget: { maxTrials: i.budget },
      searchSeed: i.searchSeed,
      mode: i.arm === 'guided' ? 'full' : 'random-only',
      onResult: (r, info) => {
        if ((info.phase === 1 || info.phase === 2) && r.robustness < 0) {
          const s = severity(dims, r.spec.scenario);
          if (sevFound === null || s < sevFound) sevFound = s;
        }
      },
    });
    const v = res.verdict;
    const cx = v.counterexample;
    const found = v.status === 'broken';
    return {
      ...base,
      status: v.status,
      found: v.status === 'error' ? null : found,
      trialsToFirst: found && cx ? cx.foundAfter : null,
      sevFound: found ? sevFound : null,
      sevShrunk: found && cx && cx.shrunk ? severity(dims, cx.scenario) : null,
      robustness: v.closest.robustness,
      closestScenario: v.closest.scenario,
      counterexample: cx ? { scenario: cx.scenario, seed: cx.seed, robustness: cx.robustness, shrunk: cx.shrunk } : null,
      trials: v.trials,
      stopReason: res.meta.stopReason,
      phaseTrials: res.meta.phaseTrials,
      errors: res.meta.errors.map((e) => e.message),
      wallMs: Math.round(i.now() - t0),
    };
  } catch (e) {
    return { ...base, status: 'error', found: null, trialsToFirst: null, sevFound: null, sevShrunk: null, robustness: null, trials: 0, wallMs: Math.round(i.now() - t0), errors: [(e as Error).message] };
  }
}

export interface PlanItem { reqId: string; arm: Arm; searchSeed: number; attempt: number }

/**
 * The runs still to do, in order: per requirement, per search seed, guided then random.
 * A key whose latest record is an error gets one more attempt (attempt 2); a key with a result is done.
 */
export function planFalsifier(reqIds: readonly string[], seeds: readonly number[], app: string, existing: readonly FalsifierRecord[]): PlanItem[] {
  const latest = new Map(latestAttempts(existing).map((r) => [recordKey(r), r]));
  const out: PlanItem[] = [];
  for (const reqId of reqIds) for (const searchSeed of seeds) for (const arm of ['guided', 'random'] as const) {
    const prev = latest.get(recordKey({ app, reqId, arm, searchSeed }));
    if (prev === undefined) out.push({ reqId, arm, searchSeed, attempt: 1 });
    else if (prev.found === null && prev.attempt < 2) out.push({ reqId, arm, searchSeed, attempt: prev.attempt + 1 });
  }
  return out;
}
export interface CampaignOptions {
  app: string;
  reqIds: string[];
  requirements: readonly CompiledRequirement[];
  seeds: number[];
  budget: number;
  falsify: FalsifyFn;
  pool: TrialPool;
  outPath: string;
  existing: FalsifierRecord[];
  append(path: string, rec: FalsifierRecord): void;
  now(): number;
  log(s: string): void;
}

/** Runs the plan and appends one record per run. Returns every record, old and new. */
export async function runCampaign(o: CampaignOptions): Promise<FalsifierRecord[]> {
  const all = [...o.existing];
  const plan = planFalsifier(o.reqIds, o.seeds, o.app, o.existing);
  o.log(`${o.app}: ${plan.length} runs to do, ${o.existing.length} records already on disk`);
  let n = 0;
  for (const item of plan) {
    const req = o.requirements.find((r) => r.id === item.reqId);
    if (!req) throw new Error(`requirement ${item.reqId} is not in the compiled file`);
    const rec = await runOne({ app: o.app, req, arm: item.arm, searchSeed: item.searchSeed, attempt: item.attempt, budget: o.budget, falsify: o.falsify, pool: o.pool, now: o.now });
    o.append(o.outPath, rec);
    all.push(rec);
    n++;
    o.log(`[${n}/${plan.length}] ${item.reqId} ${item.arm} seed ${item.searchSeed}: ${rec.status}${rec.found ? ` after ${rec.trialsToFirst} trials` : ''}, ${rec.trials} trials, ${(rec.wallMs / 1000).toFixed(1)} s`);
  }
  return all;
}