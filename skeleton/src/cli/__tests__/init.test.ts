import { describe, expect, it } from 'vitest';
import { InitError, PackError, buildPlan, executePlan, mergeMcpSettings, readManifest } from '../init.js';
import { parseConfig } from '../config.js';
import { createHarness } from '../../../test/support/harness.js';
import { createMemoryFs } from '../../../test/support/memory-fs.js';
import { FIXTURE_FILES, MCP_TEMPLATE, installPack } from '../../../test/support/pack-fixture.js';

const setup = () => {
  const h = createHarness({ seed: false });
  installPack(h.fs);
  return h;
};

describe('golem init', () => {
  it('writes every pack file and the placeholder config, then skips them all on a second run', async () => {
    const h = setup();
    expect(await h.run('init')).toBe(0);
    const first = h.io.stdoutText().trim().split('\n');
    expect(first).toContain('wrote .kiro/hooks/golem-guard-requirements.mjs');
    expect(first).toContain('wrote golem.config.json');
    expect(first.every((l) => l.startsWith('wrote '))).toBe(true);
    for (const [rel, text] of Object.entries(FIXTURE_FILES)) expect(h.fs.text(h.path(`.kiro/${rel}`))).toBe(text);
    expect(() => parseConfig(h.fs.text(h.path('golem.config.json')) as string, 'golem.config.json')).not.toThrow();
    const writes = h.fs.log.filter((l) => l.startsWith('rename')).length;
    h.clearOutput();
    expect(await h.run('init')).toBe(0);
    const second = h.io.stdoutText().trim().split('\n');
    expect(second).toHaveLength(first.length);
    expect(second.every((l) => /^skipped .* \(exists\)$/.test(l))).toBe(true);
    expect(h.fs.log.filter((l) => l.startsWith('rename')).length).toBe(writes);
  });

  it('keeps an existing file byte for byte without --force and replaces it with --force', async () => {
    const h = setup();
    h.fs.put(h.path('.kiro/hooks/golem.json'), 'mine');
    h.fs.put(h.path('golem.config.json'), 'also mine');
    await h.run('init');
    expect(h.fs.text(h.path('.kiro/hooks/golem.json'))).toBe('mine');
    expect(h.fs.text(h.path('golem.config.json'))).toBe('also mine');
    expect(h.io.stdoutText()).toContain('skipped .kiro/hooks/golem.json (exists)');
    await h.run('init', '--force');
    expect(h.fs.text(h.path('.kiro/hooks/golem.json'))).toBe(FIXTURE_FILES['hooks/golem.json']);
    expect(h.fs.text(h.path('golem.config.json'))).not.toBe('also mine');
  });

  it('sets no executable bit: the file system sees only writes and renames', async () => {
    const h = setup();
    await h.run('init');
    expect(h.fs.log.every((l) => /^(write|rename|mkdir) /.test(l))).toBe(true);
  });

  it('takes the target directory from the positional argument', async () => {
    const h = setup();
    expect(await h.run('init', 'other')).toBe(0);
    expect(h.fs.text(h.path('other/.kiro/hooks/golem.json'))).toBeDefined();
  });

  it('exits 1 naming the pack and writes nothing when the pack is unreadable', async () => {
    const h = createHarness({ seed: false });
    expect(await h.run('init')).toBe(1);
    expect(h.io.stderrText()).toContain('/pack');
    expect(h.fs.list()).toEqual([]);
    const h2 = setup();
    h2.fs.files.delete('/pack/steering/golem-ears.md');
    expect(await h2.run('init')).toBe(1);
    expect(h2.io.stderrText()).toContain('/pack');
    expect(h2.fs.list().filter((p) => p.startsWith('/proj'))).toEqual([]);
  });

  it('stops at the first failing write, keeps the old file, removes the temp file and names the path', async () => {
    const h = setup();
    h.fs.put(h.path('.kiro/steering/golem-ears.md'), 'old');
    h.fs.failOn('rename', 'steering/golem-ears.md');
    expect(await h.run('init', '--force')).toBe(1);
    expect(h.io.stderrText()).toContain('steering/golem-ears.md');
    expect(h.fs.text(h.path('.kiro/steering/golem-ears.md'))).toBe('old');
    expect(h.fs.list().some((p) => p.includes('.tmp-'))).toBe(false);
    expect(h.fs.text(h.path('.kiro/agents/golem-tuner.json'))).toBeUndefined();
  });

  it('exits 1 with no file written when a symlink leads outside the target', async () => {
    const h = setup();
    h.fs.put('/elsewhere/x', '');
    h.fs.symlink(h.path('.kiro/hooks'), '/elsewhere');
    expect(await h.run('init')).toBe(1);
    expect(h.io.stderrText()).toContain('outside');
    expect(h.fs.list().filter((p) => p.startsWith('/proj'))).toEqual([]);
    expect(h.fs.text('/elsewhere/golem.json')).toBeUndefined();
  });

  it('exits 1 naming the file when .kiro/settings/mcp.json is not valid JSON, writing nothing', async () => {
    const h = setup();
    h.fs.put(h.path('.kiro/settings/mcp.json'), '{ nope');
    expect(await h.run('init')).toBe(1);
    expect(h.io.stderrText()).toContain('mcp.json');
    expect(h.fs.text(h.path('.kiro/hooks/golem.json'))).toBeUndefined();
  });

  it('merges the golem entry into an existing mcp.json and keeps the others', async () => {
    const h = setup();
    h.fs.put(h.path('.kiro/settings/mcp.json'), '{"mcpServers":{"other":{"command":"x"}},"note":1}');
    await h.run('init');
    expect(h.io.stdoutText()).toContain('merged .kiro/settings/mcp.json: golem entry added');
    const j = JSON.parse(h.fs.text(h.path('.kiro/settings/mcp.json')) as string);
    expect(j.mcpServers.other).toEqual({ command: 'x' });
    expect(j.mcpServers.golem).toEqual({ command: 'npx', args: ['--no-install', 'golem-spec', 'mcp'] });
    expect(j.note).toBe(1);
  });
});

