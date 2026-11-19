// One structural test per decision of the kiro-pack README, so that a drifted shape fails loudly.
import { describe, expect, it } from 'vitest';
import { buildPack } from '../scripts/build-pack.js';
import { ALLOWED_WRITE, effectiveWriteAllow, rulesOf } from '../scripts/pack-checks/agents.js';
import { checkPluginManifest, scanUrls } from '../scripts/pack-checks/power.js';
import { matcherAccepts } from '../scripts/pack-checks/hooks.js';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RED_REQUIREMENTS, createHarness, stopPayload } from './support/harness.js';
import { createDiskKiro } from './support/disk-kiro.js';
import { PACK_DIR, SKELETON_DIR, agentFile, hookFile, packFile, packJson } from './support/pack.js';

describe('kiro formats', () => {
  it('X1: every hook action is an object with type command and a non-empty command', () => {
    for (const h of hookFile().hooks) expect(h['action']).toEqual({ type: 'command', command: expect.stringMatching(/\S/) });
  });

  it('X2: matchers are regular expressions with the documented sample behaviour', () => {
    const [req, ctl] = hookFile().hooks.map((h) => h['matcher'] as string);
    expect(req).toBe('(^|[\\\\/])requirements\\.md$');
    expect(matcherAccepts(req as string, 'a\\b\\requirements.md')).toBe(true);
    expect(matcherAccepts(ctl as string, 'apps/stagger/controller/gait.ts')).toBe(true);
    expect(matcherAccepts(ctl as string, 'controller.ts')).toBe(false);
  });

  it('X3: plugin.json has $schema and stays inside the closed schema', () => {
    const p = JSON.parse(readFileSync(join(SKELETON_DIR, 'power', 'plugin.json'), 'utf8'));
    expect(p['$schema']).toMatch(/^https:\/\/agent-plugins\.org\/schemas\/1\.0\.0\//);
    expect(checkPluginManifest(p)).toEqual([]);
    expect(Object.keys(p)).not.toContain('skills');
  });

  it('X4: the only URLs of the Power are the two $schema values', () => {
    const power = join(SKELETON_DIR, 'power');
    const text = (f: string): string => readFileSync(join(power, f), 'utf8');
    expect(scanUrls([{ path: 'plugin.json', text: text('plugin.json') }, { path: 'mcp.json', text: text('mcp.json') }])).toEqual([]);
    expect(JSON.parse(text('mcp.json'))['$schema']).toMatch(/^https:/);
  });

  it('X5: the tuner pre-approves exactly its set and carries the finalized Deny_Rule', () => {
    const rules = rulesOf(agentFile('tuner'));
    expect(effectiveWriteAllow(rules)).toEqual([...ALLOWED_WRITE.tuner]);
    expect(rules.at(-1)).toEqual({ capability: 'fs_write', match: ['**'], exclude: [...ALLOWED_WRITE.tuner], effect: 'deny' });
    expect(agentFile('tuner')['kiroUpgrade']).toBeDefined();
  });

  it('X6: gate --kiro blocks with JSON and exit 0, and gate without --kiro exits 2', async () => {
    const h = createHarness({ requirements: RED_REQUIREMENTS });
    h.io.setStdin(stopPayload('s'));
    expect(await h.run('gate', '--kiro', '--budget', '12')).toBe(0);
    expect(JSON.parse(h.io.stdoutText())).toEqual({ decision: 'block', reason: expect.stringContaining('npx golem-spec replay 1.2') });
    h.clearOutput();
    expect(await h.run('gate', '--budget', '12')).toBe(2);
  });

  it('X7: the build runs exactly `kiro-cli agent upgrade <dir> --no-backup` and `kiro-cli agent validate --path <file>`', async () => {
    const root = mkdtempSync(join(tmpdir(), 'golem-x7-'));
    try {
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src', 'golem-tuner.json'), readFileSync(join(PACK_DIR, 'agent-src', 'golem-tuner.json')));
      const k = createDiskKiro();
      await buildPack({ run: k.run }, join(root, 'src'), join(root, 'out'));
      expect(k.calls[0]?.slice(0, 3)).toEqual(['kiro-cli', 'agent', 'upgrade']);
      expect(k.calls[0]?.[4]).toBe('--no-backup');
      expect(k.calls[1]?.slice(0, 3)).toEqual(['kiro-cli', 'agent', 'validate']);
      expect(k.calls[1]?.[3]).toBe('--path');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('the Manual trigger, the workflow fields and the Crew schedule keep their documented shape', () => {
    expect(hookFile().hooks.find((h) => h['name'] === 'Summon the ghosts')).toMatchObject({ trigger: 'Manual' });
    expect(packJson('workflows/falsify-and-fix.workflow.json').nodes[0]).toMatchObject({ type: 'repeat', maxIterations: 6, onMaxIterations: 'pause', stopCondition: { fileCheck: { jsonPath: 'meta.lastGateExitCode', value: 0 } } });
    const app = JSON.parse(readFileSync(join(SKELETON_DIR, 'crew-app', 'app.json'), 'utf8'));
    expect(app.schedule).toMatchObject({ cron: expect.stringMatching(/^\d+ \d+ \* \* \*$/), timezone: expect.any(String) });
  });

  it('the README records the open follow-ups OQ6 and OQ7 and the once-per-turn Stop behaviour', () => {
    const r = packFile('README.md');
    expect(r).toContain('**OQ6.**');
    expect(r).toContain('**OQ7.**');
    expect(r).toContain('once per user turn');
    expect(r).toContain('session_id`, `hook_event_name` and `cwd`');
  });
});
