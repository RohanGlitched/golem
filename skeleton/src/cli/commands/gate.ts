// `golem gate` without --kiro: exit 0 green, 2 red, 1 when it cannot start (CI and the repair workflow).
import { gateExitCode } from '../exit.js';
import { judgeOutcomes } from '../expectation.js';
import { NOTHING_TO_CHECK, expectationBlock, gateGroups } from '../format.js';
import { bootstrap, loadExpectations, runGateOnce, writeRunReport } from '../service.js';
import type { CommandHandler } from '../run.js';
import { appFlag, errLine, line, runFlags, showDiagnostics } from './common.js';

export const handler: CommandHandler = async (p, io, deps) => {
  const boot = await bootstrap(io.cwd, appFlag(p), deps);
  const run = await runGateOnce(boot.app, boot.robotApp, deps, runFlags(p));
  if (run.kind === 'compile-error') {
    showDiagnostics(io, run.diagnostics, 'stderr');
    errLine(io, 'golem: the requirements do not compile; run npx golem-spec check for details');
    return gateExitCode([], false, true);
  }
  if (run.kind === 'empty') {
    errLine(io, `golem gate: ${NOTHING_TO_CHECK}`);
    return gateExitCode([], false);
  }
  const expectations = await loadExpectations(boot.app, deps);
  for (const m of expectations.problems) errLine(io, `golem gate: warning: ${m}`);
  const judged = judgeOutcomes(run.outcomes, expectations.byId);
  const verdicts = judged.map((j) => ({ ...j.outcome.verdict, expectation: j.expectation }));
  const code = gateExitCode(verdicts, false);
  await writeRunReport(deps, boot.app, run.outcomes, 'all', run.durationS, (m) => errLine(io, m), { lastGateExitCode: code });
  const unmet = judged.filter((j) => !j.met);
  if (p.flags['json'] === true) {
    line(io, JSON.stringify({
      ok: code === 0, exitCode: code, verdicts: run.outcomes.map((o) => o.verdict),
      expectations: judged.map((j) => ({ reqId: j.outcome.verdict.reqId, expectation: j.expectation, status: j.outcome.verdict.status, met: j.met })),
    }));
    return code;
  }
  // A spec with no Expected_Break line keeps the plain output; one with any prints both groups.
  const grouped = judged.some((j) => j.expectation === 'Expected_Break');
  if (grouped) for (const l of gateGroups(judged)) line(io, l);
  for (const j of unmet) line(io, `${expectationBlock(j)}\n`);
  if (!grouped) {
    if (code === 0) line(io, `no counterexample found in ${run.totalTrials} trials (${run.outcomes.length} requirements, pinned seeds first, then the quick budget)`);
    else line(io, `gate RED: ${unmet.length} of ${run.outcomes.length} requirements are not held`);
    return code;
  }
  const count = (e: string, met: boolean): number => judged.filter((j) => j.expectation === e && j.met === met).length;
  if (code === 0) {
    line(io, `gate GREEN: every requirement meets its expectation (${count('Expected_Hold', true)} held as expected, ${count('Expected_Break', true)} broke as expected; ${run.totalTrials} trials, pinned seeds first, then the quick budget)`);
  } else {
    line(io, `gate RED: ${unmet.length} of ${run.outcomes.length} requirements do not meet their expectation`);
  }
  return code;
};