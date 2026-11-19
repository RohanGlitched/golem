import { makeToolResult } from '../result.js';
import type { ToolDef } from '../schema.js';
import { TOOL_SCHEMAS } from '../tool-schemas.js';
import { findRequirement, formatMargin, latestPinned, reportEntry, scenarioWithUnits } from './util.js';

export const tool: ToolDef = {
  name: 'get_counterexample',
  description: 'Return the most recently pinned counterexample of a requirement: scenario with units, seed and robustness with unit.',
  inputSchema: TOOL_SCHEMAS.get_counterexample,
  async handler(args, ctx) {
    const reqId = args['reqId'] as string;
    const found = await findRequirement(ctx, reqId);
    if ('error' in found) return found.error;
    const { entry } = await latestPinned(ctx, reqId);
    if (entry === undefined) return makeToolResult(`no counterexample is pinned for ${reqId}`, { reqId, counterexample: null });
    const unit = (await reportEntry(ctx, reqId))?.unit;
    return makeToolResult(
      `${reqId}: pinned counterexample ${scenarioWithUnits(found.req, entry.scenario)} (seed ${entry.seed}), margin ${formatMargin(entry.robustness, unit)}; reproduce: golem replay ${reqId}`,
      { reqId, counterexample: { scenario: entry.scenario, seed: entry.seed, robustness: entry.robustness, unit: unit ?? null, shrunk: entry.shrunk, foundAfter: entry.foundAfter } },
    );
  },
};
