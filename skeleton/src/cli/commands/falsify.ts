// `golem falsify <reqId>`: one requirement with a progress line per generation.
import { testExitCode } from '../exit.js';
import { phaseLabel, progressLine, requirementLine } from '../format.js';
import { bootstrap, runRequirements, withPool, writeRunReport } from '../service.js';
import type { CommandHandler } from '../run.js';
import type { RunOptions } from '../types.js';
import { appFlag, compileForRun, errLine, line, pickRequirement, runFlags } from './common.js';

export const handler: CommandHandler = async (p, io, deps) => {
  const boot = await bootstrap(io.cwd, appFlag(p), deps);
  const c = await compileForRun(p, io, deps, boot);
  if (!c.ok) return c.code;
  const id = p.positionals[0] as string;
  const req = pickRequirement(io, c.compiled.requirements, id);
  if (req === undefined) return 1;
  const json = p.flags['json'] === true;
  let unit: string | undefined;
  const o: RunOptions = {
    mode: 'full', budgetKind: 'test', ...runFlags(p), req: id,
    onResult: (r) => { unit = r.unit; },
    onProgress: (e) => {
      const label = phaseLabel(e.phase);
      if (json) {
        line(io, JSON.stringify({ type: 'progress', reqId: id, phase: label, generation: e.generation, lowestRobustness: e.lowestRobustness, unit: unit ?? null, trialsUsed: e.trialsUsed, trialsRemaining: e.trialsRemaining }));
      } else {
        line(io, progressLine(e, label, { reqId: id, ...(unit !== undefined ? { unit } : {}) }));
      }
    },
  };
  const t0 = deps.clock();
  const outcomes = await withPool(deps, boot.app, boot.robotApp, o.workers, (pool) => runRequirements(boot.app, boot.robotApp, c.compiled.requirements, o, deps, pool));
  const seconds = (deps.clock() - t0) / 1000;
  await writeRunReport(deps, boot.app, outcomes, { reqId: id }, seconds, (m) => errLine(io, m));
  const out = outcomes[0];
  if (out !== undefined) line(io, json ? JSON.stringify({ type: 'verdict', verdict: out.verdict }) : requirementLine(out));
  return testExitCode(outcomes.map((x) => x.verdict));
};
