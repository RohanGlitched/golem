// Writes site/data/candy.json: the candy P8 measurement (SSM_v1 against hand paths from the doorstep half).
// Source order: apps/candy/proposals.md and evidence/results/candy-p8-doorstep.jsonl in this checkout; when the
// checkout has the older P8 (no link7 measurement), the same two files on the branch that holds them (CANDY_REF,
// default build/candy2). The JSON records which commit it came from. Usage: node site/scripts/gen-candy.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = fileURLToPath(new URL('../data/candy.json', import.meta.url));
const ref = process.env.CANDY_REF ?? 'build/candy2';
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });

const PROPOSALS = 'apps/candy/proposals.md';
const ROWS = 'evidence/results/candy-p8-doorstep.jsonl';

let proposals = existsSync(root + PROPOSALS) ? readFileSync(root + PROPOSALS, 'utf8') : '';
let rowsText = existsSync(root + ROWS) ? readFileSync(root + ROWS, 'utf8') : '';
let source = { where: 'working tree', commit: git('rev-parse', 'HEAD').trim() };
if (!/link7/.test(proposals) || !rowsText) {
  proposals = git('show', `${ref}:${PROPOSALS}`);
  rowsText = git('show', `${ref}:${ROWS}`);
  source = { where: `branch ${ref}`, commit: git('rev-parse', ref).trim() };
}

const section = proposals.split(/^## /m).find((s) => s.startsWith('P8.'));
if (!section) throw new Error('P8 not found in proposals.md');
const rows = rowsText.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => typeof r.broken === 'boolean');
const broken = rows.filter((r) => r.broken);
const count = (key) => broken.reduce((m, r) => ((m[r[key]] = (m[r[key]] ?? 0) + 1), m), {});
const worst = broken.reduce((a, b) => (b.minDistance < a.minDistance ? b : a), broken[0]);
const heading = section.split('\n')[0].replace(/^P8\.\s*/, '').trim();
const paragraphs = section.split('\n').slice(1).join('\n').trim().split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim());

const data = {
  source,
  line: '1.1',
  heading,
  trials: rows.length,
  broken: broken.length,
  closestLinkAtBreak: count('link'),
  worstMinDistanceM: worst.minDistance,
  worstTipDistanceM: worst.tipDistance,
  handSpeedMps: worst.speed,
  paragraphs,
};
writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
console.log(`wrote ${out}: ${broken.length} of ${rows.length} broke, closest link ${JSON.stringify(data.closestLinkAtBreak)} (${source.where})`);
