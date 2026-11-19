// The run service shared by the CLI commands and the MCP tools (design D6): compile, pool, falsify, pin, report.
import { extractCriteria } from '../ears/index.js';
import type { FalsifyOptions, FalsifyResult, PinnedSeedEntry } from '../falsify/index.js';
import type { KitDeps } from './deps.js';
import { locateApp, type LocatedApp } from './config.js';
import { mergeExpectations, parseExpectations, type ParsedExpectations } from './expectation.js';
import { sortDiagnostics } from './format.js';
import { relative } from './paths.js';
import { reportVerdict, createUnitCapture } from './signal-units.js';
import type { CompiledRequirement, RobotApp, ScenarioSpace, TrialPool } from './sibling-types.js';
import { atomicWriteFile, mergeReport, readReport, stableJson, tmpCounter } from './store.js';
import type { CompileOutcome, FileDiagnostic, ReportFile, ReportMeta, ReportVerdict, RequirementOutcome, RunOptions } from './types.js';

export const DEFAULT_TEST_TRIALS = 64;
export const GATE_QUICK_TRIALS = 24;
export const MCP_DEFAULT_TRIALS = 24;

export const reportPath = (app: Pick<LocatedApp, 'appDir'>): string => `${app.appDir}/.golem/report.json`;
export const golemDir = (app: Pick<LocatedApp, 'appDir'>): string => `${app.appDir}/.golem`;
export const gateStatePath = (app: Pick<LocatedApp, 'appDir'>): string => `${app.appDir}/.golem/gate-state.json`;
export const replayPath = (app: Pick<LocatedApp, 'appDir'>, reqId: string): string => `${app.appDir}/.golem/replays/${reqId}.csv`;

/** The directory of the Proposals_File: `<appDir>/.kiro/specs/<robot or app id>/`. */
export const proposalsPath = (app: LocatedApp, appId: string): string => `${app.appDir}/.kiro/specs/${app.config.robot ?? appId}/proposals.md`;

/** A path as shown to people: relative to the working directory when below it, otherwise absolute. */
export function displayPath(cwd: string, p: string): string {
  const rel = relative(cwd, p);
  return rel.startsWith('..') || /^[A-Za-z]:/.test(rel) ? p : rel;
}

export class MissingFileError extends Error {
  override name = 'MissingFileError';
  constructor(readonly path: string) { super(`requirements file not found: ${path}`); }
}

export interface Bootstrapped { app: LocatedApp; robotApp: RobotApp }

export async function bootstrap(cwd: string, appFlag: string | undefined, deps: KitDeps): Promise<Bootstrapped> {
  const app = await locateApp(cwd, appFlag, deps.fs);
  const robotApp = await deps.loadApp(app.config.app);
  return { app, robotApp };
}

// ---------------------------------------------------------------- compile

/** Compiles every listed Requirements_File, or only `onlyFile`. Throws MissingFileError for an absent file. */
export async function compileAll(app: LocatedApp, robotApp: RobotApp, deps: KitDeps, onlyFile?: string): Promise<CompileOutcome> {
  const files = onlyFile !== undefined ? [onlyFile] : app.config.requirements;
  const requirements: CompiledRequirement[] = [];
  const diagnostics: FileDiagnostic[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    let text: string;
    try {
      text = await deps.fs.readFile(file);
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') throw new MissingFileError(file);
      throw e;
    }
    const r = deps.compileFile(text, robotApp.lexicon);
    for (const d of r.diagnostics) diagnostics.push({ ...d, file });
    if (extractCriteria(text).criteria.length === 0) {
      diagnostics.push({
        kind: 'NON_EARS_LINE', severity: 'warning', message: 'the file contains no acceptance criterion', line: 1, column: 1, start: 0, end: 0, file,
      });
    }
    for (const req of r.requirements as CompiledRequirement[]) {
      const first = seen.get(req.id);
      if (first !== undefined && first !== file) {
        diagnostics.push({
          kind: 'BAD_RANGE', severity: 'error', line: 1, column: 1, start: 0, end: 0, file,
          message: `requirement id ${req.id} is also used in ${first}; ids must be unique across the listed files`,
        });
        continue;
      }
      seen.set(req.id, file);
      requirements.push(req);
    }
  }
  return { requirements, diagnostics: sortDiagnostics(diagnostics, files), files };
}

/** The Expectation tables of every listed Requirements_File. A file that cannot be read is skipped (compileAll reports it). */
export async function loadExpectations(app: Pick<LocatedApp, 'config'>, deps: Pick<KitDeps, 'fs'>): Promise<ParsedExpectations> {
  const parts: ParsedExpectations[] = [];
  for (const file of app.config.requirements) {
    try { parts.push(parseExpectations(await deps.fs.readFile(file))); } catch { /* absent file: no table */ }
  }
  return mergeExpectations(parts);
}

