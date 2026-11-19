// Probe 4: cross-check the committed requirements files: table ids vs criterion ids the compiler will produce.
// Run from skeleton/: npx tsx ../docs/reviews/gate-audit-probes/p4-real-specs.mts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { extractCriteria } from '../../../skeleton/src/ears/extract.js';
import { parseExpectations } from '../../../skeleton/src/cli/expectation.js';

const root = join(import.meta.dirname, '..', '..', '..');
const found: string[] = [];
const walk = (d: string): void => {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n === '.git' || n === 'dist') continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n === 'requirements.md' && p.includes(`${join('apps', '')}`)) found.push(p);
  }
};
walk(join(root, 'apps'));
for (const f of found) {
  const text = readFileSync(f, 'utf8');
  const crit = extractCriteria(text).criteria.map((c) => c.id);
  const { byId, problems } = parseExpectations(text);
  const tableIds = [...byId.keys()];
  console.log(`\n${f.replace(root, '.')}`);
  console.log(`  criteria: ${crit.length}  table rows: ${tableIds.length}  problems: ${problems.length}`);
  console.log(`  criteria without a row : ${JSON.stringify(crit.filter((c) => !byId.has(c)))}`);
  console.log(`  rows without a criterion: ${JSON.stringify(tableIds.filter((t) => !crit.includes(t)))}`);
  console.log(`  Expected_Break: ${JSON.stringify([...byId].filter(([, v]) => v === 'Expected_Break').map(([k]) => k))}`);
}
