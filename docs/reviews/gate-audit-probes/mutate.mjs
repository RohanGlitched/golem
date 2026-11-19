// Mutation check of the gate tests. Copies skeleton/{src,test} to a scratch dir, applies ONE mutant at a time to the COPY,
// runs the gate/expectation tests, and reports KILLED or SURVIVED. The real source is never touched.
// Run from the repo root: node docs/reviews/gate-audit-probes/mutate.mjs
import { cpSync, readFileSync, writeFileSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const work = join(here, '_mutant-run');
if (existsSync(work)) rmSync(work, { recursive: true, force: true });
cpSync(join(repo, 'skeleton', 'src'), join(work, 'src'), { recursive: true });
cpSync(join(repo, 'skeleton', 'test'), join(work, 'test'), { recursive: true });
for (const f of ['package.json', 'tsconfig.json', 'vitest.config.ts']) copyFileSync(join(repo, 'skeleton', f), join(work, f));
// tsconfig.json extends ../tsconfig.base.json; give the copy a sibling at the same relative place.
copyFileSync(join(repo, 'tsconfig.base.json'), join(here, 'tsconfig.base.json'));

const tests = ['src/cli/__tests__/expectation.test.ts', 'src/cli/__tests__/gate-kiro.test.ts', 'src/cli/__tests__/commands.test.ts'];
const WARN_GATE = 'for (const m of expectations.problems) errLine(io, `golem gate: warning: ${m}`);';
const mutants = [
  ['M1', 'src/cli/expectation.ts', "DEFAULT_EXPECTATION: Expectation = 'Expected_Hold'", "DEFAULT_EXPECTATION: Expectation = 'Expected_Break'", 'a line with no row defaults to Expected_Break'],
  ['M2', 'src/cli/expectation.ts', "return e === 'Expected_Break' ? status === 'broken' : status === 'held';", "return e === 'Expected_Break' ? status !== 'held' : status === 'held';", 'an error verdict meets Expected_Break'],
  ['M3', 'src/cli/expectation.ts', '/^expected[_ -]?(hold|break)$/i', '/^Expected_(Hold|Break)$/', 'value match becomes case-sensitive (canonical spelling only)'],
  ['M4', 'src/cli/expectation.ts', 'text.split(/\\r?\\n/)', "text.split('\\n')", 'parser no longer splits CRLF'],
  ['M5', 'src/cli/expectation.ts', "if (!s.trim().startsWith('|')) { idCol = -1; expCol = -1; continue; }", "if (!s.trim().startsWith('|')) { continue; }", 'a table does not end at the first non-table line'],
  ['M6', 'src/cli/expectation.ts', 'if (byId.has(id)) problems.push(`line ${i + 1}: ${id} appears twice in the expectation table; the first row is used`);\n    else byId.set(', 'if (byId.has(id)) { }\n    else byId.set(', 'duplicate-row warning removed'],
  ['M6b', 'src/cli/expectation.ts', "else byId.set(id, m[1]?.toLowerCase() === 'break'", "if (true) byId.set(id, m[1]?.toLowerCase() === 'break'", 'last duplicate row wins instead of the first'],
  ['M7', 'src/cli/commands/gate.ts', WARN_GATE, '', 'gate prints no table warnings'],
  ['M8', 'src/cli/commands/gate-kiro.ts', WARN_GATE, '', 'gate --kiro prints no table warnings'],
  ['M9', 'src/cli/format.ts', ', or move this line to Expected_Hold if the controller now holds it', '', 'the "move this line to Expected_Hold" advice removed'],
  ['M10', 'src/cli/commands/gate-kiro.ts', "ears: j.expectation === 'Expected_Break' ? `${j.outcome.req.source} (${j.miss})` : j.outcome.req.source", 'ears: j.outcome.req.source', 'override message drops the expectation miss text'],
  ['M11', 'src/cli/commands/gate.ts', "const grouped = judged.some((j) => j.expectation === 'Expected_Break');", 'const grouped = false;', 'grouped output never printed'],
  ['M12', 'src/cli/expectation.ts', "for (const [k, v] of p.byId) if (!byId.has(k)) byId.set(k, v);", "for (const [k, v] of p.byId) byId.set(k, v);", 'merge: last file wins'],
  ['M13', 'src/cli/expectation.ts', 'const isSeparator = (row: string): boolean => /^\\s*\\|?[\\s:|-]+\\|?\\s*$/.test(row) && row.includes(\'-\');', 'const isSeparator = (row: string): boolean => /^\\s*\\|?[\\s:|-]+\\|?\\s*$/.test(row);', 'separator test loosened (an empty-ish row counts)'],
  ['M14', 'src/cli/expectation.ts', "s.split('|').map((c) => c.trim().replace(/^[*`_]+|[*`_]+$/g, ''))", "s.split('|').map((c) => c.trim())", 'bold/backtick stripping removed'],
  ['M15', 'src/cli/expectation.ts', "const a = c.findIndex((x) => /^criterion$/i.test(x));", "const a = c.findIndex((x) => /^Criterion$/.test(x));", 'header match case-sensitive'],
  ['M16', 'src/cli/expectation.ts', 'const cells = (row: string): string[] => {', 'const cells = (row: string): string[] => { void 0;', 'CONTROL: no-op, must SURVIVE'],
];

const run = () => {
  try { execSync(`npx --no-install vitest run ${tests.join(' ')}`, { cwd: work, stdio: 'pipe', encoding: 'utf8' }); return false; }
  catch (e) { return /failed/.test(`${e.stdout}${e.stderr}`); }
};
if (run()) {
  // The harness is only valid when the unmutated copy passes.
  try { execSync(`npx --no-install vitest run ${tests.join(' ')}`, { cwd: work, stdio: 'pipe', encoding: 'utf8' }); }
  catch (e) { console.log(`BASELINE FAILS in the copy:\n${String(e.stdout).slice(-1500)}\n${String(e.stderr).slice(-1500)}`); }
  process.exit(1);
}
for (const [id, file, from, to, why] of mutants) {
  const p = join(work, file);
  const orig = readFileSync(p, 'utf8');
  if (!orig.includes(from)) { console.log(`${id}\tNOT-APPLIED\t${why}`); continue; }
  writeFileSync(p, orig.replace(from, to));
  const killed = run();
  writeFileSync(p, orig);
  console.log(`${id}\t${killed ? 'KILLED  ' : 'SURVIVED'}\t${why}`);
}
rmSync(work, { recursive: true, force: true });
rmSync(join(here, 'tsconfig.base.json'), { force: true });
