import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../src/mcp/tool-schemas.js';
import { checkPluginManifest, scanUrls } from '../scripts/pack-checks/power.js';
import { checkSync, readTree } from '../scripts/sync-power.js';
import { PACK_DIR, SKELETON_DIR } from './support/pack.js';

const POWER = join(SKELETON_DIR, 'power');
const ROOT = join(SKELETON_DIR, '..');
const files = (): { path: string; text: string; abs: string }[] => [...readTree(POWER).keys()].map((p) => ({ path: p, abs: join(POWER, p), text: readFileSync(join(POWER, p), 'utf8') }));

describe('Power', () => {
  const plugin = JSON.parse(readFileSync(join(POWER, 'plugin.json'), 'utf8')) as Record<string, unknown>;

  it('has a plugin.json that passes the closed Agent Plugins 1.0 check', () => {
    expect(checkPluginManifest(plugin)).toEqual([]);
    expect(plugin).toMatchObject({ name: 'golem', version: '0.1.0', license: 'Apache-2.0' });
  });

  it('has skills/ and mcp.json, the steering file and both skills byte-identical to the pack', () => {
    const t = readTree(POWER);
    expect([...t.keys()]).toEqual(expect.arrayContaining(['mcp.json', 'skills/robot-ears/SKILL.md', 'skills/falsify-and-fix/SKILL.md', 'steering/golem-ears.md', 'POWER.md', 'plugin.json', 'LICENSE']));
    expect(checkSync({ pack: PACK_DIR, power: POWER, crew: join(SKELETON_DIR, 'crew-app'), rootLicense: join(ROOT, 'LICENSE') })).toEqual([]);
  });

  it('runs the golem server through npx as a stdio server', () => {
    const j = JSON.parse(readFileSync(join(POWER, 'mcp.json'), 'utf8')) as { mcpServers: Record<string, unknown> };
    expect(j.mcpServers).toEqual({ golem: { type: 'stdio', command: 'npx', args: ['--no-install', 'golem-spec', 'mcp'] } });
  });

  it('has POWER.md with front matter and an overview that names every MCP tool', () => {
    const t = readFileSync(join(POWER, 'POWER.md'), 'utf8');
    const front = /^---\n([\s\S]*?)\n---\n/.exec(t)?.[1] ?? '';
    for (const k of ['name', 'displayName', 'description', 'keywords']) expect(front).toMatch(new RegExp(`^${k}: \\S`, 'm'));
    for (const tool of TOOL_NAMES) expect(t, tool).toContain(`\`${tool}\``);
  });

  it('holds no script, no executable bit, no URL beyond the two $schema values and no IP address', () => {
    for (const f of files()) {
      expect(f.path, f.path).not.toMatch(/\.(sh|bash|ps1|cmd|bat|js|mjs|cjs|ts|py)$/);
      expect(statSync(f.abs).mode & 0o111, f.path).toBe(0);
    }
    expect(scanUrls(files())).toEqual([]);
  });

  it('carries a licence identical to the repository licence', () => {
    expect(readFileSync(join(POWER, 'LICENSE'))).toEqual(readFileSync(join(ROOT, 'LICENSE')));
  });
});

// `kiro-cli powers install` changes the user's Kiro configuration, so it runs only when asked for: GOLEM_POWER_INSTALL=1.
const probe = spawnSync('kiro-cli', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
const canInstall = probe.status === 0 && process.env['GOLEM_POWER_INSTALL'] === '1';
describe.skipIf(!canInstall)('kiro-cli powers install', () => {
  it('installs the Power with exit 0 and no error message', () => {
    const r = spawnSync('kiro-cli', ['powers', 'install', POWER], { encoding: 'utf8', shell: process.platform === 'win32' });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/error/i);
  }, 60000);
});