export const hasErrors = (d: readonly FileDiagnostic[]): boolean => d.some((x) => x.severity === 'error');

// ---------------------------------------------------------------- budget

/** Number of pinned entries that Phase 0 of the falsifier will accept for this requirement. */
export function countValidPinned(space: ScenarioSpace, reqId: string, seeds: readonly PinnedSeedEntry[]): number {
  const names = new Set(space.dims.map((d) => d.name));
  return seeds.filter((e) => {
    if (e.reqId !== reqId) return false;
    if (!Object.keys(e.scenario).every((k) => names.has(k))) return false;
    return space.dims.every((d) => { const v = e.scenario[d.name]; return v !== undefined && v >= d.min && v <= d.max; });
  }).length;
}

/**
 * Assumption A1: falsify counts pinned seeds inside `maxTrials`. The gate's quick budget of 24 is therefore
 * submitted as 24 + pinnedValid; `test` and `falsify` pass the budget unchanged; MCP `run_requirement` passes `n`;
 * MCP `falsify` passes `n + pinnedValid`. Without `--budget` and `--time`, `test` and `falsify` use 64 trials.
 */
export function toFalsifyOptions(
  o: RunOptions, app: Pick<LocatedApp, 'config'>, pinnedValid: number, appId: string, seedDb?: FalsifyOptions['seedDb'],
): FalsifyOptions {
  const budget: FalsifyOptions['budget'] = {};
  const flagged = o.budget !== undefined || o.timeS !== undefined;
  switch (o.budgetKind) {
    case 'test':
    case 'gate':
      if (o.budget !== undefined) budget.maxTrials = o.budget;
      if (o.timeS !== undefined) budget.maxWallMs = o.timeS * 1000;
      if (!flagged) budget.maxTrials = o.budgetKind === 'gate' ? GATE_QUICK_TRIALS + pinnedValid : DEFAULT_TEST_TRIALS;
      break;
    case 'mcp-run':
      budget.maxTrials = o.budget ?? MCP_DEFAULT_TRIALS;
      break;
    case 'mcp-falsify':
      budget.maxTrials = (o.budget ?? MCP_DEFAULT_TRIALS) + pinnedValid;
      break;
  }
  const out: FalsifyOptions = {
    appId, budget, mode: o.mode, searchSeed: o.searchSeed ?? app.config.searchSeed ?? 1,
  };
  if (seedDb !== undefined) out.seedDb = seedDb;
  return out;
}

// ---------------------------------------------------------------- run

/** A pinned seed whose re-run robustness is not above 0 makes the requirement broken (requirement 7.3). */
export function applyPinnedRule(o: RequirementOutcome): RequirementOutcome {
  if (o.verdict.status === 'broken') return o;
  const bad = o.meta.resolvedPinned.filter((p) => p.robustness <= 0).sort((a, b) => a.robustness - b.robustness)[0];
  if (bad === undefined) return o;
  return {
    ...o,
    verdict: {
      ...o.verdict, status: 'broken',
      closest: { robustness: bad.robustness, scenario: bad.scenario, seed: bad.seed },
      counterexample: { reqId: o.verdict.reqId, scenario: bad.scenario, seed: bad.seed, robustness: bad.robustness, shrunk: false, foundAfter: 0 },
    },
  };
}

export async function readPinned(deps: KitDeps, app: LocatedApp, appId: string, reqId: string): Promise<PinnedSeedEntry[]> {
  try {
    return await deps.createSeedDatabase(golemDir(app)).read(appId, reqId);
  } catch {
    return [];
  }
}

/** Falsifies each selected requirement in order on `pool`, pins every counterexample, and returns the outcomes. */
export async function runRequirements(
  app: LocatedApp, robotApp: RobotApp, reqs: readonly CompiledRequirement[], o: RunOptions, deps: KitDeps, pool: TrialPool,
): Promise<RequirementOutcome[]> {
  const db = deps.createSeedDatabase(golemDir(app));
  const selected = o.req === undefined ? reqs : reqs.filter((r) => r.id === o.req);
  const outcomes: RequirementOutcome[] = [];
  for (const req of selected) {
    let seeds: PinnedSeedEntry[] = [];
    try { seeds = await db.read(robotApp.id, req.id); } catch { /* falsify reports an unreadable seed file in its metadata */ }
    const pinnedValid = countValidPinned(req.space, req.id, seeds);
    const cap = createUnitCapture();
    const opts = toFalsifyOptions(o, app, pinnedValid, robotApp.id, { read: (a, r) => db.read(a, r) });
    if (o.signal !== undefined) opts.signal = o.signal;
    opts.onProgress = (e) => o.onProgress?.(e, req);
    opts.onResult = (r) => { cap.onResult(r); o.onResult?.(r, req); };
    const res: FalsifyResult = await deps.falsify(req, pool, opts);
    let pinned: 'added' | 'duplicate' | undefined;
    if (res.verdict.status === 'broken' && res.pinEntry !== undefined) {
      pinned = await deps.pinCounterexample(db, robotApp.id, res.pinEntry);
    }
    outcomes.push({
      req, verdict: res.verdict, meta: res.meta, unit: cap.unitOf(req.id), pinnedValid,
      ...(pinned !== undefined ? { pinned } : {}),
      ...(res.pinEntry !== undefined ? { pinEntry: res.pinEntry } : {}),
    });
    o.onOutcome?.(outcomes[outcomes.length - 1] as RequirementOutcome);
  }
  return outcomes;
}

