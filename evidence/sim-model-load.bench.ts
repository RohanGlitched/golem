// Benchmark (not a CI test): first MuJoCo load plus first model compile for the Unitree G1.
// Budget: 5 s (golem-sim Req 1.9 and 3.12). Run: npx vite-node evidence/sim-model-load.bench.ts
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModelCache, loadMujoco } from '../skeleton/src/sim/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const robotDir = join(here, '..', 'apps', 'stagger', 'robot');
const sceneFile = 'scene.xml';
const BUDGET_MS = 5000;

function readTree(dir: string, out: Record<string, Uint8Array> = {}, root = dir): Record<string, Uint8Array> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) readTree(p, out, root);
    else if (name !== '.gitkeep') out[relative(root, p).split('\\').join('/')] = new Uint8Array(readFileSync(p));
  }
  return out;
}

async function main(): Promise<void> {
  if (!existsSync(join(robotDir, sceneFile))) {
    console.log(`apps/stagger/robot/${sceneFile} is not present: the Unitree G1 assets are not installed, so there is nothing to benchmark.`);
    return;
  }
  const files = readTree(robotDir);
  const app: any = { id: 'stagger', name: 'Unitree G1', sceneFile, files: async () => files };
  const t0 = performance.now();
  await loadMujoco();
  const loadMs = performance.now() - t0;
  const cache = new ModelCache();
  const t1 = performance.now();
  await cache.getModel(app);
  const compileMs = performance.now() - t1;
  cache.dispose();
  const totalMs = loadMs + compileMs;
  const row = {
    bench: 'sim-model-load', app: 'stagger', date: new Date().toISOString(), node: process.version,
    loadMs, compileMs, totalMs, budgetMs: BUDGET_MS, withinBudget: totalMs <= BUDGET_MS,
  };
  mkdirSync(join(here, 'results'), { recursive: true });
  appendFileSync(join(here, 'results', 'sim-model-load.jsonl'), JSON.stringify(row) + '\n');
  console.log(`load ${loadMs.toFixed(0)} ms + compile ${compileMs.toFixed(0)} ms = ${totalMs.toFixed(0)} ms (budget ${BUDGET_MS} ms): ${row.withinBudget ? 'within budget' : 'OVER BUDGET'}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
