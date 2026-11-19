import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { compareRows, type MapRow } from '../core/map.js';
import { readJsonl, stableStringify } from '../core/jsonl.js';
import { DEFAULT_PARAMS, MAP_REQUIREMENTS_FILE, mapLine, mapSummary, runMap } from '../map-g1.js';
import { openEngine } from '../lib/engine.js';
import { intFlag, listFlag } from '../lib/args.js';
import { defaultResultsDir, gitCommit, gitDirty, repoRoot } from '../lib/meta.js';

type Flags = Record<string, string | true>;

export async function run(flags: Flags): Promise<void> {
  const out = typeof flags['out'] === 'string' ? (flags['out'] as string) : defaultResultsDir;
  const size = flags['size'] !== undefined ? intFlag(flags, 'size', 1) : undefined;
  const dirIndices = listFlag(flags, 'dir-indices')?.map(Number);
  const params = {
    line: mapLine(),
    dirs: intFlag(flags, 'dirs', DEFAULT_PARAMS.dirs), phases: intFlag(flags, 'phases', DEFAULT_PARAMS.phases),
    seeds: intFlag(flags, 'seeds', DEFAULT_PARAMS.seeds), steps: intFlag(flags, 'steps', DEFAULT_PARAMS.steps),
    fmax: intFlag(flags, 'fmax', DEFAULT_PARAMS.fmax),
  };
  mkdirSync(out, { recursive: true });
  const outPath = `${out}/g1-map.jsonl`;
  const t0 = performance.now();
  const eng = await openEngine(`${repoRoot}/apps/stagger`, { requirementFiles: [MAP_REQUIREMENTS_FILE], ...(size !== undefined ? { size } : {}) });
  let rows: MapRow[];
  try {
    const reqId = eng.requirements[0]?.id;
    if (!reqId) throw new Error('the map requirement did not compile');
    rows = await runMap({ params, appId: eng.app.id, reqId, pool: eng.pool, outPath, ...(dirIndices ? { dirIndices } : {}), log: (s) => console.log(s), now: () => performance.now() });
  } finally {
    await eng.close();
  }
  const seconds = Math.round(performance.now() - t0) / 1000;
  if (flags['verify'] === true) {
    const committed = readJsonl<MapRow>(`${defaultResultsDir}/g1-map.jsonl`);
    const cmp = compareRows(rows, committed);
    const rec = { dirIndices: dirIndices ?? null, cells: cmp.compared, trials: rows.reduce((s, r) => s + r.trials, 0), equal: cmp.equal, missing: cmp.missing, mismatched: cmp.mismatched, commit: gitCommit(), engineDirty: gitDirty(), seconds };
    writeFileSync(`${defaultResultsDir}/g1-map.verify.json`, `${JSON.stringify(JSON.parse(stableStringify(rec)), null, 2)}\n`);
    console.log(`verify: ${cmp.compared} cells compared with the committed rows, ${cmp.mismatched.length} mismatched, ${cmp.missing.length} missing, equal = ${cmp.equal}`);
    if (!cmp.equal) process.exitCode = 3;
    return;
  }
  const summary = mapSummary(rows, params, seconds);
  writeFileSync(`${out}/g1-map.summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary.meta, null, 2));
}
