// Shared by `run_requirement` and `falsify`: one falsification at a time, pin and report before returning,
// and a partial verdict built from the trial stream when the time cap ends the run (assumption A12).
import { expectationMiss, expectationTag, type Expectation } from '../../cli/expectation.js';
import { formatMargin, formatScenario, heldText } from '../../cli/format.js';
import { writeRunReport } from '../../cli/service.js';
import type { RequirementOutcome, RunOptions } from '../../cli/types.js';
import { runRequirements } from '../../cli/service.js';
import { makeToolResult, type ToolResult } from '../result.js';
import type { ToolCtx } from '../schema.js';
import { errorResult, findRequirement } from './util.js';

interface Seen { trials: number; lowest: number; scenario: Record<string, number>; seed: number; unit: string | undefined }

/**
 * The verdict sentence. With a row in the Expectation table the tag follows the status word (`1.3 broken [Expected_Hold: NOT met]: ...`),
 * so the 200-character summary limit cannot cut it off; a held line that was meant to break also says why at the end.
 */
export function verdictSummary(o: RequirementOutcome, expectation?: Expectation): string {
  if (expectation === undefined) return verdictSentence(o, true);
  const miss = expectationMiss(o.verdict.status, expectation, o.verdict.trials);
  // a held line with a miss leaves out the failure-rate bound (it is in the JSON block) so the 200-character limit keeps the reason
  const base = verdictSentence(o, !(o.verdict.status === 'held' && miss !== ''));
  const at = base.indexOf(':');
  const tagged = `${base.slice(0, at)} ${expectationTag(o.verdict.status, expectation)}${base.slice(at)}`;
  return o.verdict.status === 'held' && miss !== '' ? `${tagged}; ${miss}` : tagged;
}

function verdictSentence(o: RequirementOutcome, withBound: boolean): string {
  const v = o.verdict;
  const id = v.reqId;
  if (v.status === 'error') return `${id} error: ${o.meta.errors[0]?.message ?? 'the run failed without a message'}`;
  if (v.status === 'broken') {
    const ce = v.counterexample;
    const scen = formatScenario(o.req.space, ce?.scenario ?? v.closest.scenario);
    return `${id} broken: margin ${formatMargin(ce?.robustness ?? v.closest.robustness, o.unit)} at ${scen} (seed ${ce?.seed ?? v.closest.seed}), `
      + `${v.trials} trials${ce?.shrunk === true ? ', shrunk' : ''}; reproduce: npx golem-spec replay ${id}`;
  }
  return `${id} held: ${heldText(withBound ? v : { trials: v.trials, randomTrials: v.randomTrials })} (closest margin ${formatMargin(v.closest.robustness, o.unit)})`;
}

export function verdictJson(o: RequirementOutcome, expectation?: Expectation): Record<string, unknown> {
  const v = o.verdict;
  return {
    ...(expectation !== undefined ? { expectation, meetsExpectation: expectationMiss(v.status, expectation, v.trials) === '' } : {}),
    reqId: v.reqId, status: v.status, trials: v.trials, randomTrials: v.randomTrials, guidedTrials: v.guidedTrials,
    closest: { ...v.closest, unit: o.unit ?? null },
    ...(v.counterexample !== undefined ? { counterexample: { ...v.counterexample, unit: o.unit ?? null } } : {}),
    ...(v.failureRateUpper95 !== undefined ? { failureRateUpper95: v.failureRateUpper95 } : {}),
    ...(o.pinned !== undefined ? { pinned: o.pinned } : {}),
    ...(v.status === 'error' ? { error: o.meta.errors[0]?.message ?? null } : {}),
  };
}

export async function runTool(args: Record<string, unknown>, ctx: ToolCtx, mode: 'full' | 'random-only'): Promise<ToolResult> {
  const reqId = args['reqId'] as string;
  const budget = args['budget'] as number;
  const found = await findRequirement(ctx, reqId);
  if ('error' in found) return found.error;
  const compiled = await ctx.compile();
  const seen: Seen = { trials: 0, lowest: Infinity, scenario: {}, seed: 0, unit: undefined };
  return ctx.runQueue.run(async (signal) => {
    const pool = await ctx.getPool();
    const o: RunOptions = {
      mode, budgetKind: mode === 'full' ? 'mcp-falsify' : 'mcp-run', budget, req: reqId, signal,
      onResult: (r) => {
        seen.trials++;
        seen.unit = r.unit;
        if (r.robustness < seen.lowest) { seen.lowest = r.robustness; seen.scenario = r.spec.scenario; seen.seed = r.spec.seed; }
      },
    };
    const t0 = ctx.deps.clock();
    let outcomes: RequirementOutcome[];
    try {
      outcomes = await runRequirements(ctx.located, ctx.robotApp, compiled.requirements, o, ctx.deps, pool);
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError' && ctx.capFired()) return partial(ctx, reqId, found.req.space, seen);
      throw e;
    }
    const outcome = outcomes[0];
    if (outcome === undefined) return errorResult(`no result for ${reqId}`);
    const { byId } = await ctx.expectations();
    await writeRunReport(ctx.deps, ctx.located, [outcome], { reqId }, (ctx.deps.clock() - t0) / 1000, () => undefined, { expectations: byId });
    const expectation = byId.get(reqId);
    return makeToolResult(verdictSummary(outcome, expectation), verdictJson(outcome, expectation), outcome.verdict.status === 'error');
  }, ctx.signal);
}

function partial(ctx: ToolCtx, reqId: string, space: Parameters<typeof formatScenario>[0], seen: Seen): ToolResult {
  const failing = seen.lowest < 0;
  const cap = ctx.app.toolTimeCapS;
  const closest = { robustness: Number.isFinite(seen.lowest) ? seen.lowest : null, scenario: seen.scenario, seed: seen.seed, unit: seen.unit ?? null };
  const json = {
    reqId, status: failing ? 'broken' : 'held', partial: true, trials: seen.trials, closest,
    ...(failing ? { counterexample: { ...closest, shrunk: false } } : {}),
    note: `the time cap of ${cap} s ended the run; the counterexample, if any, is not shrunk, not pinned and not written to the report`,
  };
  const where = Number.isFinite(seen.lowest) ? `lowest margin ${formatMargin(seen.lowest, seen.unit)} at ${formatScenario(space, seen.scenario)} (seed ${seen.seed})` : 'no trial finished';
  return makeToolResult(`${reqId} partial: the time cap of ${cap} s ended the run after ${seen.trials} trials; ${where}`, json);
}
