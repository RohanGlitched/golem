import { formatQuantity } from '../../cli/format.js';
import { makeToolResult } from '../result.js';
import type { ToolDef } from '../schema.js';
import { TOOL_SCHEMAS } from '../tool-schemas.js';

export const tool: ToolDef = {
  name: 'check_requirement',
  description: 'Compile one EARS line against the lexicon of the app without running any trial and without writing any file. Returns Diagnostics with suggestions, and the scenario space when it compiles.',
  inputSchema: TOOL_SCHEMAS.check_requirement,
  async handler(args, ctx) {
    const text = args['text'] as string;
    const r = ctx.deps.compileLine(text, ctx.robotApp.lexicon);
    const diagnostics = r.diagnostics.map((d) => ({ line: d.line, column: d.column, severity: d.severity, message: d.message, suggestion: d.suggestion ?? null }));
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (r.requirement === undefined || errors.length > 0) {
      const first = errors[0] ?? diagnostics[0];
      const hint = first?.suggestion !== null && first?.suggestion !== undefined ? `; closest template: ${first.suggestion}` : '';
      return makeToolResult(`does not compile: ${first?.message ?? 'unknown error'} (line ${first?.line ?? 1}, column ${first?.column ?? 1})${hint}`, { ok: false, diagnostics });
    }
    const dims = r.requirement.space.dims.map((d) => ({ name: d.name, kind: d.kind, min: d.min, max: d.max, severity: d.severity }));
    const ranges = r.requirement.space.dims.map((d) => (d.min === d.max
      ? `${d.name} = ${formatQuantity(d.kind, d.min)}`
      : `${d.name} from ${formatQuantity(d.kind, d.min)} to ${formatQuantity(d.kind, d.max)}`)).join(', ');
    return makeToolResult(`compiles as a ${r.requirement.pattern} requirement; the search varies ${ranges || 'nothing'}`, {
      ok: true, id: r.requirement.id, pattern: r.requirement.pattern, horizonS: r.requirement.horizon, space: { dims }, diagnostics,
    });
  },
};
