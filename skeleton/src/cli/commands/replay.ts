// `golem replay <reqId>`: re-run one counterexample exactly, print the trace summary, write the CSV and the Studio_URL.
import { traceToCsv } from '../csv.js';
import { formatMargin, formatScenario, sig3 } from '../format.js';
import { selectReplay } from '../replay-target.js';
import { readPinned, bootstrap, displayPath, replayPath } from '../service.js';
import { signalUnit } from '../signal-units.js';
import { readReport, atomicWriteFile, tmpCounter } from '../store.js';
import { studioUrl } from '../studio-url.js';
import { signalStats } from '../../mcp/margins.js';
import type { CommandHandler } from '../run.js';
import { appFlag, compileForRun, errLine, flagNumber, line, pickRequirement } from './common.js';
import { reportPath } from '../service.js';

export const handler: CommandHandler = async (p, io, deps) => {
  const boot = await bootstrap(io.cwd, appFlag(p), deps);
  const c = await compileForRun(p, io, deps, boot);
  if (!c.ok) return c.code;
  const id = p.positionals[0] as string;
  const req = pickRequirement(io, c.compiled.requirements, id);
  if (req === undefined) return 1;
  const { app, robotApp } = boot;

  const pinned = await readPinned(deps, app, robotApp.id, id);
  const rep = await readReport(deps.fs, reportPath(app));
  const closest = rep.report?.verdicts.find((v) => v.reqId === id)?.closest;
  const seed = flagNumber(p, 'seed');
  const target = selectReplay(pinned, closest !== undefined ? { scenario: closest.scenario, seed: closest.seed } : undefined, { cli: true, ...(seed !== undefined ? { seed } : {}) });
  if (!target.ok) {
    errLine(io, `golem: no counterexample is pinned for ${id}; run "golem falsify ${id}" to look for one`);
    return 1;
  }

  let run;
  try {
    run = await deps.runTraced(robotApp, req, { app: robotApp.id, reqId: id, scenario: target.scenario, seed: target.seed });
  } catch (e) {
    errLine(io, `golem: replay of ${id} failed: ${(e as Error).message}`);
    return 1;
  }
  const { result, trace } = run;

  const csvPath = replayPath(app, id);
  try {
    await atomicWriteFile(deps.fs, csvPath, traceToCsv(trace), tmpCounter(`${deps.now().getTime().toString(36)}-`));
  } catch (e) {
    errLine(io, `golem: replay of ${id} failed: ${(e as Error).message}`);
    return 1;
  }

  const stats = signalStats(trace, result.worstAt);
  line(io, `replay ${id}: seed ${target.seed}, ${formatScenario(req.space, target.scenario)}${target.source === 'closest' ? ' (closest scenario of the last run, nothing pinned)' : ''}`);
  line(io, `robustness ${formatMargin(result.robustness, result.unit)} at t = ${sig3(result.worstAt)} s (the worst moment)`);
  line(io, 'signals: minimum, maximum, and value at the worst moment');
  for (const s of stats) {
    const u = signalUnit(robotApp, s.signal, app.config.signalUnits);
    line(io, `  ${s.signal}: min ${sig3(s.min)} ${u}, max ${sig3(s.max)} ${u}, at worst ${sig3(s.atWorst)} ${u}`);
  }
  line(io, `trace: ${displayPath(io.cwd, csvPath)} (${trace.t.length} samples)`);
  line(io, `studio: ${studioUrl(app.config, robotApp.id, { reqId: id, seed: target.seed, scenario: target.scenario })}`);
  return 0;
};
