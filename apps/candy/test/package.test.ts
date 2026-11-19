import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('package', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const tsconfig = readFileSync(new URL('../tsconfig.json', import.meta.url), 'utf8');
  const vite = readFileSync(new URL('../web/vite.config.ts', import.meta.url), 'utf8');

  it('declares the candy package as ES modules for Node 20 under Apache-2.0', () => {
    expect(pkg.name).toBe('candy');
    expect(pkg.type).toBe('module');
    expect(pkg.engines.node).toBe('>=20');
    expect(pkg.license).toBe('Apache-2.0');
  });
  it('has an assets script that runs the asset fetcher, a vitest test script and a vite dev script', () => {
    expect(pkg.scripts.assets).toBe('node scripts/fetch-assets.mjs');
    expect(pkg.scripts.test).toContain('vitest');
    expect(pkg.scripts.dev).toContain('vite');
  });
  it('lists runtime and development dependencies', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@mujoco/mujoco', 'golem-spec']);
    for (const d of ['meshoptimizer', 'vitest', 'fast-check', 'typescript', 'vite']) {
      expect(pkg.devDependencies[d], d).toBeDefined();
    }
  });
  it('compiles with strict TypeScript through the base config', () => {
    expect(tsconfig).toContain('tsconfig.base.json');
    expect(readFileSync(new URL('../../../tsconfig.base.json', import.meta.url), 'utf8')).toContain('"strict": true');
  });
  it('keeps the MuJoCo WASM bundle out of the Vite pre-bundling step', () => {
    expect(vite).toContain("optimizeDeps: { exclude: ['@mujoco/mujoco'] }");
  });
  it('ships an Apache-2.0 licence for the app code', () => {
    expect(readFileSync(new URL('../LICENSE', import.meta.url), 'utf8')).toContain('Apache License');
  });
});
