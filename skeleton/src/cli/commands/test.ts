// `golem test`: falsify every requirement, pin counterexamples, write the report.
import { testExitCode } from '../exit.js';
import { formatIssue, judgeOutcomes, readExpectations, tableErrors } from '../expectation.js';
import { requirementLine, testSummary } from '../format.js';
import { bootstrap, displayPath, runRequirements, withPool, writeRunReport } from '../service.js';
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
  const expectations = readExpectations(c.compiled.texts, c.compiled.files);
  for (const i of expectations.issues) errLine(io, `golem test: ${formatIssue(i, (f) => displayPath(io.cwd, f))}`);
  if (tableErrors(expectations).length > 0) errLine(io, `golem test: the Expectation table has ${tableErrors(expectations).length} error(s); the tags below treat those lines as Expected_Hold. Run npx golem-spec check`);
  const o: RunOptions = {
    mode: 'full', budgetKind: 'test', ...runFlags(p), ...(only !== undefined ? { req: only } : {}),
    onOutcome: (x) => { if (!json) line(io, requirementLine(x, expectations.byId.get(x.verdict.reqId))); },
  };
  const t0 = deps.clock();
  const outcomes = await withPool(deps, boot.app, boot.robotApp, o.workers, (pool) => runRequirements(boot.app, boot.robotApp, requirements, o, deps, pool));
  const seconds = (deps.clock() - t0) / 1000;
  const code = testExitCode(outcomes.map((x) => x.verdict));
  const report = await writeRunReport(deps, boot.app, outcomes, only !== undefined ? { reqId: only } : 'all', seconds, (m) => errLine(io, m), { expectations: expectations.byId });
  if (json) {
    line(io, JSON.stringify({
      verdicts: judgeOutcomes(outcomes, expectations.byId).map((j) => ({ ...j.outcome.verdict, expectation: j.expectation, met: j.met })),
      meta: report?.meta ?? { budget: outcomes[0]?.meta.budget ?? {}, durationS: seconds },
    }));
  } else {
    line(io, testSummary(outcomes, seconds));
  }
  return code;
};
