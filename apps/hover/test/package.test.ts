import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));

describe('package', () => {
  it('declares the hover package as ES modules for Node 20 under Apache-2.0', () => {
    expect(pkg.name).toBe('hover');
    expect(pkg.type).toBe('module');
    expect(pkg.engines.node).toBe('>=20');
    expect(pkg.license).toBe('Apache-2.0');
  });
  it('has an assets script that runs the asset fetcher, a vitest test script and a vite dev script', () => {
    expect(pkg.scripts.assets).toBe('node scripts/fetch-assets.mjs');
    expect(pkg.scripts.test).toContain('vitest');
    expect(pkg.scripts.dev).toContain('vite');
  });
  it('depends on MuJoCo and golem-spec only at run time', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@mujoco/mujoco', 'golem-spec']);
  });
  it('compiles with strict TypeScript through the base config', () => {
    expect(read('tsconfig.json')).toContain('tsconfig.base.json');
    expect(readFileSync(new URL('../../../tsconfig.base.json', import.meta.url), 'utf8')).toContain('"strict": true');
  });
  it('keeps the MuJoCo WASM bundle out of the Vite pre-bundling step', () => {
    expect(read('web/vite.config.ts')).toContain("optimizeDeps: { exclude: ['@mujoco/mujoco'] }");
  });
  it('is one of the root workspaces', () => {
    const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(root.workspaces).toContain('apps/hover');
  });
});

describe('Kiro pack and documents', () => {
  it('has exactly one Stop hook, from the golem pack, that runs golem gate', () => {
    const hook = JSON.parse(read('.kiro/hooks/golem.json'));
    const stops = hook.hooks.filter((h: { trigger: string }) => h.trigger === 'Stop');
    expect(stops).toHaveLength(1);
    expect(stops[0].action.command).toMatch(/golem(-spec)? gate --kiro\b/);
  });
  it('has the layout of an app', () => {
    for (const p of ['robot/scene.xml', 'robot/x2.xml', 'robot/LICENSE', 'robot/SOURCE.json', 'controller/index.ts', 'scripts/fetch-assets.mjs',
      'lexicon.ts', 'predicates.ts', 'perturbations.ts', 'signals.ts', 'app.ts', 'golem.config.json', 'README.md', 'proposals.md', 'docs/cli-transcript.md',
      '.kiro/specs/hover-hold/requirements.md', '.kiro/hooks/golem.json', 'web/index.html', 'web/main.ts', 'web/worker.ts']) {
      expect(existsSync(new URL(`../${p}`, import.meta.url)), p).toBe(true);
    }
  });
  it('points golem.config.json at the requirements file and the app, with a unit for every signal', () => {
    const cfg = JSON.parse(read('golem.config.json'));
    expect(cfg.app).toBe('./app.ts');
    expect(cfg.requirements).toEqual(['.kiro/specs/hover-hold/requirements.md']);
    expect(Object.keys(cfg.signalUnits).sort()).toEqual(['altitude', 'hover_distance', 'speed', 'tilt_deg']);
  });
  it('keeps the Menagerie licence in robot/LICENSE and the app licence in LICENSE', () => {
    expect(read('robot/LICENSE')).toMatch(/Apache License/);
    expect(read('LICENSE')).toMatch(/Apache License/);
  });
  it('documents the regeneration command, the pinned commit and the licences in the README', () => {
    const readme = read('README.md');
    expect(readme).toContain('npm run assets');
    expect(readme).toContain('370c43965323c0944b433b202aac5058b5f907a9');
    expect(readme).toMatch(/Apache-2\.0/);
  });
});
