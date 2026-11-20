// The strongest push line each yard robot's gate turns green: requirement mining with GOLEM's own gate.
//
//   node apps/yard/scripts/strongest.mjs [id ...]      (from the repository root; needs board.json and a built skeleton)
//
// For each robot that stands, it writes a one-line requirements file
//   WHEN the base is pushed with up to P% of its weight for 0.2 s from any direction THE robot SHALL stay upright for 3 s
// and runs the real `golem gate --budget 128 --search-seed 1` on it (which confirms a green with a second search seed).
// It starts at the weakest push on the robot's stance rose, rounded down to a whole percent, and steps P by 1 until it
// finds the largest P whose gate is green with P + 1 red. Every gate run is recorded in strongest.json with its exit code.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const YARD = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(YARD, '../..');
const CLI = join(ROOT, 'skeleton/dist/cli/main.js');
const BUDGET = 128;
const board = JSON.parse(readFileSync(join(YARD, 'board.json'), 'utf8'));
const ids = process.argv.slice(2);
const OUT = join(YARD, 'strongest.json');
const old = (() => { try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return { robots: [] }; } })();

export const line = (p) => `WHEN the base is pushed with up to ${p}% of its weight for 0.2 s from any direction THE robot SHALL stay upright for 3 s`;

function gate(id, p) {
  const dir = join(YARD, 'robots', id, '.strongest');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'requirements.md'), `# Requirements Document\n\n## Requirements\n\n### Requirement 1: Strongest push\n\n#### Acceptance Criteria\n\n1. ${line(p)}\n`);
  writeFileSync(join(dir, 'golem.config.json'), JSON.stringify({ app: '../app.ts', requirements: ['requirements.md'], robot: `yard-${id}-strongest` }, null, 2));
  const t0 = Date.now();
  let code = 0, out = '';
  try {
    out = execFileSync(process.execPath, [CLI, 'gate', '--app', dir, '--budget', String(BUDGET), '--search-seed', '1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    code = e.status ?? 1; out = String(e.stdout ?? '');
  }
  rmSync(dir, { recursive: true, force: true });
  const verdict = out.split('\n').find((l) => /^gate (GREEN|RED)/.test(l.trim()))?.trim() ?? out.trim().split('\n').pop();
  const run = { percent: p, exit: code, green: code === 0, seconds: Math.round((Date.now() - t0) / 100) / 10, verdict };
  console.log(id, run);
  return run;
}

const rows = [];
for (const r of board.robots) {
  if (ids.length && !ids.includes(r.id)) { const prev = old.robots.find((x) => x.id === r.id); if (prev) rows.push(prev); continue; }
  if (!r.weakest || r.weakest.breaks === 0) { rows.push({ id: r.id, name: r.name, strongest: null, note: 'falls before any push', runs: [] }); continue; }
  const runs = [];
  let p = Math.max(1, Math.floor(r.weakest.breaks * 100));
  let g = gate(r.id, p); runs.push(g);
  if (g.green) {
    // climb while green
    for (;;) { const n = gate(r.id, p + 1); runs.push(n); if (!n.green) break; p += 1; }
  } else {
    // descend until green
    while (p > 1) { p -= 1; const n = gate(r.id, p); runs.push(n); if (n.green) break; }
  }
  const strongest = runs.filter((x) => x.green).reduce((m, x) => Math.max(m, x.percent), 0) || null;
  rows.push({ id: r.id, name: r.name, roseWeakest: r.weakest.breaks, strongest, line: strongest ? line(strongest) : null, runs });
}
writeFileSync(OUT, JSON.stringify({ budget: BUDGET, searchSeed: 1, command: `golem gate --budget ${BUDGET} --search-seed 1`, robots: rows }, null, 1) + '\n');
console.log('wrote', OUT);
