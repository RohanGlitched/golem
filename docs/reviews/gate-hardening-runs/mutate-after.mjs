// Mutation check of the gate tests after golem-gate-hardening: the audit's mutate.mjs with the anchors moved to the new code,
// the tests of the whole feature, and mutants for each fix. Copies skeleton/{src,test} to a scratch dir, applies ONE mutant
// at a time to the COPY, runs the tests, reports KILLED or SURVIVED. The real source is never touched.
// Run from the repo root: node docs/reviews/gate-hardening-runs/mutate-after.mjs
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

const dir = 'src/cli/__tests__/';
const tests = [
  'expectation', 'expectation-read', 'expectation-reconcile', 'expectation-markdown', 'expectation-duplicates', 'expectation-rows',
  'gate-kiro', 'gate-table-errors', 'gate-marks', 'gate-override', 'gate-retry', 'commands',
].map((n) => `${dir}${n}.test.ts`);
const mutants = [
  ['M1', 'src/cli/expectation.ts', "DEFAULT_EXPECTATION: Expectation = 'Expected_Hold'", "DEFAULT_EXPECTATION: Expectation = 'Expected_Break'", 'a line with no row defaults to Expected_Break'],
  ['M2', 'src/cli/expectation.ts', "return e === 'Expected_Break' ? status === 'broken' : status === 'held';", "return e === 'Expected_Break' ? status !== 'held' : status === 'held';", 'an error verdict meets Expected_Break'],
  ['M3', 'src/cli/expectation.ts', '/^expected[_ -]?(hold|break)$/i', '/^Expected_(Hold|Break)$/', 'value match becomes case-sensitive (canonical spelling only)'],
  ['M4', 'src/cli/expectation.ts', 'text.split(/\\r\\n|\\r|\\n/)', "text.split('\\n')", 'parser splits only on LF (CRLF is then equivalent, lone CR is not)'],
  ['M5', 'src/cli/expectation.ts', 'if (!hasPipe(s)) { idCol = -1; expCol = -1; continue; }', 'if (!hasPipe(s)) { continue; }', 'a table does not end at the first non-table line'],
  ['M6', 'src/cli/expectation.ts', 'if (f.expectation === r.expectation) {', 'if (f.expectation === r.expectation) { continue;', 'the same-mark duplicate warning removed'],
  ['M6b', 'src/cli/expectation.ts', 'conflicted.has(r.id) || unreadable.has(r.id) ? DEFAULT_EXPECTATION', 'unreadable.has(r.id) ? DEFAULT_EXPECTATION', 'a conflicting duplicate is no longer Expected_Hold (first row wins)'],
  ['M7', 'src/cli/commands/gate.ts', 'for (const i of expectations.issues) errLine(io, `golem gate: ${formatIssue(i, (f) => displayPath(io.cwd, f))}`);', '', 'gate prints no table warnings'],
  ['M8', 'src/cli/commands/gate-kiro.ts', 'for (const i of expectations.issues) errLine(io, `golem gate: ${formatIssue(i, show)}`);', '', 'gate --kiro prints no table warnings on stderr (ran branch)'],
  ['M9', 'src/cli/format.ts', ' Do not edit requirements.md yourself.', '', 'the "do not edit requirements.md yourself" advice removed'],
  ['M10', 'src/cli/commands/gate-kiro.ts', "ears: j.expectation === 'Expected_Break' ? `${j.outcome.req.source} (${j.miss})` : j.outcome.req.source,", 'ears: j.outcome.req.source,', 'override message drops the expectation miss text'],
  ['M11', 'src/cli/commands/gate.ts', "const grouped = judged.some((j) => j.expectation === 'Expected_Break');", 'const grouped = false;', 'grouped output never printed'],
  ['M12', 'src/cli/expectation.ts', 'const resolved = resolveRows(rows);\n  // Issues in file order', 'const resolved = resolveRows(rows.slice(0, 0));\n  // Issues in file order', 'merge ignores the rows of every file'],
  ['M13', 'src/cli/expectation.ts', "const isSeparator = (row: string): boolean => /^\\s*\\|?[\\s:|-]+\\|?\\s*$/.test(row) && row.includes('-');", "const isSeparator = (row: string): boolean => /^\\s*\\|?[\\s:|-]+\\|?\\s*$/.test(row);", 'separator test loosened (a row of colons counts)'],
  ['M14', 'src/cli/expectation.ts', "return out.map((c) => c.trim().replace(/^[*`_]+|[*`_]+$/g, ''));", 'return out.map((c) => c.trim());', 'bold and backtick stripping removed'],
  ['M15', 'src/cli/expectation.ts', 'const ID_HEADER = /^(?:criterion|criteria|id|#)$/i;', 'const ID_HEADER = /^(?:criterion|criteria|id|#)$/;', 'header match case-sensitive'],
  ['M17', 'src/cli/expectation.ts', 'if (known.has(r.id)) continue;', 'continue;', 'no orphan row is ever reported'],
  ['M18', 'src/cli/expectation.ts', 'if (parsed.tables > 0) {', 'if (false) {', 'no unmarked line is ever reported'],
  ['M19', 'src/cli/expectation.ts', 'if (from !== to) out.push({ id, from, to });', 'if (false) out.push({ id, from, to });', 'a moved mark is never reported'],
  ['M20', 'src/cli/service.ts', "|| x.verdict.status !== 'held') { out.push(x); continue; }", '|| true) { out.push(x); continue; }', 'a held Expected_Break line is never run again'],
  ['M21', 'src/cli/expectation.ts', 'if (fence !== undefined) {', 'if (false as boolean) {', 'fenced code is read as data'],
  ['M22', 'src/cli/service.ts', "if (tableErrors(expectations).length > 0) return { kind: 'table-error'", "if (false as boolean) return { kind: 'table-error'", 'a table error does not stop the gate'],
  ['M23', 'src/cli/gate-counter.ts', "brokenReqIds: unmet.filter((u) => u.status !== 'held').map((u) => u.id)", 'brokenReqIds: unmet.map((u) => u.id)', 'a held line is listed as broken in the override'],
  ['M24', 'src/cli/commands/gate-kiro.ts', 'if (!green && blocks.length > 0 && changes.length > 0) blocks.unshift(markChangesBlock(changes));', '', 'the Stop reason never shows a moved mark'],
  ['M25', 'src/cli/commands/gate-kiro.ts', 'if (!green && blocks.length > 0 && notes.length > 0) blocks.push(tableNotesBlock', 'if (false) blocks.push(tableNotesBlock', 'the Stop reason never carries the table notes'],
  ['M26', 'src/cli/service.ts', "...(extra.expectationChanges !== undefined && extra.expectationChanges.length > 0 ? { expectationChanges: [...extra.expectationChanges] } : {}),", '', 'the report never records the moved marks'],
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
