// `golem check`: compile only. It never loads MuJoCo, never creates a pool and never runs a trial.
import { resolve } from '../paths.js';
import { checkJson } from '../format.js';
import { MissingFileError, bootstrap, compileAll, displayPath, hasErrors } from '../service.js';
import type { CommandHandler } from '../run.js';
import { appFlag, errLine, line, showDiagnostics } from './common.js';

export const handler: CommandHandler = async (p, io, deps) => {
  const boot = await bootstrap(io.cwd, appFlag(p), deps);
  const onlyFile = p.positionals[0] !== undefined ? resolve(io.cwd, p.positionals[0]) : undefined;
  let compiled;
  try {
    compiled = await compileAll(boot.app, boot.robotApp, deps, onlyFile);
  } catch (e) {
    if (e instanceof MissingFileError) { errLine(io, `golem: ${e.message.replace(e.path, displayPath(io.cwd, e.path))}`); return 1; }
    throw e;
  }
  const shown = compiled.diagnostics.map((d) => ({ ...d, file: displayPath(io.cwd, d.file) }));
  const errors = shown.filter((d) => d.severity === 'error').length;
  const warnings = shown.length - errors;
  if (p.flags['json'] === true) {
    line(io, JSON.stringify(checkJson(compiled.requirements, shown)));
    return hasErrors(compiled.diagnostics) ? 1 : 0;
  }
  showDiagnostics(io, compiled.diagnostics, 'stdout');
  const counts = `${compiled.requirements.length} requirements compiled, ${warnings} warnings`;
  line(io, errors > 0 ? `${counts}, ${errors} errors` : counts);
  return errors > 0 ? 1 : 0;
};
