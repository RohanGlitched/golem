// `golem gate` without --kiro: exit 0 green, 2 red, 1 when it cannot start (CI and the repair workflow).
import { gateExitCode } from '../exit.js';
import { NOTHING_TO_CHECK, gateBlock } from '../format.js';
import { bootstrap, runGateOnce, writeRunReport } from '../service.js';
import type { CommandHandler } from '../run.js';
import { appFlag, errLine, line, runFlags, showDiagnostics } from './common.js';

export const handler: CommandHandler = async (p, io, deps) => {
  const boot = await bootstrap(io.cwd, appFlag(p), deps);
  const run = await runGateOnce(boot.app, boot.robotApp, deps, runFlags(p));
  if (run.kind === 'compile-error') {
    showDiagnostics(io, run.diagnostics, 'stderr');
    errLine(io, 'golem: the requirements do not compile; run golem check for details');
    return gateExitCode([], false, true);
  }
  if (run.kind === 'empty') {
    errLine(io, `golem gate: ${NOTHING_TO_CHECK}`);
    return gateExitCode([], false);
  }
  const verdicts = run.outcomes.map((o) => o.verdict);
  const code = gateExitCode(verdicts, false);
  await writeRunReport(deps, boot.app, run.outcomes, 'all', run.durationS, (m) => errLine(io, m), { lastGateExitCode: code });
  const notHeld = run.outcomes.filter((o) => o.verdict.status !== 'held');
  if (p.flags['json'] === true) {
    line(io, JSON.stringify({ ok: code === 0, exitCode: code, verdicts }));
    return code;
  }
  for (const o of notHeld) line(io, `${gateBlock(o, o.req.source)}\n`);
  if (code === 0) line(io, `no counterexample found in ${run.totalTrials} trials (${run.outcomes.length} requirements, pinned seeds first, then the quick budget)`);
  else line(io, `gate RED: ${notHeld.length} of ${run.outcomes.length} requirements are not held`);
  return code;
};
