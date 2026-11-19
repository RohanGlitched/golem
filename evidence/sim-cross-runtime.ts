// Cross-runtime check (not a CI test, golem-sim Req 1.11): runs a fixed Test_App trial and writes
// t and signals as JSONL. Compare a Node file with a browser file: t bit-identical, signals within
// 1e-9 relative.
//   Node:     npx vite-node evidence/sim-cross-runtime.ts
//   Compare:  npx vite-node evidence/sim-cross-runtime.ts compare <a.jsonl> <b.jsonl>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModelCache, makeTestRequirement, runTrial, testApp } from '../skeleton/src/sim/index.js';

interface CrossRuntimeRecord {
  runtime: string; t: number[]; signals: Record<string, number[]>; robustness: number; worstAt: number;
}

const FIXED_SPEC = { app: 'test', reqId: 'R1', scenario: { 'push.force': 12, 'push.angle': 2.5 }, seed: 20251031 };

async function runFixedTrial(runtime: string): Promise<CrossRuntimeRecord> {
  const cache = new ModelCache();
  const req = makeTestRequirement({ horizon: 1 });
  let rec: CrossRuntimeRecord | undefined;
  const wrapped = {
    ...req,
    monitor: (tr: any) => {
      const r = req.monitor(tr);
      rec = {
        runtime, t: Array.from(tr.t as Float64Array),
        signals: Object.fromEntries(Object.entries(tr.signals as Record<string, Float64Array>).map(([k, v]) => [k, Array.from(v)])),
        robustness: r.robustness, worstAt: r.worstAt,
      };
      return r;
    },
  };
  await runTrial(testApp, wrapped, FIXED_SPEC, { cache });
  cache.dispose();
  return rec as CrossRuntimeRecord;
}

/** t must be bit-identical; signals must agree within 1e-9 relative. Returns a list of problems. */
function compareRecords(a: CrossRuntimeRecord, b: CrossRuntimeRecord): string[] {
  const problems: string[] = [];
  if (a.t.length !== b.t.length) problems.push(`t length ${a.t.length} vs ${b.t.length}`);
  else a.t.forEach((x, i) => { if (!Object.is(x, b.t[i])) problems.push(`t[${i}] differs: ${x} vs ${b.t[i]}`); });
  for (const name of Object.keys(a.signals)) {
    const sa = a.signals[name] as number[], sb = b.signals[name];
    if (!sb || sb.length !== sa.length) { problems.push(`signal ${name} missing or of different length`); continue; }
    sa.forEach((x, i) => {
      const y = sb[i] as number;
      const rel = Math.abs(x - y) / Math.max(Math.abs(x), Math.abs(y), 1e-300);
      if (!(x === y || rel <= 1e-9)) problems.push(`${name}[${i}] differs by relative ${rel}: ${x} vs ${y}`);
    });
  }
  return problems;
}

const readRecord = (p: string): CrossRuntimeRecord => JSON.parse(readFileSync(p, 'utf8').trim().split('\n')[0] as string);

async function main(): Promise<void> {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'compare' && a && b) {
    const problems = compareRecords(readRecord(a), readRecord(b));
    if (problems.length === 0) console.log('t is bit-identical and signals agree within 1e-9 relative');
    else { console.error(problems.slice(0, 20).join('\n')); process.exitCode = 1; }
    return;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const rec = await runFixedTrial(`node ${process.version}`);
  mkdirSync(join(here, 'results'), { recursive: true });
  const out = join(here, 'results', 'sim-cross-runtime.node.jsonl');
  writeFileSync(out, JSON.stringify(rec) + '\n');
  console.log(`wrote ${out}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

