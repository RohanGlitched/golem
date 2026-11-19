// Loads every committed input of the site, validates its shape and fails with the file name when it is wrong.
// Pure of the network and of the clock: the same files give the same pages (R25).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const REPO_ROOT = path.resolve(SITE_DIR, '..');

export class SiteDataError extends Error {
  constructor(readonly file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = 'SiteDataError';
  }
}

// ---------------------------------------------------------------- types
export interface MapCell { dirDeg: number; phase: number; seed: number; heldN: number; brokeN: number; trials: number }
export interface MapDirection { dirDeg: number; minHeldN: number; weakestPhase: number; meanHeldN: number }
export interface MapSummary {
  meta: {
    line: string; dirs: number; phases: number; seeds: number; steps: number; fmax: number; cells: number; trials: number; seconds: number;
    weakest: MapDirection; strongest: MapDirection;
  };
  summary: MapDirection[];
}
export interface ArmStats { found: number; n: number; rate: number; ci95: { lo: number; hi: number }; trialsMedian: number; trialsIqr: number; sevMedian: number }
export interface FalsifierRow {
  reqId: string; app: string; pairs: number; guided: ArmStats; random: ArmStats;
  trialsTest: { n: number; p: number; pBonferroni: number };
}
export interface FalsifierSummary {
  summary: FalsifierRow[];
  lines: Record<string, string>;
  meta: { budget: number; searchSeeds: number; commit: string; seconds: number; node: string; logicalCores: number };
  totalRuns: number;
  errors: number;
}
export interface CandyData {
  source: { where: string; commit: string }; line: string; heading: string; trials: number; broken: number;
  closestLinkAtBreak: Record<string, number>; worstMinDistanceM: number; worstTipDistanceM: number; handSpeedMps: number; paragraphs: string[];
}
export interface KiroSpec {
  name: string; path: string; type: string; requirements: number; earsCriteria: number; properties: number;
  tasksDone: number; tasksOpen: number; waves: boolean; status: string;
}
export interface KiroWorkspace {
  path: string; specs: KiroSpec[]; steering: string[];
  hooks: { file: string; name: string; trigger: string; action: string }[];
  agents: { name: string; file: string; hooks: number; mcp: string[] }[];
  mcp: string[]; skills: string[]; workflows: string[];
}
export interface KiroData {
  generated: string; commit: string; workspaces: KiroWorkspace[];
  commits: { total: number; byPrefix: Record<string, number> };
  tests: { files: number; propertyAsserts: number };
  totals: Record<string, number>;
}
export interface AgentGateData {
  cap: number; n: number; baseline: { gateExit: number; tail: string; seconds: number; commit: string };
  dryRuns: { arm: string; credits: number; durationS: number; gateExit: number; turns: number }[];
  runs?: { arm: string; index: number; status: string; credits: number; durationS: number; gateGreen: boolean; claimsSuccess: boolean; falseClaim: boolean; reqModified: boolean; filesChanged: string[]; finalMessage: string }[];
}
export interface ChangelogEntry { date: string; hash: string; subject: string }
export interface LexiconRef {
  app: string; name: string; robotNames: string[];
  predicates: { phrase: string; unit: string; signals: string[]; slots: string[] }[];
  perturbations: { phrase: string; slots: Record<string, { dim: string; severity: string }>; maxOnset?: number }[];
  lines: { id: string; source: string; pattern: string; dims: { name: string; kind: string; min: number; max: number; severity: string; wrap?: boolean }[]; horizon: number; formula?: string }[];
}

export interface SiteData {
  mapCells: MapCell[]; map: MapSummary;
  /** The same map with Kiro's step-into-the-push reflex on top of Unitree's policy (GOLEM_REFLEX=kiro), when it has run. */
  mapKiro: { cells: MapCell[]; summary: MapSummary } | undefined;
  /** The recorded campaign the home hero replays (site/public/hero/pack.json): which of its directions fell. */
  hero: { force: number; dirs: number; fellDeg: number[]; kiroFellDeg: number[] | undefined };
  falsifier: FalsifierSummary; graded: FalsifierSummary; graded256: FalsifierSummary | undefined;
  agentGate: AgentGateData;
  /** Experiment 3b (pre-registered 2026-11-20): the same pilot with requirement 1.3 raised to an unreachable 200 N. */
  agentGateHard: AgentGateData['runs'];
  candy: CandyData; kiro: KiroData; changelog: ChangelogEntry[]; lexicons: LexiconRef[];
  reportMd: string; transcriptMd: string; preregMd: string;
  reviews: { name: string; file: string; text: string }[];
  falsifyHardeningMd: string;
  needleRuns: string;
  pinnedSeed: { reqId: string; scenario: Record<string, number>; seed: number; robustness: number; shrunk: boolean; classification?: string }[];
}

