import type { ToolDef } from '../schema.js';
import { TOOL_SCHEMAS } from '../tool-schemas.js';
import { runTool } from './run-common.js';

export const tool: ToolDef = {
  name: 'falsify',
  description: 'Search for a counterexample to one requirement: pinned seeds, random trials, guided search, then shrinking to the mildest failing scenario, within `budget` search trials (default 24). Pins and records a counterexample.',
  inputSchema: TOOL_SCHEMAS.falsify,
  partialOnCap: true,
  handler: (args, ctx) => runTool(args, ctx, 'full'),
};
