import type { ToolDef } from '../schema.js';
import { TOOL_SCHEMAS } from '../tool-schemas.js';
import { runTool } from './run-common.js';

export const tool: ToolDef = {
  name: 'run_requirement',
  description: 'Run one requirement for at most `budget` random trials (pinned seeds first, default 24) and return its verdict: status, trial counts, closest margin and, when found, the counterexample. Pins and records a counterexample.',
  inputSchema: TOOL_SCHEMAS.run_requirement,
  partialOnCap: true,
  handler: (args, ctx) => runTool(args, ctx, 'random-only'),
};
