// `golem test`: falsify every requirement, pin counterexamples, write the report.
import { testExitCode } from '../exit.js';
import { requirementLine, testSummary } from '../format.js';
import { bootstrap, runRequirements, withPool, writeRunReport } from '../service.js';
import type { CommandHandler } from '../run.js';
import type { RunOptions } from '../types.js';
import { appFlag, compileForRun, errLine, line, pickRequirement, runFlags } from './common.js';

export const handler: CommandHandler = async (p, io, deps) => {
  const boot = await bootstrap(io.cwd, appFlag(p), deps);
  const c = await compileForRun(p, io, deps, boot);
  if (!c.ok) return c.code;
  const { requirements } = c.compiled;
  const only = typeof p.flags['req'] === 'string' ? p.flags['req'] : undefined;
  if (only !== undefined && pickRequirement(io, requirements, only) === undefined) return 1;
  const json = p.flags['json'] === true;
  const o: RunOptions = {
    mode: 'full', budgetKind: 'test', ...runFlags(p), ...(only !== undefined ? { req: only } : {}),
    onOutcome: (x) => { if (!json) line(io, requirementLine(x)); },
  };
  const t0 = deps.clock();
  const outcomes = await withPool(deps, boot.app, boot.robotApp, o.workers, (pool) => runRequirements(boot.app, boot.robotApp, requirements, o, deps, pool));
  const seconds = (deps.clock() - t0) / 1000;
  const code = testExitCode(outcomes.map((x) => x.verdict));
  const report = await writeRunReport(deps, boot.app, outcomes, only !== undefined ? { reqId: only } : 'all', seconds, (m) => errLine(io, m));
  if (json) {
    line(io, JSON.stringify({ verdicts: outcomes.map((x) => x.verdict), meta: report?.meta ?? { budget: outcomes[0]?.meta.budget ?? {}, durationS: seconds } }));
  } else {
    line(io, testSummary(outcomes, seconds));
  }
  return code;
};
