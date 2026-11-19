import { reportPath } from '../../cli/service.js';
import { readReport } from '../../cli/store.js';
import { makeToolResult } from '../result.js';
import type { ToolDef } from '../schema.js';
import { TOOL_SCHEMAS } from '../tool-schemas.js';

export const tool: ToolDef = {
  name: 'list_requirements',
  description: 'List every requirement in the Requirements_Files in file order, with its EARS line and its last status from the last run (held, broken, error, or unknown).',
  inputSchema: TOOL_SCHEMAS.list_requirements,
  async handler(_args, ctx) {
    const compiled = await ctx.compile();
    const rep = await readReport(ctx.deps.fs, reportPath(ctx.located));
    const status = new Map((rep.report?.verdicts ?? []).map((v) => [v.reqId, v.status]));
    const { byId, issues } = await ctx.expectations();
    const requirements = compiled.requirements.map((r) => ({
      id: r.id, source: r.source, status: status.get(r.id) ?? 'unknown', ...(byId.has(r.id) ? { expectation: byId.get(r.id) } : {}),
    }));
    const count = (s: string): number => requirements.filter((r) => r.status === s).length;
    const note = rep.unreadable !== undefined ? `the report is unreadable (${rep.unreadable}); every status is unknown` : undefined;
    const errors = compiled.diagnostics.filter((d) => d.severity === 'error').length;
    const tableErrorCount = issues.filter((i) => i.severity === 'error').length;
    const summary = `${requirements.length} requirements: ${count('held')} held, ${count('broken')} broken, ${count('error')} error, ${count('unknown')} unknown`
      + `${errors > 0 ? `; ${errors} lines do not compile, run check_requirement` : ''}${note !== undefined ? '; the report is unreadable' : ''}`
      + `${issues.length > 0 ? `; the expectation table has ${tableErrorCount} errors and ${issues.length - tableErrorCount} warnings, see expectationIssues` : ''}`;
    return makeToolResult(summary, {
      requirements, ...(note !== undefined ? { note } : {}),
      ...(issues.length > 0 ? { expectationIssues: issues.map((i) => ({ severity: i.severity, file: i.file ?? null, line: i.line, message: i.message })) } : {}),
    });
  },
};
