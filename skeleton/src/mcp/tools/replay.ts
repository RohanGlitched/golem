import { formatMargin, formatScenario, sig3 } from '../../cli/format.js';
import { signalUnit } from '../../cli/signal-units.js';
import { selectReplay } from '../../cli/replay-target.js';
import { studioUrl } from '../../cli/studio-url.js';
import { summariseTrace, signalStats } from '../margins.js';
import { makeToolResult } from '../result.js';
import type { ToolDef } from '../schema.js';
import { TOOL_SCHEMAS } from '../tool-schemas.js';
import { errorResult, findRequirement, latestPinned } from './util.js';

export const tool: ToolDef = {
  name: 'replay',
  description: 'Re-run a pinned counterexample exactly (the latest, or the one with `seed`) and return a 10 Hz trace summary of at most 200 samples, the worst moment, and a Studio URL.',
  inputSchema: TOOL_SCHEMAS.replay,
  async handler(args, ctx) {
    const reqId = args['reqId'] as string;
    const found = await findRequirement(ctx, reqId);
    if ('error' in found) return found.error;
    const { all } = await latestPinned(ctx, reqId);
    const seed = typeof args['seed'] === 'number' ? args['seed'] : undefined;
    const target = selectReplay(all, undefined, { cli: false, ...(seed !== undefined ? { seed } : {}) });
    if (!target.ok) {
      if (target.reason === 'seed-not-pinned') return errorResult(`seed ${String(seed)} is not pinned for ${reqId}; pinned seeds: ${target.pinnedSeeds.join(', ')}`, { pinnedSeeds: target.pinnedSeeds });
      return errorResult(`no counterexample is pinned for ${reqId}; call falsify first`, { pinnedSeeds: [] });
    }
    try {
      const { result, trace } = await ctx.runQueue.run(
        () => ctx.deps.runTraced(ctx.robotApp, found.req, { app: ctx.robotApp.id, reqId, scenario: target.scenario, seed: target.seed }),
        ctx.signal,
      );
      const stats = signalStats(trace, result.worstAt).map((s) => ({ ...s, unit: signalUnit(ctx.robotApp, s.signal, ctx.located.config.signalUnits) }));
      const url = studioUrl(ctx.located.config, ctx.robotApp.id, { reqId, seed: target.seed, scenario: target.scenario });
      return makeToolResult(
        `${reqId} replay (seed ${target.seed}): robustness ${formatMargin(result.robustness, result.unit)} at t = ${sig3(result.worstAt)} s, ${formatScenario(found.req.space, target.scenario)}`,
        {
          reqId, seed: target.seed, scenario: target.scenario, robustness: result.robustness, unit: result.unit, worstAtS: result.worstAt,
          signals: stats, summary: summariseTrace(trace), studioUrl: url,
        },
      );
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') throw e;
      return errorResult(`replay of ${reqId} failed: ${(e as Error).message}`);
    }
  },
};
