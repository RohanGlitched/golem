// G1 stability map: for each push direction and stride point, find by bisection the largest
// pelvis push (0.2 s) that Unitree's published walking policy survives for 3 s.
// Usage: npx tsx evidence/map-g1.mts [--shards 8] [--dirs 36] [--phases 4] [--steps 8] [--seeds 1]
// Writes evidence/results/g1-map.jsonl (one line per direction x phase x seed) and a summary.
import { fork } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ModelCache, compileRequirement, runTrial } from 'golem-spec';
import stagger from '../apps/stagger/app.ts';
import { lexicon } from '../apps/stagger/lexicon.ts';

const arg = (k: string, d: number) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const SHARDS = arg('shards', 8), DIRS = arg('dirs', 36), PHASES = arg('phases', 4), STEPS = arg('steps', 8), SEEDS = arg('seeds', 1);
const FMAX = arg('fmax', 400);
const OUT = fileURLToPath(new URL('./results/g1-map.jsonl', import.meta.url));
const LINE = 'R1. WHEN the pelvis is pushed with up to 400 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s';

type Cell = { dir: number; phase: number; seed: number };

async function worker(shard: number) {
  const cache = new ModelCache();
  const comp = compileRequirement(LINE, lexicon);
  if (!comp.requirement) throw new Error('compile failed: ' + JSON.stringify(comp.diagnostics));
  const req = comp.requirement;
  const cells: Cell[] = [];
  for (let d = 0; d < DIRS; d++) for (let p = 0; p < PHASES; p++) for (let s = 0; s < SEEDS; s++) cells.push({ dir: d, phase: p, seed: s });
  const mine = cells.filter((_, i) => i % SHARDS === shard);
  for (const c of mine) {
    const angle = (2 * Math.PI * c.dir) / DIRS, phase = c.phase / PHASES;
    const run = async (force: number) => (await runTrial(stagger, req, {
      app: 'stagger', reqId: 'R1', seed: 1000 + c.seed,
      scenario: { 'push.force': force, 'push.angle': angle, 'push.phase': phase },
    }, { cache })).robustness;
    let lo = 0, hi = FMAX, trials = 0, hiRob = NaN;
    const rTop = await run(hi); trials++;
    if (rTop >= 0) { lo = hi; hiRob = rTop; }
    else {
      hiRob = rTop;
      for (let k = 0; k < STEPS; k++) {
        const mid = (lo + hi) / 2; const r = await run(mid); trials++;
        if (r >= 0) lo = mid; else { hi = mid; hiRob = r; }
      }
    }
    process.send!({ dirDeg: (360 * c.dir) / DIRS, phase, seed: 1000 + c.seed, heldN: lo, brokeN: rTop >= 0 ? null : hi, trials });
  }
  cache.dispose();
}

async function main() {
  mkdirSync(fileURLToPath(new URL('./results/', import.meta.url)), { recursive: true });
  if (existsSync(OUT)) rmSync(OUT);
  const t0 = Date.now(); let n = 0; const rows: any[] = [];
  await Promise.all(Array.from({ length: SHARDS }, (_, s) => new Promise<void>((res, rej) => {
    const ch = fork(fileURLToPath(import.meta.url), [...process.argv.slice(2), '--shard', String(s)], { execArgv: process.execArgv });
    ch.on('message', (m: any) => { rows.push(m); appendFileSync(OUT, JSON.stringify(m) + '\n'); n++; if (n % 10 === 0) console.log(`${n} cells, ${((Date.now() - t0) / 1000).toFixed(0)} s`); });
    ch.on('exit', (code) => (code === 0 ? res() : rej(new Error(`shard ${s} exited ${code}`))));
  })));
  // Summary: per direction, the weakest phase boundary.
  const byDir = new Map<number, any[]>();
  for (const r of rows) (byDir.get(r.dirDeg) ?? byDir.set(r.dirDeg, []).get(r.dirDeg)!).push(r);
  const summary = [...byDir.entries()].sort((a, b) => a[0] - b[0]).map(([dirDeg, rs]) => {
    const weakest = rs.reduce((a, b) => (b.heldN < a.heldN ? b : a));
    return { dirDeg, minHeldN: weakest.heldN, weakestPhase: weakest.phase, meanHeldN: rs.reduce((s, r) => s + r.heldN, 0) / rs.length };
  });
  const overall = summary.reduce((a, b) => (b.minHeldN < a.minHeldN ? b : a));
  const strongest = summary.reduce((a, b) => (b.minHeldN > a.minHeldN ? b : a));
  const meta = { line: LINE, dirs: DIRS, phases: PHASES, seeds: SEEDS, steps: STEPS, fmax: FMAX, cells: rows.length, trials: rows.reduce((s, r) => s + r.trials, 0), seconds: (Date.now() - t0) / 1000, weakest: overall, strongest };
  writeFileSync(fileURLToPath(new URL('./results/g1-map.summary.json', import.meta.url)), JSON.stringify({ meta, summary }, null, 2));
  console.log(JSON.stringify(meta, null, 2));
}

const si = process.argv.indexOf('--shard');
if (si > 0) worker(Number(process.argv[si + 1])).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
else main().catch((e) => { console.error(e); process.exit(1); });
