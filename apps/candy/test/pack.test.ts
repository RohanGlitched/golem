import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('Kiro pack', () => {
  it('has exactly one Stop hook, from the golem pack, that runs golem gate', () => {
    const hook = JSON.parse(read('.kiro/hooks/golem.json'));
    expect(hook.version).toBe('v1');
    const stops = hook.hooks.filter((h: { trigger: string }) => h.trigger === 'Stop');
    expect(stops).toHaveLength(1);
    const h = stops[0];
    expect(h.name).toBeTruthy();
    expect(h.action.type).toBe('command');
    expect(h.action.command).toMatch(/golem(-spec)? gate --kiro\b/);
    expect(h.timeout).toBeGreaterThan(0);
  });
  it('has no second Stop hook next to the pack (a bare `golem gate --kiro` would run the gate twice)', () => {
    expect(existsSync(new URL('../.kiro/hooks/gate.json', import.meta.url))).toBe(false);
    const dir = new URL('../.kiro/hooks/', import.meta.url);
    const stops = readdirSync(dir).filter((f) => f.endsWith('.json'))
      .flatMap((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')).hooks as { trigger: string }[])
      .filter((h) => h.trigger === 'Stop');
    expect(stops).toHaveLength(1);
  });
  it('has no hook that could block a write to requirements.md', () => {
    const hook = JSON.parse(read('.kiro/hooks/golem.json'));
    for (const h of hook.hooks) expect(String(h.trigger).toLowerCase()).not.toBe('pretooluse');
  });  it('documents the regeneration command, the licences and the evidence folder in the README', () => {
    const readme = read('README.md');
    expect(readme).toContain('npm run assets');
    expect(readme).toContain('370c43965323c0944b433b202aac5058b5f907a9');
    expect(readme).toMatch(/Apache-2\.0/);
    expect(readme).toContain('evidence/');
  });
  it('records the expected SSM_v1 limit as the first proposal', () => {
    const p = read('proposals.md');
    expect(p).toMatch(/^# Proposals/m);
    expect(p.indexOf('## P1.')).toBeGreaterThan(0);
    expect(p).toMatch(/## P1\. SSM_v1 watches the suction-cup tip only/);
    expect(p).toMatch(/never edited|not in the requirement line/);
  });
  it('keeps the Menagerie licence in robot/LICENSE and the app licence in LICENSE', () => {
    expect(read('robot/LICENSE')).toMatch(/Apache License/);
    expect(read('LICENSE')).toMatch(/Apache License/);
  });
  it('has the folders and files of the app layout', () => {
    for (const p of ['robot/scene.xml', 'robot/panda.xml', 'controller/index.ts', 'scripts/fetch-assets.mjs', 'lexicon.ts', 'app.ts',
      '.kiro/specs/candy-sorter/requirements.md', '.kiro/hooks/golem.json', 'package.json']) {
      expect(existsSync(new URL(`../${p}`, import.meta.url)), p).toBe(true);
    }
  });
});
