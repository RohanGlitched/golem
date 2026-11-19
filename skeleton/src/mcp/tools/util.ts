// Helpers shared by the tools.
import { formatMargin, formatScenario, sig3 } from '../../cli/format.js';
import { readPinned, reportPath } from '../../cli/service.js';
import type { CompiledRequirement, Scenario } from '../../cli/sibling-types.js';
import { readReport } from '../../cli/store.js';
import type { ReportVerdict } from '../../cli/types.js';
import { makeToolResult, type ToolResult } from '../result.js';
import type { ToolCtx } from '../schema.js';

export const errorResult = (message: string, extra: Record<string, unknown> = {}): ToolResult => makeToolResult(message, { error: message, ...extra }, true);

/** The requirement with this id, or an error Tool_Result that lists the valid ids (requirement 11.8). */
export async function findRequirement(ctx: ToolCtx, reqId: string): Promise<{ req: CompiledRequirement } | { error: ToolResult }> {
  const compiled = await ctx.compile();
  const req = compiled.requirements.find((r) => r.id === reqId);
  if (req !== undefined) return { req };
  const ids = compiled.requirements.map((r) => r.id);
  return { error: errorResult(`unknown requirement id "${reqId}"; valid ids: ${ids.join(', ') || 'none'}`, { validIds: ids }) };
}

export async function latestPinned(ctx: ToolCtx, reqId: string): Promise<{ entry?: Awaited<ReturnType<typeof readPinned>>[number]; all: Awaited<ReturnType<typeof readPinned>> }> {
  const all = await readPinned(ctx.deps, ctx.located, ctx.robotApp.id, reqId);
  const entry = all[all.length - 1];
  return entry === undefined ? { all } : { entry, all };
}

export async function reportEntry(ctx: ToolCtx, reqId: string): Promise<ReportVerdict | undefined> {
  const r = await readReport(ctx.deps.fs, reportPath(ctx.located));
  return r.report?.verdicts.find((v) => v.reqId === reqId);
}

export const scenarioWithUnits = (req: CompiledRequirement, s: Scenario): string => formatScenario(req.space, s);
export { formatMargin, sig3 };
