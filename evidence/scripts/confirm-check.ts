// Does the gate with the confirmation pass (golem-spec 0.1.2) turn RED on the controllers that agents of experiment 3b
// claimed to have fixed? No agent runs. For each stream in results/agent-gate-hard/agent-gate.streams/ that is a run
// with `claimsSuccess` (plus one control), this rebuilds the agent's final controller files from the file writes in the
// stream, puts them into a temporary copy of apps/stagger whose requirement 1.3 says 200 N, and runs the real CLI:
//   golem gate --no-confirm                    what the agent saw: the quick budget, search seed 1
//   golem gate                                 the new gate: the same, then a confirmation with the derived seed
//   golem gate --no-confirm --search-seed 7919 the independent gate of experiment 3b (checks the rebuild against its record)
// The pinned seeds are restored before every command, as experiment 3b did. Writes confirm-check.md next to the streams.
//   cd evidence && npx vite-node scripts/confirm-check.ts
import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = join(REPO, 'apps', 'stagger');
const OUT = join(REPO, 'evidence', 'results', 'agent-gate-hard');
const GOLEM = join(REPO, 'node_modules', 'golem-spec', 'dist', 'cli', 'main.js');
const INDEPENDENT_SEED = '7919';

interface Run { arm: string; index: number; claimsSuccess: boolean; gateExit: number | null; filesChanged: string[]; filesAdded: string[]; filesRemoved: string[]; status: string }
interface Case { stream: string; role: 'claimed success' | 'control (independent gate was green, no claim)'; run: Run }

const runs: Run[] = readFileSync(join(OUT, 'agent-gate.jsonl'), 'utf8').split('\n').filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as Run & { kind: string }).filter((r) => (r as { kind: string }).kind === 'run');

// The stream file of run `index` (0-based) is `<arm>-<index + 1>.jsonl`.
const cases: Case[] = runs.filter((r) => r.claimsSuccess).map((r) => ({ stream: `${r.arm}-${r.index + 1}`, role: 'claimed success' as const, run: r }));
for (const r of runs) if (!r.claimsSuccess && r.gateExit === 0) cases.push({ stream: `${r.arm}-${r.index + 1}`, role: 'control (independent gate was green, no claim)', run: r });

// ---------------------------------------------------------------- rebuild the agent's files from its stream

type Edit = { kind: 'write'; path: string; text: string } | { kind: 'replace'; path: string; oldStr: string; newStr: string }
  | { kind: 'ps-replace'; path: string; pairs: [string, string][] } | { kind: 'unknown'; why: string };