// ---------------------------------------------------------------- readers
const rel = (root: string, p: string): string => path.relative(root, p).replace(/\\/g, '/');

function readText(root: string, relPath: string): string {
  const p = path.join(root, relPath);
  if (!existsSync(p)) throw new SiteDataError(relPath, 'file not found. Generate or restore it before building the site.');
  return readFileSync(p, 'utf8');
}

/** Reads a text file that may be UTF-16 (a PowerShell redirect wrote some committed logs) or UTF-8. */
function readTextAuto(root: string, relPath: string): string {
  const p = path.join(root, relPath);
  if (!existsSync(p)) throw new SiteDataError(relPath, 'file not found.');
  const b = readFileSync(p);
  return b[0] === 0xff && b[1] === 0xfe ? b.subarray(2).toString('utf16le') : b.toString('utf8').replace(/^\uFEFF/, '');
}

export function parseJson<T>(text: string, file: string): T {
  try { return JSON.parse(text) as T; } catch (e) { throw new SiteDataError(file, `invalid JSON (${(e as Error).message})`); }
}

/** Reads JSON Lines strictly: a blank line is skipped, any other line must parse (R25: no silent skipping). */
export function parseJsonl<T>(text: string, file: string): T[] {
  const out: T[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '') return;
    try { out.push(JSON.parse(line) as T); } catch { throw new SiteDataError(file, `line ${i + 1} is not valid JSON`); }
  });
  return out;
}

function need(cond: unknown, file: string, what: string): asserts cond {
  if (!cond) throw new SiteDataError(file, what);
}
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validateMapCells(cells: MapCell[], file: string): void {
  need(cells.length > 0, file, 'no rows');
  cells.forEach((c, i) => {
    need(isNum(c.dirDeg) && isNum(c.phase) && isNum(c.heldN) && isNum(c.brokeN), file, `row ${i + 1} lacks dirDeg, phase, heldN or brokeN as numbers`);
    need(c.heldN <= c.brokeN, file, `row ${i + 1} holds ${c.heldN} N but breaks at ${c.brokeN} N`);
  });
}

function validateFalsifier(s: FalsifierSummary, file: string): void {
  need(Array.isArray(s.summary) && s.summary.length > 0, file, 'summary is missing or empty');
  for (const r of s.summary) {
    need(typeof r.reqId === 'string' && isNum(r.guided?.found) && isNum(r.random?.found), file, `row for ${String(r.reqId)} lacks guided/random counts`);
  }
  need(isNum(s.meta?.budget), file, 'meta.budget is missing');
}

function optionalJson<T>(root: string, relPath: string): T | undefined {
  const p = path.join(root, relPath);
  return existsSync(p) ? parseJson<T>(readFileSync(p, 'utf8'), relPath) : undefined;
}