describe('init engine', () => {
  it('reads the manifest or throws a PackError that names the pack path', async () => {
    const fs = createMemoryFs();
    await expect(readManifest(fs, '/nope')).rejects.toBeInstanceOf(PackError);
    await expect(readManifest(fs, '/nope')).rejects.toThrow('/nope');
  });

  it('plans write, skip and merge actions', async () => {
    const fs = createMemoryFs();
    const m = installPack(fs);
    fs.put('/t/.kiro/hooks/golem.json', 'x');
    fs.put('/t/.kiro/settings/mcp.json', '{}');
    const plan = await buildPlan(fs, '/t', m, { force: false });
    const by = Object.fromEntries(plan.entries.map((e) => [e.rel, e.action]));
    expect(by['hooks/golem.json']).toBe('skip');
    expect(by['settings/mcp.json']).toBe('merge');
    expect(by['steering/golem-ears.md']).toBe('write');
    expect(by['golem.config.json']).toBe('write');
    expect((await buildPlan(fs, '/t', m, { force: true })).entries.find((e) => e.rel === 'hooks/golem.json')?.action).toBe('write');
  });

  it('refuses a pack path with .. that leaves the target', async () => {
    const fs = createMemoryFs();
    await expect(buildPlan(fs, '/t', { files: [{ rel: '../../etc/x', sha256: '', kind: 'copy' }] }, { force: false })).rejects.toBeInstanceOf(InitError);
  });

  it('says created, added, kept and replaced for the mcp merge', () => {
    expect(mergeMcpSettings(undefined, MCP_TEMPLATE, false).outcome).toBe('created');
    const added = mergeMcpSettings('{"mcpServers":{}}', MCP_TEMPLATE, false);
    expect(added.outcome).toBe('added');
    expect(mergeMcpSettings(added.text, MCP_TEMPLATE, false)).toEqual({ text: added.text, outcome: 'kept' });
    const edited = '{"mcpServers":{"golem":{"command":"mine"}}}';
    expect(mergeMcpSettings(edited, MCP_TEMPLATE, false)).toEqual({ text: edited, outcome: 'kept' });
    expect(JSON.parse(mergeMcpSettings(edited, MCP_TEMPLATE, true).text).mcpServers.golem.command).toBe('npx');
  });

  it('prints through the say callback in manifest order', async () => {
    const fs = createMemoryFs();
    const m = installPack(fs);
    const plan = await buildPlan(fs, '/t', m, { force: false });
    const said: string[] = [];
    await executePlan(fs, plan, '/pack', { force: false }, (s) => said.push(s));
    expect(said[0]).toBe('wrote .kiro/hooks/golem.json');
    expect(said[said.length - 1]).toBe('wrote golem.config.json');
  });
});
