// The real target: apps/stagger (a Unitree G1 RobotApp in TypeScript, MuJoCo in worker threads), run through the built CLI.
// It needs `npm run build` in skeleton/ (it runs dist/cli/main.js) and skips with a message when dist is missing.
// `golem test --budget 24` takes about half a minute and writes apps/stagger/.golem, so it runs only with GOLEM_E2E=1.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SKELETON_DIR } from './support/pack.js';

const MAIN = join(SKELETON_DIR, 'dist', 'cli', 'main.js');
const STAGGER = join(SKELETON_DIR, '..', 'apps', 'stagger');
const built = existsSync(MAIN) && existsSync(join(STAGGER, 'golem.config.json'));
if (!built) console.warn('[skip] stagger end-to-end: run `npm run build` in skeleton/ first');

const golem = (args: string[], input?: string) => spawnSync(process.execPath, [MAIN, ...args], { cwd: STAGGER, encoding: 'utf8', input, timeout: 600000 });

describe.skipIf(!built)('apps/stagger through the built CLI', () => {
  it('golem check compiles the 11 requirements of the G1 and loads no MuJoCo', () => {
    const r = golem(['check']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('11 requirements compiled, 0 warnings\n');
  });

  it('golem check --json gives one JSON object', () => {
    const r = golem(['check', '--json']);
    const j = JSON.parse(r.stdout) as { ok: boolean; requirements: { id: string }[] };
    expect(j.ok).toBe(true);
    expect(j.requirements).toHaveLength(11);
  });

  it('golem --help prints the usage and exits 0', () => {
    const r = golem(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('golem test');
  });

  it.skipIf(process.env['GOLEM_E2E'] !== '1')('golem test --budget 24 falsifies all 11 requirements with real MuJoCo', () => {
    rmSync(join(STAGGER, '.golem'), { recursive: true, force: true });
    try {
      const r = golem(['test', '--budget', '24']);
      expect([0, 2]).toContain(r.status);
      const lines = r.stdout.trim().split('\n');
      expect(lines).toHaveLength(12);
      expect(lines[0]).toMatch(/^1\.1  (HELD|BROKEN)  /);
      expect(lines[11]).toMatch(/^11 requirements: \d+ broken, \d+ held, 0 error, in [\d.]+ s \(search budget 24 trials per requirement;/);
      expect(r.stdout).toMatch(/BROKEN  margin -[\d.]+ [a-z/]+  \d+ trials  \S+ = [\d.]+ \w+/);
    } finally {
      rmSync(join(STAGGER, '.golem'), { recursive: true, force: true });
    }
  }, 600000);

  it('golem mcp answers initialize and exits 0 when stdin closes', () => {
    const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    const r = golem(['mcp'], `${init}\n`);
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')[0]).toContain('"serverInfo":{"name":"golem"');
  }, 60000);
});
