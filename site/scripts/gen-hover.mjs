// Writes site/data/hover.json: the hover measurement, read from the real CLI output that apps/hover committed
// (apps/hover/docs/cli-transcript.md) and from the lines of apps/hover/.kiro/specs/hover-hold/requirements.md.
// Nothing is typed in: every number on the home page comes from this file. Usage: node site/scripts/gen-hover.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = fileURLToPath(new URL('../data/hover.json', import.meta.url));
const TRANSCRIPT = 'apps/hover/docs/cli-transcript.md';
const SPEC = 'apps/hover/.kiro/specs/hover-hold/requirements.md';

const transcript = readFileSync(root + TRANSCRIPT, 'utf8');
const spec = readFileSync(root + SPEC, 'utf8');

// the lines and their Expectation, from the spec
const lines = new Map();
for (const m of spec.matchAll(/^(\d+)\. ((?:WHEN|WHILE|IF|WHERE|THE) .+)$/gm)) {
  const req = [...spec.slice(0, m.index).matchAll(/^### Requirement (\d+):/gm)].pop();
  lines.set(`${req[1]}.${m[1]}`, { id: `${req[1]}.${m[1]}`, source: m[2].trim() });
}
for (const m of spec.matchAll(/^\|\s*(\d+\.\d+)\s*\|[^|]*\|\s*(Expected_Hold|Expected_Break)\s*\|\s*$/gm)) {
  const l = lines.get(m[1]);
  if (!l) throw new Error(`Expectation row ${m[1]} has no criterion`);
  l.expectation = m[2];
}

// the `test` runs of the transcript: one block per `## ... test ...` heading
const runs = [];
for (const section of transcript.split(/^## /m).slice(1)) {
  const heading = section.split('\n')[0];
  const cmd = /`npx --no-install golem-spec (test[^`]*)`/.exec(heading);
  if (!cmd) continue;
  const code = /```text\n([\s\S]*?)\n```/.exec(section)?.[1] ?? '';
  const seed = Number(/--search-seed (\d+)/.exec(cmd[1])?.[1] ?? 1);
  const budget = Number(/--budget (\d+)/.exec(cmd[1])?.[1]);
  const results = {};
  for (const row of code.split('\n')) {
    const m = /^(\d+\.\d+)\s+(HELD|BROKEN)\s+(?:closest )?margin ([+-]?[\d.]+) (\S+)\s+(.*?)\s+\[(Expected_Hold|Expected_Break): (met|NOT met)\]$/.exec(row);
    if (!m) continue;
    const scenario = /\d+ trials\s+(.*?)\s+\((?:not )?shrunk, seed \d+\)/.exec(m[5])?.[1];
    results[m[1]] = {
      status: m[2].toLowerCase(), margin: Number(m[3]), unit: m[4],
      ...(scenario ? { scenario } : {}), expectationMet: m[7] === 'met',
    };
  }
  runs.push({ command: `npx --no-install golem-spec ${cmd[1]}`, searchSeed: seed, budget, results });
}
if (runs.length === 0) throw new Error(`${TRANSCRIPT} has no test run`);

const ids = [...lines.keys()];
for (const r of runs) {
  const got = Object.keys(r.results).sort().join(',');
  if (got !== [...ids].sort().join(',')) throw new Error(`${TRANSCRIPT}: run "${r.command}" lacks a verdict for some line (${got})`);
}

const summary = ids.map((id) => {
  const l = lines.get(id);
  const verdicts = runs.map((r) => r.results[id]);
  const statuses = new Set(verdicts.map((v) => v.status));
  const margins = verdicts.map((v) => v.margin);
  return {
    id, source: l.source, expectation: l.expectation,
    status: statuses.size === 1 ? [...statuses][0] : 'differs',
    unit: verdicts[0].unit,
    marginMin: Math.min(...margins), marginMax: Math.max(...margins),
    counterexamples: verdicts.map((v) => v.scenario).filter(Boolean),
    expectationMet: verdicts.every((v) => v.expectationMet),
  };
});

const data = {
  source: { transcript: TRANSCRIPT, spec: SPEC },
  budget: runs[0].budget,
  searchSeeds: runs.map((r) => r.searchSeed),
  lines: summary,
  runs,
};
writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
console.log(`wrote ${out}: ${summary.length} lines over ${runs.length} runs (search seeds ${data.searchSeeds.join(', ')}); ${summary.filter((s) => s.status === 'broken').map((s) => s.id).join(', ')} broke`);
