// Writes site/data/changelog.json: milestone commits of this branch, newest first, from `git log`.
// A milestone is a merge, a final checkpoint, a site page, a README or infra change, or an evidence result.
// Usage: node site/scripts/gen-changelog.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = fileURLToPath(new URL('../data/changelog.json', import.meta.url));
const log = execFileSync('git', ['log', '--format=%ad%x09%h%x09%s', '--date=short', '-n', '400'], { cwd: root, encoding: 'utf8' });
const MILESTONE = /^(golem-site: \d|README|infra:|golem-evidence: [0-5] |evidence: |site: |golem-kit: |.*final checkpoint)/;

const entries = log.split('\n').filter(Boolean).map((l) => {
  const [date, hash, ...rest] = l.split('\t');
  return { date, hash, subject: rest.join('\t') };
}).filter((e) => MILESTONE.test(e.subject)).slice(0, 12);

writeFileSync(out, JSON.stringify(entries, null, 2) + '\n');
console.log(`wrote ${out}: ${entries.length} entries, newest ${entries[0]?.hash} ${entries[0]?.subject}`);