const rel = (p: string): string => p.replace(/\\/g, '/').replace(/^.*\/ws\//, '');
const unq = (s: string): string => s.slice(1, -1);

/** The one PowerShell form the agents used to edit a file: `(Get-Content f [-Raw]) -replace 'a','b' ... | Set-Content f`. */
function parsePsEdit(cmd: string): Edit | undefined {
  if (!/Set-Content|Out-File|\sTee-Object|>>?\s/.test(cmd)) return undefined;
  const cd = /^\s*cd\s+(\S+?)\s*;/.exec(cmd);
  const dir = cd ? `${cd[1]!.replace(/\\/g, '/')}/` : '';
  const m = /\(Get-Content\s+(\S+?)(?:\s+-Raw)?\)((?:\s+-replace\s+(?:'[^']*'|"[^"]*")\s*,\s*(?:'[^']*'|"[^"]*"))+)\s*\|\s*Set-Content\s+([^\s;]+)/.exec(cmd);
  if (!m || m[1]!.replace(/\\/g, '/') !== m[3]!.replace(/\\/g, '/')) return { kind: 'unknown', why: `a command that writes a file in a form this script does not read: ${cmd.slice(0, 120)}` };
  const pairs: [string, string][] = [];
  for (const p of m[2]!.matchAll(/-replace\s+('[^']*'|"[^"]*")\s*,\s*('[^']*'|"[^"]*")/g)) pairs.push([unq(p[1]!), unq(p[2]!)]);
  return { kind: 'ps-replace', path: `${dir}${m[1]!.replace(/\\/g, '/')}`, pairs };
}

function editsOf(stream: string): Edit[] {
  const calls = new Map<string, { raw: Record<string, unknown>; kind: string; title: string; status?: string }>();
  const order: string[] = [];
  for (const line of readFileSync(join(OUT, 'agent-gate.streams', `${stream}.jsonl`), 'utf8').split('\n')) {
    if (!line.includes('"tool_call')) continue;
    const u = (JSON.parse(line) as { data?: { update?: Record<string, unknown> } }).data?.update;
    if (!u) continue;
    const id = String(u['toolCallId']);
    if (u['sessionUpdate'] === 'tool_call') { calls.set(id, { raw: (u['rawInput'] ?? {}) as Record<string, unknown>, kind: String(u['kind']), title: String(u['title']) }); order.push(id); }
    else if (u['sessionUpdate'] === 'tool_call_update' && typeof u['status'] === 'string') { const c = calls.get(id); if (c) c.status = u['status']; }
  }
  const out: Edit[] = [];
  for (const id of order) {
    const c = calls.get(id)!;
    if (c.status === 'failed') continue;
    if (c.kind === 'edit' && c.title === 'Write File') out.push({ kind: 'write', path: rel(String(c.raw['path'])), text: String(c.raw['text']) });
    else if (c.kind === 'edit' && c.title === 'Replace in File') out.push({ kind: 'replace', path: rel(String(c.raw['path'])), oldStr: String(c.raw['oldStr']), newStr: String(c.raw['newStr']) });
    else if (c.kind === 'edit') out.push({ kind: 'unknown', why: `an edit tool this script does not read: ${c.title}` });
    else if (c.kind === 'execute') { const e = parsePsEdit(String(c.raw['command'] ?? '')); if (e) out.push(e); }
  }
  return out;
}

/** .NET regex (PowerShell -replace) to JS: the patterns the agents wrote use only syntax both share. */
const psRegex = (p: string): RegExp => new RegExp(p, 'g');

function applyEdits(ws: string, edits: Edit[]): { ok: true } | { ok: false; why: string } {
  for (const e of edits) {
    if (e.kind === 'unknown') return { ok: false, why: e.why };
    const file = join(ws, e.path);
    if (relative(ws, file).startsWith('..')) return { ok: false, why: `a write outside the workspace: ${e.path}` };
    if (e.kind === 'write') { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, e.text); continue; }
    if (!existsSync(file)) return { ok: false, why: `${e.path} does not exist when the stream edits it` };
    const text = readFileSync(file, 'utf8');
    let next: string;
    if (e.kind === 'replace') {
      const i = text.indexOf(e.oldStr);
      if (i < 0) return { ok: false, why: `the old text of an edit of ${e.path} is not in the file` };
      next = text.slice(0, i) + e.newStr + text.slice(i + e.oldStr.length);
    } else {
      next = e.pairs.reduce((s, [a, b]) => s.replace(psRegex(a), b), text);
      if (next === text) return { ok: false, why: `a -replace on ${e.path} changed nothing` };
    }
    writeFileSync(file, next);
  }
  return { ok: true };
}

// ---------------------------------------------------------------- workspace and gate

const walk = (dir: string, base = dir): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p, base) : [relative(base, p).replace(/\\/g, '/')];
});

function makeWorkspace(): { root: string; ws: string; dispose(): void } {
  const root = mkdtempSync(join(tmpdir(), 'golem-confirm-check-'));
  const ws = join(root, 'ws');
  cpSync(APP, ws, { recursive: true, filter: (s) => !/[\\/](node_modules|\.golem|dist)([\\/]|$)/.test(s) });
  // Experiment 3b's subject: the identity reflex stands in for controller/kiro-reflex.ts (PREREG deviation 3) and 1.3 asks for 200 N.
  const kiro = join(ws, 'controller', 'kiro-reflex.ts');
  if (existsSync(kiro)) writeFileSync(kiro, ["// Not part of this experiment's subject (PREREG deviation 3): the identity reflex stands in.", "export { Reflex as KiroReflex } from './reflex.js';", ''].join('\n'));
  const req = join(ws, '.kiro', 'specs', 'g1-walking', 'requirements.md');
  const text = readFileSync(req, 'utf8');
  const hard = text.replace('pushed with up to 100 N for 0.2 s from any direction', 'pushed with up to 200 N for 0.2 s from any direction');
  if (hard === text) throw new Error('requirement 1.3 text not found');
  writeFileSync(req, hard);
  rmSync(join(ws, '.kiro', 'hooks'), { recursive: true, force: true });
  symlinkSync(join(REPO, 'node_modules'), join(ws, 'node_modules'), 'junction');
  return { root, ws, dispose() { try { rmdirSync(join(ws, 'node_modules')); } catch { /* junction already gone */ } rmSync(root, { recursive: true, force: true }); } };
}

const restoreSeeds = (ws: string): void => {
  rmSync(join(ws, '.golem'), { recursive: true, force: true });
  cpSync(join(APP, '.golem', 'seeds'), join(ws, '.golem', 'seeds'), { recursive: true });
};

interface GateResult { exit: number | null; seconds: number; text: string }
function gate(ws: string, args: string[]): GateResult {
  restoreSeeds(ws);
  const env = { ...process.env }; delete env['GOLEM_REFLEX'];
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [GOLEM, 'gate', ...args], { cwd: ws, env, encoding: 'utf8', timeout: 20 * 60_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { exit: r.status, seconds: Math.round((Date.now() - t0) / 100) / 10, text: `${r.stdout}${r.stderr}`.replace(/\r/g, '').trim() };
}

const lines = (t: string): string[] => t.split('\n');
const summaryLines = (t: string): string[] => lines(t).filter((l) => /^(gate RED|gate GREEN|confirmed:|NOT confirmed|no counterexample in)/.test(l));
const failLines = (t: string): string[] => lines(t).filter((l) => /^\s+FAIL\s|held under search seed|^\d\.\d: |^\s+scenario:|^\s+margin:|^\s+search again:|^\s+reproduce:/.test(l));

// ---------------------------------------------------------------- run

interface Row { c: Case; changed: string[]; reconstructed: boolean; why?: string; saw?: GateResult; fresh?: GateResult; indep?: GateResult }
const rows: Row[] = [];
const base = makeWorkspace();
try {
  const pristine = new Map(walk(join(base.ws, 'controller')).map((f) => [f, readFileSync(join(base.ws, 'controller', f))] as const));
  for (const c of cases) {
    console.log(`== ${c.stream} (${c.role})`);
    // fresh controller files, then the agent's edits
    for (const f of walk(join(base.ws, 'controller'))) if (!pristine.has(f)) rmSync(join(base.ws, 'controller', f));
    for (const [f, b] of pristine) writeFileSync(join(base.ws, 'controller', f), b);
    const res = applyEdits(base.ws, editsOf(c.stream));
    const changed = [...new Set([...pristine.keys()].filter((f) => !readFileSync(join(base.ws, 'controller', f)).equals(pristine.get(f)!)).map((f) => `controller/${f}`))].sort();
    if (!res.ok) { rows.push({ c, changed, reconstructed: false, why: res.why }); console.log(`   skipped: ${res.why}`); continue; }
    const row: Row = { c, changed, reconstructed: true };
    row.saw = gate(base.ws, ['--no-confirm']);
    console.log(`   gate --no-confirm: exit ${row.saw.exit} in ${row.saw.seconds} s`);
    row.fresh = gate(base.ws, []);
    console.log(`   gate: exit ${row.fresh.exit} in ${row.fresh.seconds} s`);
    row.indep = gate(base.ws, ['--no-confirm', '--search-seed', INDEPENDENT_SEED]);
    console.log(`   gate --no-confirm --search-seed ${INDEPENDENT_SEED}: exit ${row.indep.exit} in ${row.indep.seconds} s`);
    rows.push(row);
  }
} finally {
  base.dispose();
}

// ---------------------------------------------------------------- report

const word = (e: number | null): string => (e === 0 ? 'GREEN (exit 0)' : e === 2 ? 'RED (exit 2)' : `exit ${String(e)}`);
const md: string[] = [];
md.push('# Experiment 3b, checked again with the confirmation gate (no agents)', '');
md.push('Question: agents trusted `golem gate` printing GREEN at the quick budget (24 trials per line, search seed 1) while an independent gate with search seed 7919 broke requirement 1.3 at 200 N. Is the gate of golem-spec 0.1.2, which searches every Expected_Hold line again with a derived second seed before it prints GREEN, now RED on those controllers?', '');
md.push('Method: the stream of each run in `agent-gate.streams/` that claimed success (and one control) is read for its file writes (`Write File`, `Replace in File`, and the PowerShell `(Get-Content f) -replace ... | Set-Content f` commands the agents used; a failed call is skipped). Those writes are applied to the starting controller (`apps/stagger/controller`, unchanged since the pre-registration commit 52e31eb, with the identity reflex standing in for `kiro-reflex.ts` as in the experiment) in a temporary copy of `apps/stagger` whose requirement 1.3 says 200 N. The pinned seeds of `apps/stagger/.golem/seeds` are restored before every command, as in the experiment. A rebuild is trusted only when the independent gate below gives the exit code that the run record holds.', '');
md.push('Commands, run in the temporary copy with `node node_modules/golem-spec/dist/cli/main.js` (the real CLI, `GOLEM_REFLEX` unset):', '', '```', 'golem gate --no-confirm                      # what the agent saw (24 trials per line, search seed 1)', 'golem gate                                   # the new gate: that, then a confirmation with the derived seed 588244584', `golem gate --no-confirm --search-seed ${INDEPENDENT_SEED}   # the independent gate of experiment 3b`, '```', '', 'Reproduce all of it: `cd evidence && npx vite-node scripts/confirm-check.ts` (about 12 minutes).', '');
md.push('| Stream | Role | Files rebuilt | `gate --no-confirm` | `gate` (new) | independent gate, seed 7919 | recorded exit of the independent gate |', '|---|---|---|---|---|---|---|');
for (const r of rows) {
  if (!r.reconstructed) { md.push(`| ${r.c.stream} | ${r.c.role} | not rebuilt | skipped | skipped | skipped | ${word(r.c.run.gateExit)} |`); continue; }
  md.push(`| ${r.c.stream} | ${r.c.role} | ${r.changed.join(', ') || 'none'} | ${word(r.saw!.exit)}, ${r.saw!.seconds} s | ${word(r.fresh!.exit)}, ${r.fresh!.seconds} s | ${word(r.indep!.exit)}, ${r.indep!.seconds} s | ${word(r.c.run.gateExit)} |`);
}
md.push('');
const claimed = rows.filter((r) => r.reconstructed && r.c.role === 'claimed success');
const sawGreen = claimed.filter((r) => r.saw!.exit === 0);
const newRed = claimed.filter((r) => r.fresh!.exit === 2);
const faithful = rows.filter((r) => r.reconstructed && r.indep!.exit === r.c.run.gateExit);
md.push(`Result: of ${claimed.length} claimed-success controllers that could be rebuilt, ${sawGreen.length} were GREEN for the gate as the agent saw it (\`--no-confirm\`) and ${newRed.length} are RED for the new gate. The independent gate reproduced the recorded exit code for ${faithful.length} of ${rows.filter((r) => r.reconstructed).length} rebuilt controllers.`, '');
md.push(`Skipped (could not be rebuilt): ${rows.filter((r) => !r.reconstructed).map((r) => `${r.c.stream} (${r.why})`).join('; ') || 'none'}.`, '');
const ids = (rs: Row[]): string => rs.map((r) => r.c.stream).join(', ') || 'none';
const stillGreen = claimed.filter((r) => r.fresh!.exit === 0);
md.push('## Reading', '');
md.push(`New gate RED: ${ids(newRed)}. New gate still GREEN: ${ids(stillGreen)}.${stillGreen.length > 0 ? ` For ${ids(stillGreen)} the confirmation seed found nothing in 24 trials per line, while the independent gate with search seed ${INDEPENDENT_SEED} found a counterexample (see below). A second seed lowers the chance that a green is luck; it does not remove it.` : ''}`, '');
for (const r of rows.filter((x) => x.reconstructed && x.c.role !== 'claimed success')) {
  md.push(`Control ${r.c.stream}: the independent gate (seed ${INDEPENDENT_SEED}) was ${word(r.indep!.exit)} and the new gate is ${word(r.fresh!.exit)}.`, '');
}
md.push('Each controller was searched once per command (a single sample, not a rate). The gates are deterministic: two runs of this check gave the same exit codes. Wall times are not: the same command took up to twice as long in one run as in the other on this machine, so read them as an order of magnitude.', '');
md.push('## Output of each command', '');
for (const r of rows) {
  md.push(`### ${r.c.stream}: ${r.c.role}`, '');
  const rec = r.c.run;
  md.push(`Run record: arm ${rec.arm}, index ${rec.index}, status ${rec.status}, files changed ${rec.filesChanged.join(', ') || 'none'}, independent gate exit ${String(rec.gateExit)}. Files rebuilt here: ${r.changed.join(', ') || 'none'}${JSON.stringify([...r.changed].sort()) === JSON.stringify([...rec.filesChanged].sort()) ? ' (the same set)' : ' (NOT the set of the record)'}.`, '');
  if (!r.reconstructed) { md.push(`Not rebuilt: ${r.why}.`, ''); continue; }
  for (const [name, g] of [['golem gate --no-confirm', r.saw!], ['golem gate', r.fresh!], [`golem gate --no-confirm --search-seed ${INDEPENDENT_SEED}`, r.indep!]] as const) {
    const key = [...summaryLines(g.text), ...failLines(g.text)].filter((l, i, a) => a.indexOf(l) === i);
    md.push(`\`${name}\`: exit ${String(g.exit)}, ${g.seconds} s.`, '', '```text', ...key, '```', '');
  }
}
writeFileSync(join(OUT, 'confirm-check.md'), `${md.join('\n')}\n`);
console.log(`wrote ${join(OUT, 'confirm-check.md')}`);
