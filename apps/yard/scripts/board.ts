// The yard board: the same requirements file on every yard robot, plus a stance rose for each one.
//
//   npx vite-node apps/yard/scripts/board.ts [id ...]     (from the repository root)
//
// 1. Verdicts: `golem test --json` on each robot's folder (search seed 1, BUDGET trials per line), as a user would run it.
// 2. The stance rose: for each of DIRECTIONS directions, the smallest push (as a share of the robot's weight) that topples
//    it, found by bisection on line 1.4 with GOLEM's own trial runner (runTrial, seed 1). A direction that holds at 100%
//    is recorded as null. The rose is a measurement, separate from the falsifier; the two are compared in board.md.
// Writes apps/yard/board.json and apps/yard/board.md.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileRequirementsFile } from '../../../skeleton/src/ears/index';
import { ModelCache, runTrial } from '../../../skeleton/src/sim/index';
import { ROBOTS, COMMIT, type StandApp } from '../stand';

const YARD = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(YARD, '../..');
const CLI = join(ROOT, 'skeleton/dist/cli/main.js');
const REQ = join(YARD, '.kiro/specs/stand-push/requirements.md');
export const BUDGET = 128;
export const DIRECTIONS = 24;
export const BISECT_STEPS = 9;

interface Verdict {
  reqId: string; status: string; trials: number; met: boolean;
  closest?: { robustness: number; scenario: Record<string, number> };
  counterexample?: { scenario: Record<string, number>; robustness: number; shrunk: boolean; seed: number };
}

async function rose(app: StandApp): Promise<{ deg: number; breaks: number | null }[]> {
  const text = readFileSync(REQ, 'utf8');
  const { requirements } = compileRequirementsFile(text, app.lexicon as never);
  const req = requirements.find((r) => r.id === '1.4');
  if (!req) throw new Error('line 1.4 did not compile');
  const cache = new ModelCache();
  const topples = async (ratio: number, angle: number): Promise<boolean> => {
    const r = await runTrial(app as never, req, { app: app.id, reqId: '1.4', scenario: { 'push.weight': ratio, 'push.angle': angle }, seed: 1 }, { cache });
    return r.robustness < 0;
  };
  const out: { deg: number; breaks: number | null }[] = [];
  for (let i = 0; i < DIRECTIONS; i++) {
    const deg = (360 / DIRECTIONS) * i, a = (deg * Math.PI) / 180;
    if (await topples(0, a)) { out.push({ deg, breaks: 0 }); continue; }
    if (!(await topples(1, a))) { out.push({ deg, breaks: null }); continue; }
    let lo = 0, hi = 1;
    for (let k = 0; k < BISECT_STEPS; k++) {
      const mid = (lo + hi) / 2;
      if (await topples(mid, a)) hi = mid; else lo = mid;
    }
    out.push({ deg, breaks: Math.round(hi * 1000) / 1000 });
  }
  cache.dispose();
  return out;
}

const ids = process.argv.slice(2);
const old = (() => { try { return JSON.parse(readFileSync(join(YARD, 'board.json'), 'utf8')); } catch { return undefined; } })();
const rows: unknown[] = [];
for (const r of ROBOTS) {
  if (ids.length && !ids.includes(r.id)) { const prev = old?.robots?.find((x: { id: string }) => x.id === r.id); if (prev) rows.push(prev); continue; }
  const t0 = performance.now();
  const dir = join(YARD, 'robots', r.id);
  const app = (await import(`../robots/${r.id}/app.ts`)).default as StandApp;
  let json: string;
  try {
    json = execFileSync(process.execPath, [CLI, 'test', '--app', dir, '--budget', String(BUDGET), '--search-seed', '1', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    json = (e as { stdout?: string }).stdout ?? ''; // exit 1 when a line breaks; the JSON is still printed
  }
  const verdicts = (JSON.parse(json) as { verdicts: Verdict[] }).verdicts;
  const tRose = performance.now();
  const polar = await rose(app);
  const breaks = polar.map((p) => p.breaks).filter((b): b is number => b !== null);
  const weakest = polar.reduce<{ deg: number; breaks: number } | null>((w, p) => (p.breaks !== null && (w === null || p.breaks < w.breaks) ? { deg: p.deg, breaks: p.breaks } : w), null);
  const row = {
    id: r.id, name: r.name, kind: r.kind, folder: r.folder,
    lines: verdicts.map((v) => ({
      id: v.reqId, status: v.status, trials: v.trials,
      closest: v.closest?.robustness ?? null,
      counterexample: v.counterexample ? { weight: v.counterexample.scenario['push.weight'], deg: ((v.counterexample.scenario['push.angle'] ?? 0) * 180) / Math.PI, shrunk: v.counterexample.shrunk } : null,
    })),
    rose: polar,
    weakest,
    strongestBreak: breaks.length ? Math.max(...breaks) : null,
    seconds: { verdicts: Math.round((tRose - t0) / 100) / 10, rose: Math.round((performance.now() - tRose) / 100) / 10 },
  };
  rows.push(row);
  console.log(r.id, verdicts.map((v) => `${v.reqId} ${v.status}`).join(', '), 'weakest', weakest, `${row.seconds.verdicts}s + ${row.seconds.rose}s`);
}

const board = { commit: COMMIT, requirements: 'apps/yard/.kiro/specs/stand-push/requirements.md', budget: BUDGET, searchSeed: 1, directions: DIRECTIONS, bisectSteps: BISECT_STEPS, robots: rows };
writeFileSync(join(YARD, 'board.json'), JSON.stringify(board, null, 1) + '\n');

const pct = (x: number | null | undefined): string => (x === null || x === undefined ? 'holds at 100%' : `${(x * 100).toFixed(1)}%`);
const md = [
  '# The yard board',
  '',
  `One requirements file ([stand-push](.kiro/specs/stand-push/requirements.md)) on ${rows.length} MuJoCo Menagerie robots, each standing in its keyframe pose on its own position servos at stock gains (no balance controller). Generated by \`scripts/board.ts\`: verdicts from \`golem test --budget ${BUDGET} --search-seed 1\`; the weakest push from a bisection over ${DIRECTIONS} directions (${BISECT_STEPS} steps each) with GOLEM's trial runner.`,
  '',
  '| Robot | 1.1 (10%) | 1.2 (25%) | 1.3 (50%) | 1.4 (100%) | 2.1 (stays within 5 cm) | Weakest push that topples it | From |',
  '|---|---|---|---|---|---|---|---|',
  ...(rows as { name: string; lines: { id: string; status: string }[]; weakest: { deg: number; breaks: number } | null }[]).map((r) => {
    const s = (id: string): string => r.lines.find((l) => l.id === id)?.status.toUpperCase() ?? '-';
    return `| ${r.name} | ${s('1.1')} | ${s('1.2')} | ${s('1.3')} | ${s('1.4')} | ${s('2.1')} | ${r.weakest ? pct(r.weakest.breaks) : 'none up to 100%'} | ${r.weakest ? `${r.weakest.deg} deg` : '-'} |`;
  }),
  '',
].join('\n');
writeFileSync(join(YARD, 'board.md'), md);
console.log('wrote board.json and board.md');
