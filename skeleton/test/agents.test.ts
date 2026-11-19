import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPack, buildManifest, type RunResult } from '../scripts/build-pack.js';
import { ALLOWED_WRITE, checkAgent, effectiveWriteAllow, finalizeAgent, findAbsolutePaths, isWriteAllowed, rulesOf, V2_FIELDS } from '../scripts/pack-checks/agents.js';
import { createDiskKiro } from './support/disk-kiro.js';
import { PACK_DIR, agentFile, agentSource } from './support/pack.js';

const roles = ['tuner', 'skeptic', 'scribe'] as const;

describe('source templates', () => {
  it.each(roles)('%s is written in V2 fields only and passes the structural check', (role) => {
    const s = agentSource(role);
    expect(Object.keys(s).every((k) => V2_FIELDS.includes(k))).toBe(true);
    expect(checkAgent(role, s, 'source')).toEqual([]);
    expect(readFileSync(join(PACK_DIR, `agent-src/golem-${role}.json`))[0]).not.toBe(0xef);
  });

  it('gives the tuner the loop in order, the rules and the held-is-not-a-proof statement', () => {
    const p = agentSource('tuner')['prompt'] as string;
    const order = ['Falsify', 'Read the counterexample', 'Explain the margin', 'Fix the controller', 'Re-run', 'Repeat until `npx --no-install golem-spec gate` exits with code 0'].map((s) => p.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(p).toContain('Requirements are never edited');
    expect(p).toContain('propose_requirement');
    expect(p).toMatch(/held` verdict means no counterexample was found within the stated budget/);
    expect(p).toContain('not a proof');
    expect(p).toContain('once per turn');
  });

  it('gives the skeptic its three conditions, the motivating counterexample and propose-only rules', () => {
    const p = agentSource('skeptic')['prompt'] as string;
    expect(p).toContain('`check_requirement` reports no error');
    expect(p).toContain('carries a unit');
    expect(p).toContain('lower and upper bound');
    expect(p).toContain('one-sentence reason');
    expect(p).toMatch(/requirement id, the scenario values with units, the seed, and the robustness with its unit/);
    expect(p).toContain('`propose_requirement` tool only');
    expect(p).toContain('never edit a requirements file');
  });

  it('gives the scribe the revision limit, the unit rule, the entry format and the no-edit rule', () => {
    const p = agentSource('scribe')['prompt'] as string;
    expect(p).toContain('5 revisions');
    expect(p).toContain('last Diagnostic message');
    expect(p).toContain('Put a unit on every number except counts and declared ratios');
    expect(p).toContain('ask the user for it');
    expect(p).toContain('  EARS: <the compiled line>');
    expect(p).toContain('You never edit a requirements file');
    expect(p).toContain('A human or Kiro spec mode merges accepted proposals');
  });
});

describe('committed (upgraded and finalized) agents', () => {
  it.each(roles)('%s passes the structural check on the effective permissions', (role) => {
    expect(checkAgent(role, agentFile(role), 'upgraded')).toEqual([]);
  });

  it('pre-approves exactly the allowed write set and denies the rest, per agent', () => {
    for (const role of roles) {
      const rules = rulesOf(agentFile(role));
      expect(effectiveWriteAllow(rules)).toEqual([...ALLOWED_WRITE[role]]);
      expect(isWriteAllowed(rules, 'requirements.md')).toBe(false);
      expect(isWriteAllowed(rules, '.kiro/specs/robot/requirements.md')).toBe(false);
    }
    expect(isWriteAllowed(rulesOf(agentFile('tuner')), 'controller/gait/walk.ts')).toBe(true);
    expect(isWriteAllowed(rulesOf(agentFile('tuner')), 'tuning/gains.json')).toBe(true);
    expect(isWriteAllowed(rulesOf(agentFile('scribe')), '.kiro/specs/g1/proposals.md')).toBe(true);
    expect(isWriteAllowed(rulesOf(agentFile('skeptic')), 'controller/x.ts')).toBe(false);
  });

  it('has the guard hook in the tuner only', () => {
    expect(JSON.stringify(agentFile('tuner'))).toContain('node .kiro/hooks/golem-guard-requirements.mjs');
    expect(JSON.stringify(agentFile('skeptic'))).not.toContain('golem-guard');
    expect(JSON.stringify(agentFile('scribe'))).not.toContain('golem-guard');
  });

  it('contains no absolute path and no home directory', () => {
    for (const role of roles) expect(findAbsolutePaths(agentFile(role))).toEqual([]);
  });

  it('keeps the skeptic with no write tool and a Deny_Rule without exclude', () => {
    const s = agentFile('skeptic');
    expect(s['tools']).not.toContain('write');
    expect(rulesOf(s).find((r) => r.effect === 'deny' && r.capability === 'fs_write')).toEqual({ capability: 'fs_write', match: ['**'], effect: 'deny' });
  });
});

describe('structural checks report each violation', () => {
  const clone = (role: (typeof roles)[number]) => JSON.parse(JSON.stringify(agentFile(role))) as Record<string, any>;

  it('a missing Deny_Rule', () => {
    const f = clone('tuner');
    f['permissions'].rules = f['permissions'].rules.filter((r: { effect: string }) => r.effect !== 'deny');
    expect(checkAgent('tuner', f, 'upgraded').join()).toContain('Deny_Rule');
  });

  it('an extra pre-approved write path', () => {
    const f = clone('tuner');
    f['permissions'].rules.find((r: { capability: string; effect: string }) => r.capability === 'fs_write' && r.effect === 'allow').match.push('src/**');
    expect(checkAgent('tuner', f, 'upgraded').join()).toContain('pre-approved write paths');
  });

  it('a guard hook on the wrong agent', () => {
    const f = clone('scribe');
    f['hooks'] = [{ name: 'g', trigger: 'preToolUse', matcher: 'write', action: { type: 'command', command: 'node .kiro/hooks/golem-guard-requirements.mjs' }, timeout: 5 }];
    expect(checkAgent('scribe', f, 'upgraded').join()).toContain('only golem-tuner');
  });

  it('an absolute path and a home directory', () => {
    const f = clone('skeptic');
    f['prompt'] = 'x';
    f['resources'] = ['C:\\Users\\me\\x', '/etc/passwd', '~/notes', 'a/home/b'];
    const v = checkAgent('skeptic', f, 'upgraded').filter((x) => x.includes('absolute path'));
    expect(v).toHaveLength(4);
  });
});

describe('finalizeAgent', () => {
  it('appends one Deny_Rule for a non-empty allowed set and nothing for an empty one', () => {
    const base = { permissions: { rules: [{ capability: 'fs_read', effect: 'allow' }] }, name: 'x' };
    const out = finalizeAgent(base, ['controller/**']);
    expect(out['permissions']).toEqual({ rules: [{ capability: 'fs_read', effect: 'allow' }, { capability: 'fs_write', match: ['**'], exclude: ['controller/**'], effect: 'deny' }] });
    expect(finalizeAgent(base, [])).toEqual(base);
    expect(finalizeAgent(out, ['controller/**'])).toEqual(out);
  });
});

describe('build pipeline with a fake kiro-cli', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), 'golem-pack-test-'));
    dirs.push(root);
    const src = join(root, 'agent-src');
    const out = join(root, 'agents');
    mkdirSync(src);
    for (const r of roles) writeFileSync(join(src, `golem-${r}.json`), readFileSync(join(PACK_DIR, `agent-src/golem-${r}.json`)));
    return { root, src, out };
  };
  const read = (dir: string) => Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]));

  it('runs upgrade, finalize and validate in that order and writes finalized files', async () => {
    const { src, out } = setup();
    const k = createDiskKiro();
    const r = await buildPack({ run: k.run }, src, out);
    expect(r.ok).toBe(true);
    expect(k.calls.map((c) => c[2])).toEqual(['upgrade', 'validate', 'validate', 'validate']);
    expect(k.calls[0]).toEqual(['kiro-cli', 'agent', 'upgrade', expect.any(String), '--no-backup']);
    expect(k.calls[1]?.slice(0, 3)).toEqual(['kiro-cli', 'agent', 'validate']);
    expect(k.calls[1]?.[3]).toBe('--path');
    for (const role of roles) {
      const f = JSON.parse(readFileSync(join(out, `golem-${role}.json`), 'utf8'));
      expect(checkAgent(role, f, 'upgraded')).toEqual([]);
    }
  });

  it('is byte-identical on a second run and a second upgrade skips a finalized file', async () => {
    const { src, out } = setup();
    await buildPack({ run: createDiskKiro().run }, src, out);
    const first = read(out);
    await buildPack({ run: createDiskKiro().run }, src, out);
    expect(read(out)).toEqual(first);
    const k = createDiskKiro();
    const again = await k.run('kiro-cli', ['agent', 'upgrade', out, '--no-backup']);
    expect((again as RunResult).code).toBe(0);
    expect(read(out)).toEqual(first);
  });

  it('exits not ok with the stderr and keeps the old files when the upgrade fails', async () => {
    const { src, out } = setup();
    mkdirSync(out);
    writeFileSync(join(out, 'golem-tuner.json'), 'old');
    const k = createDiskKiro();
    k.failNext('upgrade', 1, 'boom: bad agent');
    const r = await buildPack({ run: k.run }, src, out);
    expect(r.ok).toBe(false);
    expect(r.failures[0]?.stderr).toBe('boom: bad agent');
    expect(readFileSync(join(out, 'golem-tuner.json'), 'utf8')).toBe('old');
  });

  it('fails and names the file when validate exits non-zero', async () => {
    const { src, out } = setup();
    const k = createDiskKiro();
    k.failNext('validate', 3, 'schema mismatch');
    const r = await buildPack({ run: k.run }, src, out);
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatchObject({ stderr: 'schema mismatch' });
    expect(r.failures[0]?.file).toMatch(/^golem-/);
  });

  it('skips every kiro-cli step with one line naming kiro-cli and leaves the committed files unchanged', async () => {
    const { src, out } = setup();
    mkdirSync(out);
    writeFileSync(join(out, 'golem-tuner.json'), 'committed');
    const k = createDiskKiro();
    k.missing = true;
    const r = await buildPack({ run: k.run }, src, out);
    expect(r.ok).toBe(true);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toContain('kiro-cli is missing');
    expect(readFileSync(join(out, 'golem-tuner.json'), 'utf8')).toBe('committed');
    expect(k.calls).toHaveLength(1);
  });

  it('writes the manifest of every pack file except agent-src, README and itself', () => {
    const m = buildManifest(PACK_DIR);
    expect(m.files.map((f) => f.rel)).toContain('hooks/golem-guard-requirements.mjs');
    expect(m.files.some((f) => f.rel.startsWith('agent-src/') || f.rel === 'README.md' || f.rel === 'manifest.json')).toBe(false);
    expect(m.files.find((f) => f.rel === 'settings/mcp.json')?.kind).toBe('merge-mcp');
    expect(m.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
  });
});
