// First-minute check of the published package, run by the "starter" job of .github/workflows/golem.yml.
//
//   node .github/scripts/starter-smoke.mjs <dir with golem-spec-*.tgz | path to the .tgz>
//
// Installs the tarball into a fresh temp project and runs what the npm README tells a new user to run:
//   init, check (exit 0), test --budget 24 (exit 2: line 1.2 breaks), gate (exit 2, naming only 1.2).
// The red gate is the expected first-minute behaviour: the starter has no Expectation table and its motor gives 15 N.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const arg = process.argv[2];
if (!arg) { console.error('usage: node starter-smoke.mjs <dir with golem-spec-*.tgz | .tgz file>'); process.exit(1); }
const source = resolve(arg);
const tarball = statSync(source).isDirectory()
  ? join(source, readdirSync(source).filter((f) => /^golem-spec-.*\.tgz$/.test(f)).sort().pop() ?? '')
  : source;
if (!existsSync(tarball) || !tarball.endsWith('.tgz')) { console.error(`no golem-spec-*.tgz in ${source}`); process.exit(1); }

const proj = mkdtempSync(join(tmpdir(), 'golem-starter-'));
const win = process.platform === 'win32';
let failed = false;

/** Runs a command in the temp project, echoes it and its output, and returns { code, out }. */
function run(label, cmd, args, env) {
  console.log(`\n$ ${env ? Object.entries(env).map(([k, v]) => `${k}=${v} `).join('') : ''}${[cmd, ...args].join(' ')}`);
  const r = spawnSync(win && cmd === 'npx' ? 'npx.cmd' : cmd, args, { cwd: proj, encoding: 'utf8', shell: win, maxBuffer: 64 << 20, env: { ...process.env, ...(env ?? {}) } });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
  console.log(`[${label}] exit ${r.status}`);
  return { code: r.status, out };
}

function expect(ok, what) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) failed = true;
}

try {
  console.log(`project: ${proj}\ntarball: ${tarball}`);
  writeFileSync(join(proj, 'package.json'), `${JSON.stringify({ name: 'golem-starter-smoke', private: true, version: '0.0.0' })}\n`);
  expect(run('install', 'npm', ['install', '-D', tarball, '--no-audit', '--no-fund']).code === 0, 'npm install -D <tarball> exits 0');

  const init = run('init', 'npx', ['--no-install', 'golem-spec', 'init']);
  expect(init.code === 0, 'init exits 0');
  for (const f of ['app.js', 'golem.config.json', 'robot/scene.xml', '.kiro/specs/cartpole/requirements.md', '.kiro/hooks/golem.json', 'controller.py', 'golem_bridge.py']) {
    expect(existsSync(join(proj, f)), `init wrote ${f}`);
  }

  const check = run('check', 'npx', ['--no-install', 'golem-spec', 'check']);
  expect(check.code === 0 && /3 requirements compiled, 0 warnings/.test(check.out), 'check compiles the 3 starter lines with 0 warnings and exits 0');

  const test = run('test', 'npx', ['--no-install', 'golem-spec', 'test', '--budget', '24']);
  expect(test.code === 2, 'test exits 2 (a requirement is broken)');
  expect(/^1\.1\s+HELD/m.test(test.out), 'test: 1.1 held');
  expect(/^1\.2\s+BROKEN/m.test(test.out), 'test: 1.2 broken');
  expect(/^2\.1\s+HELD/m.test(test.out), 'test: 2.1 held');

  // The same law in controller.py, through the Python bridge, gives the same verdicts, margins and counterexamples.
  // Both runs start from the same state: the first one pinned its counterexample in .golem/, so clear it.
  const same = (o) => o.replace(/in [0-9.]+ s\b/g, 'in T s').trim();
  rmSync(join(proj, '.golem'), { recursive: true, force: true });
  const testPy = run('test (python)', 'npx', ['--no-install', 'golem-spec', 'test', '--budget', '24'], { GOLEM_CONTROLLER: 'python', GOLEM_PYTHON: win ? 'python' : 'python3' });
  expect(testPy.code === 2 && same(testPy.out) === same(test.out), 'test with GOLEM_CONTROLLER=python prints the same verdicts as the JavaScript controller');

  const gate = run('gate', 'npx', ['--no-install', 'golem-spec', 'gate', '--json']);
  expect(gate.code === 2, 'gate exits 2 on line 1.2 (red on purpose)');
  let parsed;
  try { parsed = JSON.parse(gate.out.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop() ?? ''); } catch { parsed = undefined; }
  const unmet = (parsed?.expectations ?? []).filter((e) => !e.met).map((e) => e.reqId);
  expect(parsed !== undefined && unmet.length === 1 && unmet[0] === '1.2', `gate names only 1.2 as not met (got ${JSON.stringify(unmet)})`);
} finally {
  if (!process.env.GOLEM_KEEP_SMOKE_DIR) rmSync(proj, { recursive: true, force: true });
}

console.log(failed ? '\nstarter smoke test: FAILED' : '\nstarter smoke test: passed');
process.exit(failed ? 1 : 0);
