// Helpers shared by the command handlers.
import type { CliIo, KitDeps } from '../deps.js';
import { diagnosticText } from '../format.js';
import { MissingFileError, compileAll, displayPath, hasErrors, type Bootstrapped } from '../service.js';
import type { ParsedCommand } from '../args.js';
import type { CompileOutcome, FileDiagnostic, RunOptions } from '../types.js';
import type { CompiledRequirement, RobotApp } from '../sibling-types.js';
import type { LocatedApp } from '../config.js';

export const line = (io: CliIo, s: string): void => { io.stdout.write(`${s}\n`); };
export const errLine = (io: CliIo, s: string): void => { io.stderr.write(`${s}\n`); };

export const appFlag = (p: ParsedCommand): string | undefined => (typeof p.flags['app'] === 'string' ? p.flags['app'] : undefined);
export const flagNumber = (p: ParsedCommand, name: string): number | undefined => (typeof p.flags[name] === 'number' ? p.flags[name] as number : undefined);

/** Budget and pool flags shared by test, falsify and gate. */
export function runFlags(p: ParsedCommand): Pick<RunOptions, 'budget' | 'timeS' | 'workers' | 'searchSeed'> {
  const o: Pick<RunOptions, 'budget' | 'timeS' | 'workers' | 'searchSeed'> = {};
  const b = flagNumber(p, 'budget'); if (b !== undefined) o.budget = b;
  const t = flagNumber(p, 'time'); if (t !== undefined) o.timeS = t;
  const w = flagNumber(p, 'workers'); if (w !== undefined) o.workers = w;
  const s = flagNumber(p, 'search-seed'); if (s !== undefined) o.searchSeed = s;
  return o;
}

export const showDiagnostics = (io: CliIo, d: readonly FileDiagnostic[], to: 'stdout' | 'stderr'): void => {
  for (const x of d) io[to].write(`${diagnosticText({ ...x, file: displayPath(io.cwd, x.file) })}\n`);
};

export type Compiled =
  | { ok: true; boot: Bootstrapped; compiled: CompileOutcome }
  | { ok: false; code: number };

/** Locates the app and compiles every file; prints Diagnostics or "no requirements" and returns the exit code on failure. */
export async function compileForRun(p: ParsedCommand, io: CliIo, deps: KitDeps, boot: Bootstrapped): Promise<Compiled> {
  let compiled: CompileOutcome;
  try {
    compiled = await compileAll(boot.app, boot.robotApp, deps);
  } catch (e) {
    if (e instanceof MissingFileError) { errLine(io, `golem: ${e.message}`); return { ok: false, code: 1 }; }
    throw e;
  }
  if (hasErrors(compiled.diagnostics)) {
    showDiagnostics(io, compiled.diagnostics, 'stderr');
    errLine(io, `golem: ${compiled.diagnostics.filter((d) => d.severity === 'error').length} error(s) in the requirements; run npx golem-spec check for details`);
    return { ok: false, code: 1 };
  }
  if (compiled.requirements.length === 0) {
    errLine(io, `golem: no requirements found in ${boot.app.config.requirements.map((f) => displayPath(io.cwd, f)).join(', ') || 'the Config_File (requirements is empty)'}`);
    return { ok: false, code: 1 };
  }
  void p;
  return { ok: true, boot, compiled };
}

export const idsText = (reqs: readonly CompiledRequirement[]): string => reqs.map((r) => r.id).join(', ');

/** `--req` or `<reqId>`: the requirement with that id, or an error line that lists the valid ids. */
export function pickRequirement(io: CliIo, reqs: readonly CompiledRequirement[], id: string | undefined): CompiledRequirement | undefined {
  const found = reqs.find((r) => r.id === id);
  if (found === undefined) errLine(io, `golem: unknown requirement id "${String(id)}"; valid ids: ${idsText(reqs)}`);
  return found;
}

export type { LocatedApp, RobotApp };
