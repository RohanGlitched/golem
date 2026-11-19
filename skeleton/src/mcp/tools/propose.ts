import { proposalsPath, displayPath } from '../../cli/service.js';
import { tmpCounter } from '../../cli/store.js';
import { appendProposal, findDuplicate, parseEntries } from '../proposals.js';
import { makeToolResult } from '../result.js';
import type { ToolDef } from '../schema.js';
import { TOOL_SCHEMAS } from '../tool-schemas.js';
import { errorResult } from './util.js';

async function readOrEmpty(ctx: Parameters<ToolDef['handler']>[1], path: string): Promise<string> {
  try {
    return await ctx.deps.fs.readFile(path);
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return '';
    throw e;
  }
}

export const tool: ToolDef = {
  name: 'propose_requirement',
  description: 'Record one EARS line as a proposal in .kiro/specs/<robot>/proposals.md for a human to review. The line must compile and must not duplicate an existing requirement or proposal. This tool never edits a requirements file.',
  inputSchema: TOOL_SCHEMAS.propose_requirement,
  async handler(args, ctx) {
    const text = args['text'] as string;
    const rationale = args['rationale'] as string | undefined;
    // 1. compile
    const r = ctx.deps.compileLine(text, ctx.robotApp.lexicon);
    const errors = r.diagnostics.filter((d) => d.severity === 'error');
    if (r.requirement === undefined || errors.length > 0) {
      const first = errors[0] ?? r.diagnostics[0];
      return makeToolResult(`not recorded: the line does not compile: ${first?.message ?? 'unknown error'}${first?.suggestion !== undefined ? ` (closest template: ${first.suggestion})` : ''}`, {
        recorded: false, reason: 'does not compile',
        diagnostics: r.diagnostics.map((d) => ({ line: d.line, column: d.column, severity: d.severity, message: d.message, suggestion: d.suggestion ?? null })),
      });
    }
    // 2. duplicate against the proposals file and every requirements file
    const file = proposalsPath(ctx.located, ctx.robotApp.id);
    const sources: { path: string; content: string }[] = [];
    try {
      sources.push({ path: file, content: await readOrEmpty(ctx, file) });
      for (const f of ctx.located.config.requirements) sources.push({ path: f, content: await readOrEmpty(ctx, f) });
    } catch (e) {
      return errorResult(`cannot check for duplicates: ${(e as Error).message}`);
    }
    const dup = findDuplicate(text, sources);
    if (dup !== undefined) {
      const shownPath = displayPath(ctx.located.appDir, dup.path);
      return makeToolResult(`not recorded: the line already exists in ${shownPath} at line ${dup.line}`, { recorded: false, reason: 'duplicate', duplicate: { file: shownPath, line: dup.line } });
    }
    // 3. append through the write queue
    const entry = { timestamp: ctx.deps.now().toISOString(), text, ...(rationale !== undefined && rationale !== '' ? { rationale } : {}) };
    try {
      await ctx.writeQueue.run(() => appendProposal(ctx.deps.fs, file, entry, tmpCounter(`${ctx.deps.now().getTime().toString(36)}-`)), ctx.signal);
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') throw e;
      return errorResult(`cannot write the proposal: ${(e as Error).message}`);
    }
    const total = parseEntries(await readOrEmpty(ctx, file)).entries.length;
    const shown = displayPath(ctx.located.appDir, file);
    return makeToolResult(`recorded as proposal ${total} in ${shown}; a human or Kiro spec mode merges accepted lines into requirements.md`, { recorded: true, file: shown, proposals: total });
  },
};
