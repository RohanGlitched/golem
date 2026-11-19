// Counts the Kiro artefacts in this repository, so the "How Kiro built GOLEM" page states only
// checkable numbers. Usage: node scripts/kiro-stats.mjs  -> writes site/data/kiro.json and prints a table.
// Counting rules (unique artefacts, specs that were not started) live in kiro-stats-lib.mjs.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeTotals, tasksStatus } from './kiro-stats-lib.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const rel = (p) => relative(root, p).replace(/\\/g, '/');
const read = (p) => readFileSync(p, 'utf8');
const ls = (p) => (existsSync(p) ? readdirSync(p) : []);
const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);
const walk = (dir, out = []) => {
  for (const f of ls(dir)) {
    if (f === 'node_modules' || f === 'dist' || f.startsWith('.git')) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};

// All .kiro folders: the root one (how GOLEM was built) and each app's (GOLEM installed into a project).
const kiroDirs = [join(root, '.kiro'), ...ls(join(root, 'apps')).map((a) => join(root, 'apps', a, '.kiro'))].filter(existsSync);

const EARS = /^\s*\d+\.\s+(WHEN|WHILE|IF|WHERE|THE)\b.*\bSHALL\b/;
function specStats(dir) {
  const specs = [];
  for (const name of ls(join(dir, 'specs'))) {
    const d = join(dir, 'specs', name);
    if (!statSync(d).isDirectory()) continue;
    const req = existsSync(join(d, 'requirements.md')) ? read(join(d, 'requirements.md')) : existsSync(join(d, 'bugfix.md')) ? read(join(d, 'bugfix.md')) : '';
    const design = existsSync(join(d, 'design.md')) ? read(join(d, 'design.md')) : '';
    const tasks = existsSync(join(d, 'tasks.md')) ? read(join(d, 'tasks.md')) : '';
    specs.push({
      name, path: rel(d),
      type: existsSync(join(d, 'bugfix.md')) ? 'bugfix' : 'feature',
      requirements: (req.match(/^###\s+Requirement\b/gm) || []).length,
      earsCriteria: req.split('\n').filter((l) => EARS.test(l)).length,
      properties: (design.match(/^###\s+Property\s+\d+/gm) || []).length,
      tasksDone: (tasks.match(/^\s*- \[x\]/gm) || []).length,
      tasksOpen: (tasks.match(/^\s*- \[ \]/gm) || []).length,
      waves: /"waves"\s*:/.test(tasks),
      // 'not started' specs are listed but left out of the totals.
      status: tasksStatus(tasks),
    });
  }
  return specs;
}

const jsonFiles = (d) => ls(d).filter((f) => f.endsWith('.json')).map((f) => join(d, f));
const out = { generated: new Date().toISOString(), commit: execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(), workspaces: [] };
for (const dir of kiroDirs) {
  const hooks = [];
  for (const f of jsonFiles(join(dir, 'hooks'))) {
    try { for (const h of JSON.parse(read(f)).hooks ?? []) hooks.push({ file: rel(f), name: h.name, trigger: h.trigger, action: h.action?.type, command: h.action?.command }); } catch { /* skip */ }
  }
  const agents = jsonFiles(join(dir, 'agents')).map((f) => { const a = JSON.parse(read(f)); return { name: a.name, file: rel(f), hooks: Object.keys(a.hooks ?? {}).length || (Array.isArray(a.hooks) ? a.hooks.length : 0), mcp: Object.keys(a.mcpServers ?? {}) }; });
  let mcp = [];
  try { mcp = Object.keys(JSON.parse(read(join(dir, 'settings', 'mcp.json'))).mcpServers ?? {}); } catch { /* none */ }
  const steering = ls(join(dir, 'steering')).filter((f) => f.endsWith('.md'));
  const skills = ls(join(dir, 'skills'));
  // The identity of each artefact for the totals: a copy of the pack installed in an app has the name and content of its twin.
  const keys = {
    agents: jsonFiles(join(dir, 'agents')).map((f) => `${JSON.parse(read(f)).name}:${sha(read(f))}`),
    hooks: hooks.map((h) => `${h.name}|${h.trigger}|${h.command ?? ''}`),
    skills: skills.map((s) => { const p = join(dir, 'skills', s, 'SKILL.md'); return `${s}:${existsSync(p) ? sha(read(p)) : 'none'}`; }),
    steering: steering.map((f) => `${f}:${sha(read(join(dir, 'steering', f)))}`),
  };
  out.workspaces.push({
    path: rel(dir) || '.kiro',
    specs: specStats(dir),
    steering, hooks, agents, mcp, skills, keys,
    workflows: ls(join(dir, 'workflows')),
  });
}

const log = execSync('git log --pretty=%s', { cwd: root }).toString().trim().split('\n');
const byPrefix = {};
for (const s of log) { const m = s.match(/^([a-z0-9-]+):/); const k = m ? m[1] : s.startsWith('Merge') ? 'merge' : 'other'; byPrefix[k] = (byPrefix[k] ?? 0) + 1; }
out.commits = { total: log.length, byPrefix };

const tests = walk(join(root, 'skeleton', 'src')).concat(walk(join(root, 'apps')), walk(join(root, 'evidence')))
  .filter((p) => /\.(test|spec)\.(ts|tsx|mts)$/.test(p));
const src = tests.map(read).join('\n');
out.tests = { files: tests.length, propertyAsserts: (src.match(/fc\.assert\(/g) || []).length };

out.totals = computeTotals(out.workspaces);
mkdirSync(join(root, 'site', 'data'), { recursive: true });
writeFileSync(join(root, 'site', 'data', 'kiro.json'), JSON.stringify(out, null, 2) + '\n');
console.table(out.totals);
for (const w of out.workspaces) for (const s of w.specs) console.log(`${w.path.padEnd(18)} ${s.type.padEnd(7)} ${s.name.padEnd(24)} req ${String(s.requirements).padStart(3)}  EARS ${String(s.earsCriteria).padStart(3)}  props ${String(s.properties).padStart(3)}  tasks ${s.tasksDone}/${s.tasksDone + s.tasksOpen}  ${s.status}${s.status === 'not started' ? ' (left out of the totals)' : ''}`);
console.log('commits', out.commits.total, 'test files', out.tests.files, 'fc.assert', out.tests.propertyAsserts);