/** Creates the pool, runs `body`, and closes the pool in `finally`: on success, throw and abort. */
export async function withPool<T>(
  deps: KitDeps, app: LocatedApp, robotApp: RobotApp, size: number | undefined, body: (p: TrialPool) => Promise<T>,
): Promise<T> {
  const pool = await deps.createPool({ app: robotApp, appDir: app.appDir, requirementFiles: app.config.requirements, ...(size !== undefined ? { size } : {}) });
  try {
    return await body(pool);
  } finally {
    await pool.close();
  }
}

export type GateRun =
  | { kind: 'compile-error'; diagnostics: FileDiagnostic[]; compiled: CompileOutcome }
  | { kind: 'empty'; compiled: CompileOutcome }
  | { kind: 'ran'; outcomes: RequirementOutcome[]; compiled: CompileOutcome; durationS: number; totalTrials: number };

/** One gate pass: compile, then pinned seeds and the quick budget for every requirement, then the pinned rule. */
export async function runGateOnce(
  app: LocatedApp, robotApp: RobotApp, deps: KitDeps,
  flags: { budget?: number; timeS?: number; workers?: number; searchSeed?: number },
  signal?: AbortSignal,
): Promise<GateRun> {
  const compiled = await compileAll(app, robotApp, deps);
  if (hasErrors(compiled.diagnostics)) return { kind: 'compile-error', diagnostics: compiled.diagnostics, compiled };
  if (compiled.requirements.length === 0) return { kind: 'empty', compiled };
  const t0 = deps.clock();
  const o: RunOptions = { mode: 'full', budgetKind: 'gate', ...flags, ...(signal !== undefined ? { signal } : {}) };
  const raw = await withPool(deps, app, robotApp, flags.workers, (pool) => runRequirements(app, robotApp, compiled.requirements, o, deps, pool));
  const outcomes = raw.map(applyPinnedRule);
  return { kind: 'ran', outcomes, compiled, durationS: (deps.clock() - t0) / 1000, totalTrials: outcomes.reduce((n, x) => n + x.verdict.trials, 0) };
}

// ---------------------------------------------------------------- report

export const toReportVerdicts = (outcomes: readonly RequirementOutcome[]): ReportVerdict[] =>
  outcomes.map((o) => reportVerdict(o.verdict, o.unit, o.req.source));

/** Merges the outcomes into `.golem/report.json`. A failed write is a warning, never a failed run (4.10, 7.9). */
export async function writeRunReport(
  deps: KitDeps, app: LocatedApp, outcomes: readonly RequirementOutcome[], scope: 'all' | { reqId: string },
  durationS: number, warn: (m: string) => void, extra: { lastGateExitCode?: number; gateOverride?: ReportFile['gateOverrides'][number] } = {},
): Promise<ReportFile | undefined> {
  const path = reportPath(app);
  const prev = await readReport(deps.fs, path);
  const first = outcomes[0];
  const commit = await deps.gitCommit(app.appDir).catch(() => undefined);
  const meta: ReportMeta = {
    budget: first?.meta.budget ?? {},
    ...(commit !== undefined ? { commit } : {}),
    durationS,
    searchSeed: first?.meta.searchSeed ?? app.config.searchSeed ?? 1,
    ...(extra.lastGateExitCode !== undefined ? { lastGateExitCode: extra.lastGateExitCode } : {}),
  };
  let report = mergeReport(prev.report, toReportVerdicts(outcomes), meta, scope);
  if (extra.gateOverride !== undefined) report = { ...report, gateOverrides: [...report.gateOverrides, extra.gateOverride] };
  try {
    await atomicWriteFile(deps.fs, path, stableJson(report), tmpCounter(`${deps.now().getTime().toString(36)}-`));
    return report;
  } catch (e) {
    warn(`warning: ${(e as Error).message}`);
    return undefined;
  }
}
