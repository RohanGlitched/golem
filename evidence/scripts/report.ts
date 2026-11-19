// Experiment 4: results/*.jsonl and summaries in, evidence/REPORT.md and site/data/*.json out.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expectedBreaks, latestAttempts, summarizeFalsifier, type FalsifierRecord } from './core/falsifier-summary.js';
import { readJsonl, stableStringify } from './core/jsonl.js';
import { summarizeMap, sortRows, type MapRow, type MapSummary } from './core/map.js';
import { buildReport, criterionText, type AgentInput, type AgentRun, type FalsifierInput, type MapInput, type ReportInput } from './core/report.js';

export interface ReportPaths { results: string; site: string; out: string; stagger: string; repoCommit: string; apps: string }

const readText = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const readJson = <T>(p: string): T | undefined => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : undefined);

export function collectInput(p: ReportPaths): ReportInput {
  const input: ReportInput = { notes: readText(`${p.results}/NOTES.md`) || 'No notes file.', repoCommit: p.repoCommit };

  const fRecs = readJsonl<FalsifierRecord>(`${p.results}/falsifier.jsonl`);
  const fSummary = readJson<{ meta: FalsifierInput['meta'] }>(`${p.results}/falsifier.summary.json`);
  if (fRecs.length > 0 && fSummary) {
    const budget = fSummary.meta.budget;
    const md = readText(p.stagger);
    const latest = latestAttempts(fRecs);
    const lines: Record<string, string> = {};
    for (const id of expectedBreaks(md)) lines[`stagger|${id}`] = criterionText(md, id) ?? '';
    input.falsifier = {
      meta: fSummary.meta, summary: summarizeFalsifier(fRecs, budget), lines,
      errors: latest.filter((r) => r.found === null).length, totalRuns: latest.length,
      skippedApps: existsSync(`${p.apps}/candy/golem.config.json`) ? [] : ['candy'],
    };
  }

  const mRows = readJsonl<MapRow>(`${p.results}/g1-map.jsonl`);
  const mSummary = readJson<MapSummary>(`${p.results}/g1-map.summary.json`);
  if (mRows.length > 0 && mSummary) {
    const { seconds, line, dirs, phases, seeds, steps, fmax } = mSummary.meta;
    const map: MapInput = {
      summary: summarizeMap(sortRows(mRows), { line, dirs, phases, seeds, steps, fmax }, seconds),
      cells: sortRows(mRows).map((r) => ({ dirDeg: r.dirDeg, phase: r.phase, seed: r.seed, heldN: r.heldN, brokeN: r.brokeN })),
      invalidNote: existsSync(`${p.results}/invalid/README.txt`)
        ? `An earlier run of the same script (\`results/invalid/\`) was made before the ears fix and is kept as invalid: ${readText(`${p.results}/invalid/README.txt`).trim()}`
        : undefined,
    };
    const verify = readJson<NonNullable<MapInput['verify']>>(`${p.results}/g1-map.verify.json`);
    if (verify) map.verify = verify;
    input.map = map;
  }

  const agentAll = readJsonl<(AgentRun & { kind: string })>(`${p.results}/agent-gate.jsonl`);
  const dryAll = readJsonl<(AgentRun & { kind: string })>(`${p.results}/agent-gate.dryrun.jsonl`);
  if (agentAll.length > 0 || dryAll.length > 0) {
    const base = [...agentAll, ...dryAll].find((r) => r.kind === 'baseline') as unknown as AgentInput['baseline'];
    const agent: AgentInput = {
      runs: agentAll.filter((r) => r.kind === 'run' && !r.dryRun),
      dryRuns: [...agentAll, ...dryAll].filter((r) => r.kind === 'run' && r.dryRun),
      cap: 150, n: 6,
    };
    if (base) agent.baseline = base;
    input.agent = agent;
  } else input.agent = { runs: [], dryRuns: [], cap: 150, n: 6 };
  return input;
}

/** Writes a file by renaming a temporary name over it, so a crash never leaves half a report. */
export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function writeReport(p: ReportPaths): { markdown: string } {
  const { markdown, json } = buildReport(collectInput(p));
  const files: [string, string][] = [
    [p.out, markdown],
    [`${p.site}/falsifier.json`, `${JSON.stringify(JSON.parse(stableStringify(json.falsifier)), null, 2)}\n`],
    [`${p.site}/g1-map.json`, `${JSON.stringify(JSON.parse(stableStringify(json.g1Map)), null, 2)}\n`],
    [`${p.site}/agent-gate.json`, `${JSON.stringify(JSON.parse(stableStringify(json.agentGate)), null, 2)}\n`],
    [`${p.site}/meta.json`, `${JSON.stringify(JSON.parse(stableStringify(json.meta)), null, 2)}\n`],
  ];
  for (const [path, text] of files) writeAtomic(path, text);
  return { markdown };
}