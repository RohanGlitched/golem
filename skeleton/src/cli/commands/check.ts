// `golem check`: compile only. It never loads MuJoCo, never creates a pool and never runs a trial.
import { resolve } from '../paths.js';
import { readExpectations } from '../expectation.js';
import { checkJson, tableIssueDiagnostic } from '../format.js';
import { MissingFileError, bootstrap, compileAll, displayPath } from '../service.js';
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
  // The Expectation table is checked where the lines are checked. With a file argument only its own rows are read, because the other files' ids are not compiled.
  const table = readExpectations(compiled.texts, compiled.files, { reconcile: onlyFile === undefined });
  const all = [...compiled.diagnostics, ...table.issues.map(tableIssueDiagnostic)];
  const shown = all.map((d) => ({ ...d, file: displayPath(io.cwd, d.file) }));
  const errors = shown.filter((d) => d.severity === 'error').length;
  const warnings = shown.length - errors;
  if (p.flags['json'] === true) {
    line(io, JSON.stringify(checkJson(compiled.requirements, shown)));
    return errors > 0 ? 1 : 0;
  }
  showDiagnostics(io, all, 'stdout');
  const counts = `${compiled.requirements.length} requirements compiled, ${warnings} warnings`;
  line(io, errors > 0 ? `${counts}, ${errors} errors` : counts);
  return errors > 0 ? 1 : 0;
};
