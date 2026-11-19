import { describe, expect, it } from 'vitest';
import { checkHookFile, matcherAccepts } from '../scripts/pack-checks/hooks.js';
import { hookFile } from './support/pack.js';
import { RED_REQUIREMENTS, createHarness, stopPayload } from './support/harness.js';

describe('hooks/golem.json', () => {
  const file = hookFile();

  it('is a valid v1 hook file with exactly five hooks and no violation', () => {
    expect(file.version).toBe('v1');
    expect(file.hooks).toHaveLength(5);
    expect(checkHookFile(file, 1)).toEqual([]);
  });

  it('carries the five hooks of the design with exact names, triggers, commands and timeouts', () => {
    expect(file.hooks.map((h) => [h['name'], h['trigger'], h['action'].command, h['timeout']])).toEqual([
      ['Check requirements on save', 'PostFileSave', 'npx --no-install golem-spec check', 30],
      ['Falsify controller on save', 'PostFileSave', 'npx --no-install golem-spec test --budget 24', 300],
      ['Gate the agent', 'Stop', 'npx --no-install golem-spec gate --kiro', 300],
      ['Test after spec task', 'PostTaskExec', 'npx --no-install golem-spec test', 300],
      ['Summon the ghosts', 'Manual', 'npx --no-install golem-spec test --budget 256', 1800],
    ]);
    for (const h of file.hooks) expect(h['action'].type).toBe('command');
  });

  it('states each timeout and its reason in the description', () => {
    for (const h of file.hooks) {
      expect(h['description']).toContain(`${h['timeout']} s`);
      expect(String(h['description']).length).toBeGreaterThan(40);
    }
  });

  it('has the requirements matcher accept and reject the sample paths of requirement 28.24', () => {
    const m = file.hooks[0]?.['matcher'] as string;
    for (const p of ['requirements.md', 'specs/a/requirements.md', 'specs\\a\\requirements.md']) expect(matcherAccepts(m, p), p).toBe(true);
    for (const p of ['my-requirements.md', 'requirements.md.bak']) expect(matcherAccepts(m, p), p).toBe(false);
  });

  it('has the controller matcher accept and reject the sample paths of requirement 28.24', () => {
    const m = file.hooks[1]?.['matcher'] as string;
    for (const p of ['apps/x/controller/a.ts', 'controller\\a.ts', 'apps/stagger/controller/gait.ts']) expect(matcherAccepts(m, p), p).toBe(true);
    for (const p of ['apps/x/my-controller/a.ts', 'controller.ts']) expect(matcherAccepts(m, p), p).toBe(false);
  });

  it('holds no PreToolUse hook and no reference to the guard', () => {
    expect(JSON.stringify(file).toLowerCase()).not.toContain('pretooluse');
    expect(JSON.stringify(file)).not.toContain('golem-guard');
  });

  it('has every timeout at least the measured wall time of one quick-budget gate run on the Tiny_Test_App', async () => {
    const h = createHarness({ requirements: RED_REQUIREMENTS });
    h.io.setStdin(stopPayload('t'));
    const t0 = performance.now();
    await h.run('gate', '--kiro');
    const wallS = Math.ceil((performance.now() - t0) / 1000);
    for (const hk of file.hooks) expect(hk['timeout']).toBeGreaterThanOrEqual(wallS);
    expect(checkHookFile(file, wallS)).toEqual([]);
  });
});

describe('checkHookFile reports each violation once', () => {
  const clone = () => JSON.parse(JSON.stringify(hookFile())) as ReturnType<typeof hookFile>;
  const bad = (mutate: (f: ReturnType<typeof clone>) => void): string[] => { const f = clone(); mutate(f); return checkHookFile(f, 1); };

  it.each([
    ['a wrong version', (f: ReturnType<typeof clone>) => { f.version = 'v2'; }, /version/],
    ['four hooks', (f: ReturnType<typeof clone>) => { f.hooks.pop(); }, /exactly 5/],
    ['a duplicate name ignoring case', (f: ReturnType<typeof clone>) => { (f.hooks[1] as Record<string, unknown>)['name'] = 'CHECK REQUIREMENTS ON SAVE'; }, /repeats/],
    ['a lower-case trigger', (f: ReturnType<typeof clone>) => { (f.hooks[2] as Record<string, unknown>)['trigger'] = 'stop'; }, /exact casing/],
    ['an empty command', (f: ReturnType<typeof clone>) => { (f.hooks[0] as Record<string, any>)['action'].command = ''; }, /action/],
    ['a string action', (f: ReturnType<typeof clone>) => { (f.hooks[0] as Record<string, unknown>)['action'] = 'npx --no-install golem-spec check'; }, /action/],
    ['a missing matcher', (f: ReturnType<typeof clone>) => { delete (f.hooks[0] as Record<string, unknown>)['matcher']; }, /matcher/],
    ['an invalid matcher', (f: ReturnType<typeof clone>) => { (f.hooks[0] as Record<string, unknown>)['matcher'] = '(['; }, /not a valid regular expression/],
    ['a low timeout', (f: ReturnType<typeof clone>) => { (f.hooks[0] as Record<string, unknown>)['timeout'] = 0; }, /below the measured/],
    ['a PreToolUse hook', (f: ReturnType<typeof clone>) => { (f.hooks[3] as Record<string, unknown>)['trigger'] = 'PreToolUse'; }, /PreToolUse/],
    ['a guard reference', (f: ReturnType<typeof clone>) => { (f.hooks[3] as Record<string, any>)['action'].command = 'node .kiro/hooks/golem-guard-requirements.mjs'; }, /guard/],
  ])('%s', (_n, mutate, re) => {
    const v = bad(mutate);
    expect(v.length).toBeGreaterThan(0);
    expect(v.some((x) => re.test(x))).toBe(true);
  });

  it('rejects a non-object', () => { expect(checkHookFile(null, 1)).toHaveLength(1); });
});
