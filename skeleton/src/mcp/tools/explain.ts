import { formatMargin, formatScenario, sig3 } from '../../cli/format.js';
import { explain, MarginsUnavailableError } from '../margins.js';
import { makeToolResult } from '../result.js';
import type { ToolDef } from '../schema.js';
import { TOOL_SCHEMAS } from '../tool-schemas.js';
import { errorResult, findRequirement, latestPinned, reportEntry } from './util.js';

export const tool: ToolDef = {
  name: 'explain_margin',
  description: 'Replay the latest pinned counterexample (or the closest scenario of the last run) and report which signal has the lowest margin, when, by how much, and the margins of the other signals the requirement reads.',
  inputSchema: TOOL_SCHEMAS.explain_margin,
  async handler(args, ctx) {
    const reqId = args['reqId'] as string;
    const found = await findRequirement(ctx, reqId);
    if ('error' in found) return found.error;
    const { entry } = await latestPinned(ctx, reqId);
    let source: 'pinned' | 'closest';
    let scenario: Record<string, number>;
    let seed: number;
    if (entry !== undefined) {
      ({ scenario, seed } = entry);
      source = 'pinned';
    } else {
      const closest = (await reportEntry(ctx, reqId))?.closest;
      if (closest === undefined) return errorResult(`no counterexample is pinned and no run is recorded for ${reqId}; call falsify first`);
      ({ scenario, seed } = closest);
      source = 'closest';
    }
    try {
      const { result, trace } = await ctx.runQueue.run(
        () => ctx.deps.runTraced(ctx.robotApp, found.req, { app: ctx.robotApp.id, reqId, scenario, seed }),
        ctx.signal,
      );
      const e = explain(found.req, trace, found.req.monitor(trace));
      const where = source === 'pinned' ? 'pinned counterexample' : 'closest scenario of the last run (nothing is pinned)';
      return makeToolResult(
        `${reqId}: lowest margin on ${e.lowest.signal}, ${formatMargin(e.lowest.margin, e.lowest.unit)} at t = ${sig3(e.lowest.at)} s (${where}, seed ${seed}, ${formatScenario(found.req.space, scenario)})`,
        { reqId, source, seed, scenario, robustness: result.robustness, unit: result.unit, lowest: e.lowest, others: e.others, marginSource: e.source },
      );
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') throw err;
      if (err instanceof MarginsUnavailableError) return errorResult(err.message);
      return errorResult(`explain_margin for ${reqId} failed: ${(err as Error).message}`);
    }
  },
};
