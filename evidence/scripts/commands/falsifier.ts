import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { availableParallelism } from 'node:os';
import { falsify } from 'golem-spec';
import { expectedBreaks, summarizeFalsifier, type FalsifierRecord } from '../core/falsifier-summary.js';
import { appendJsonl, readJsonl, stableStringify } from '../core/jsonl.js';
import { runCampaign } from '../falsifier.js';
import { openEngine } from '../lib/engine.js';
import { intFlag, listFlag } from '../lib/args.js';
import { defaultResultsDir, gitCommit, gitDirty, repoRoot } from '../lib/meta.js';

type Flags = Record<string, string | true>;

export async function run(flags: Flags): Promise<void> {
  const seedsN = intFlag(flags, 'seeds', 20);
  const budget = intFlag(flags, 'budget', 96);
  const size = flags['size'] !== undefined ? intFlag(flags, 'size', 1) : undefined;
  const out = typeof flags['out'] === 'string' ? (flags['out'] as string) : defaultResultsDir;
  const only = listFlag(flags, 'only');
  mkdirSync(out, { recursive: true });
  const outPath = `${out}/falsifier.jsonl`;
  const t0 = performance.now();
  const seeds = Array.from({ length: seedsN }, (_, i) => i + 1);
  const apps: { name: string; dir: string }[] = [];
  for (const name of ['stagger', 'candy']) {
    const dir = `${repoRoot}/apps/${name}`;
    if (existsSync(`${dir}/golem.config.json`)) apps.push({ name, dir });
    else console.log(`${name}: no golem.config.json, skipped (PREREG scope)`);
  }
  const info: Record<string, unknown> = {};
  for (const a of apps) {
    const eng = await openEngine(a.dir, size !== undefined ? { size } : {});
    try {
      const text = Object.values(eng.texts).join('\n');
      const ids = expectedBreaks(text).filter((id) => only === undefined || only.includes(id));
      info[a.name] = { expectedBreakIds: ids, poolSize: eng.pool.size };
      const existing = readJsonl<FalsifierRecord>(outPath).filter((r) => r.app === eng.app.id);
      await runCampaign({
        app: eng.app.id, reqIds: ids, requirements: eng.requirements, seeds, budget, falsify, pool: eng.pool,
        outPath, existing, append: appendJsonl, now: () => performance.now(), log: (s) => console.log(s),
      });
    } finally {
      await eng.close();
    }
  }
  const records = readJsonl<FalsifierRecord>(outPath);
  const summary = {
    meta: {
      commit: gitCommit(), engineDirty: gitDirty(), budget, searchSeeds: seeds.length, apps: info, node: process.version,
      logicalCores: availableParallelism(), seconds: Math.round((performance.now() - t0) / 100) / 10, generated: new Date().toISOString(),
    },
    summary: summarizeFalsifier(records, budget),
  };
  writeFileSync(`${out}/falsifier.summary.json`, `${JSON.stringify(JSON.parse(stableStringify(summary)), null, 2)}\n`);
  console.log(JSON.stringify(summary.summary.map((s) => ({ req: s.reqId, guided: `${s.guided.found}/${s.guided.n}`, random: `${s.random.found}/${s.random.n}`, pTrials: s.trialsTest.p })), null, 1));
}