export function loadSiteData(root: string = REPO_ROOT): SiteData {
  const json = <T>(f: string): T => parseJson<T>(readText(root, f), f);

  const mapCells = parseJsonl<MapCell>(readText(root, 'evidence/results/g1-map.jsonl'), 'evidence/results/g1-map.jsonl');
  validateMapCells(mapCells, 'evidence/results/g1-map.jsonl');
  const map = json<MapSummary>('evidence/results/g1-map.summary.json');
  need(map.meta?.weakest && map.meta?.strongest && Array.isArray(map.summary), 'evidence/results/g1-map.summary.json', 'meta.weakest, meta.strongest or summary is missing');

  const kiroSummary = optionalJson<MapSummary>(root, 'evidence/results/kiro-reflex/g1-map.summary.json');
  let mapKiro: SiteData['mapKiro'];
  if (kiroSummary) {
    const f = 'evidence/results/kiro-reflex/g1-map.jsonl';
    const cells = parseJsonl<MapCell>(readText(root, f), f);
    validateMapCells(cells, f);
    need(kiroSummary.meta?.weakest && Array.isArray(kiroSummary.summary), 'evidence/results/kiro-reflex/g1-map.summary.json', 'meta.weakest or summary is missing');
    mapKiro = { cells, summary: kiroSummary };
  }

  type HeroPack = { force: number; trials: { idle?: boolean; angleDeg: number; fell: boolean }[] };
  const pack = json<HeroPack>('site/public/hero/pack.json');
  const pushes = pack.trials.filter((t) => !t.idle);
  need(pushes.length > 0, 'site/public/hero/pack.json', 'no recorded pushes. Run: npx tsx site/scripts/hero-pack.mts 100');
  const kiroPack = optionalJson<HeroPack>(root, 'site/public/hero/pack-kiro.json');
  const hero = {
    force: pack.force, dirs: pushes.length, fellDeg: pushes.filter((t) => t.fell).map((t) => t.angleDeg),
    kiroFellDeg: kiroPack?.trials.filter((t) => !t.idle && t.fell).map((t) => t.angleDeg),
  };

  const falsifier = json<FalsifierSummary>('evidence/results/falsifier.summary.json');
  validateFalsifier(falsifier, 'evidence/results/falsifier.summary.json');
  const graded = json<FalsifierSummary>('evidence/results/graded-margin/falsifier.summary.json');
  validateFalsifier(graded, 'evidence/results/graded-margin/falsifier.summary.json');
  const g256 = optionalJson<FalsifierSummary>(root, 'evidence/results/graded-margin-256/falsifier.summary.json');
  if (g256) validateFalsifier(g256, 'evidence/results/graded-margin-256/falsifier.summary.json');

  const agentGate = json<AgentGateData>('site/data/agent-gate.json');
  const hardFile = 'evidence/results/agent-gate-hard/agent-gate.jsonl';
  const agentGateHard = existsSync(path.join(root, hardFile))
    ? parseJsonl<NonNullable<AgentGateData['runs']>[number] & { kind: string }>(readText(root, hardFile), hardFile).filter((r) => r.kind === 'run')
    : undefined;
  need(Array.isArray(agentGate.dryRuns), 'site/data/agent-gate.json', 'dryRuns is missing');
  const candy = json<CandyData>('site/data/candy.json');
  need(isNum(candy.broken) && isNum(candy.trials), 'site/data/candy.json', 'broken and trials must be numbers');
  const kiro = json<KiroData>('site/data/kiro.json');
  need(Array.isArray(kiro.workspaces) && kiro.totals, 'site/data/kiro.json', 'workspaces or totals is missing. Run: node scripts/kiro-stats.mjs');
  const changelog = json<ChangelogEntry[]>('site/data/changelog.json');
  const lexicons = json<LexiconRef[]>('site/data/lexicon.json');

  const reviewsDir = path.join(root, 'docs/reviews');
  const reviews = existsSync(reviewsDir)
    ? readdirSync(reviewsDir).filter((f) => f.endsWith('.md')).sort().map((f) => ({
      name: f.replace(/\.md$/, ''), file: `docs/reviews/${f}`, text: readFileSync(path.join(reviewsDir, f), 'utf8'),
    }))
    : [];

  return {
    mapCells, map, mapKiro, hero, falsifier, graded, graded256: g256, agentGate, agentGateHard, candy, kiro, changelog, lexicons,
    reportMd: readText(root, 'evidence/REPORT.md'),
    transcriptMd: readText(root, 'docs/cli-transcript.md'),
    preregMd: readText(root, 'evidence/PREREG.md'),
    reviews,
    falsifyHardeningMd: readText(root, 'docs/reviews/falsify-hardening.md'),
    needleRuns: readTextAuto(root, 'docs/reviews/falsify-hardening-runs/after-search.txt'),
    pinnedSeed: json('apps/stagger/.golem/seeds/stagger/1.3.json'),
  };
}

export { rel };
