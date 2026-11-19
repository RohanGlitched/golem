// `golem gate --kiro`: the Stop hook protocol (requirement 8). Every outcome exits 0 except a usage or Config_File
// error (exit 1, nothing on stdout). A block is one JSON line on stdout; everything else goes to stderr.
import { gateExitCode } from '../exit.js';
import { elapsedSeconds, gateCounter, parseStopPayload, pruneState } from '../gate-counter.js';
import { judgeOutcomes } from '../expectation.js';
import { NOTHING_TO_CHECK, buildReason, diagnosticsReason, expectationBlock, redAllowMessage } from '../format.js';
import {
  bootstrap, gateStatePath, loadExpectations, reportPath, runGateOnce, writeRunReport, type GateRun,
} from '../service.js';
import { atomicWriteFile, readGateState, readReport, stableJson, tmpCounter, writeGateState } from '../store.js';
import type { CommandHandler } from '../run.js';
import type { GateOverride, ReportFile } from '../types.js';
import { appFlag, errLine, runFlags } from './common.js';

type Result = GateRun | { kind: 'failed'; message: string };

export const handler: CommandHandler = async (p, io, deps) => {
  // Stop payload: at most 1 s, only `session_id` is used.
  const raw = io.stdin.isTTY ? undefined : await io.stdin.read(1000);
  const { sessionId } = parseStopPayload(raw);

  // A usage or Config_File error throws here: exit 1 with nothing on stdout, before the state is read.
  const boot = await bootstrap(io.cwd, appFlag(p), deps);
  const { app } = boot;

  const startMs = deps.now().getTime();
  const nowIso = new Date(startMs).toISOString();
  const nextTmp = tmpCounter(`${startMs.toString(36)}-`);
  const state = pruneState(await readGateState(deps.fs, gateStatePath(app), (m) => errLine(io, m)), startMs);

  let result: Result;
  try {
    result = await runGateOnce(app, boot.robotApp, deps, runFlags(p));
  } catch (e) {
    result = { kind: 'failed', message: (e as Error).message };
  }

  // Red blocks, and the ids of what is not held (for the RED message and the Gate_Override).
  const blocks: string[] = [];
  const notHeld: { id: string; ears: string }[] = [];
  let green = false;
  let breakLines = 0;
  let code = 2;
  if (result.kind === 'ran') {
    const expectations = await loadExpectations(app, deps);
    for (const m of expectations.problems) errLine(io, `golem gate: warning: ${m}`);
    const judged = judgeOutcomes(result.outcomes, expectations.byId);
    code = gateExitCode(judged.map((j) => ({ ...j.outcome.verdict, expectation: j.expectation })), false);
    green = code === 0;
    breakLines = judged.filter((j) => j.expectation === 'Expected_Break').length;
    for (const j of judged) {
      if (j.met) continue;
      blocks.push(expectationBlock(j));
      notHeld.push({ id: j.outcome.verdict.reqId, ears: j.expectation === 'Expected_Break' ? `${j.outcome.req.source} (${j.miss})` : j.outcome.req.source });
    }  } else if (result.kind === 'compile-error') {
    blocks.push(diagnosticsReason(result.diagnostics));
    notHeld.push({ id: 'compile', ears: `the requirements do not compile (${result.diagnostics.filter((d) => d.severity === 'error').length} errors)` });
  } else if (result.kind === 'empty') {
    blocks.push(NOTHING_TO_CHECK);
    notHeld.push({ id: 'config', ears: NOTHING_TO_CHECK });
  } else {
    blocks.push(`The gate could not run: ${result.message}`);
    notHeld.push({ id: 'run', ears: `the gate could not run: ${result.message}` });
  }

  const before = Object.prototype.hasOwnProperty.call(state, sessionId) ? state[sessionId] : undefined;
  const elapsedS = elapsedSeconds(state, sessionId, startMs);
  const decision = gateCounter(state, sessionId, green, nowIso, elapsedS);

  // The state is written before anything goes to stdout (8.16). A failed write is a warning (8.19).
  try {
    await writeGateState(deps.fs, gateStatePath(app), decision.nextState, nextTmp);
  } catch (e) {
    errLine(io, `warning: ${(e as Error).message}`);
  }

  // Report: written after a run that reached the trial phase; a Gate_Override only for an allow at count 5 (8.21).
  const override: GateOverride | undefined = !green && decision.allowStop && before?.count === 5
    ? { sessionId, timestamp: nowIso, count: 5, brokenReqIds: notHeld.map((n) => n.id) }
    : undefined;
  const warn = (m: string): void => errLine(io, m);
  if (result.kind === 'ran') {
    await writeRunReport(deps, app, result.outcomes, 'all', result.durationS, warn, { lastGateExitCode: code, ...(override !== undefined ? { gateOverride: override } : {}) });
  } else if (override !== undefined) {
    await appendOverrideOnly(deps, app, override, warn);
  }

  if (green) {
    if (result.kind === 'ran' && breakLines > 0) errLine(io, `gate GREEN: every requirement meets its expectation (${result.outcomes.length - breakLines} Expected_Hold held, ${breakLines} Expected_Break broke; ${result.totalTrials} trials)`);
    else if (result.kind === 'ran') errLine(io, `no counterexample found in ${result.totalTrials} trials (${result.outcomes.length} requirements, pinned seeds first, then the quick budget)`);
    return 0;
  }
  if (!decision.allowStop) {
    const reason = buildReason(blocks, reportPath(app).replace(`${app.appDir}/`, ''));
    io.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`);
    errLine(io, `golem gate: RED, blocking this stop (block ${decision.nextState[sessionId]?.count ?? '?'} of 5 for session ${sessionId})`);
    return 0;
  }
  if (override !== undefined) io.stderr.write(redAllowMessage(sessionId, notHeld));
  else errLine(io, `golem gate: still RED, repeating the allowed stop of this event (session ${sessionId})`);
  return 0;
};

async function appendOverrideOnly(deps: Parameters<CommandHandler>[2], app: Parameters<typeof reportPath>[0] & { config: { searchSeed?: number } }, o: GateOverride, warn: (m: string) => void): Promise<void> {
  const prev = await readReport(deps.fs, reportPath(app));
  const base: ReportFile = prev.report ?? { schema: 1, verdicts: [], meta: { budget: {}, durationS: 0, searchSeed: app.config.searchSeed ?? 1 }, gateOverrides: [] };
  const next: ReportFile = { ...base, gateOverrides: [...base.gateOverrides, o] };
  try {
    await atomicWriteFile(deps.fs, reportPath(app), stableJson(next), tmpCounter(`${deps.now().getTime().toString(36)}-o`));
  } catch (e) {
    warn(`warning: ${(e as Error).message}`);
  }
}
