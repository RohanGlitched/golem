import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runtimeFor, resetRuntime } from '../runtime.js';
import type { SimContext } from '../contract.js';

const mkCtx = (): SimContext => ({ mj: {}, model: {}, data: {}, ids: {} });

describe('package', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const tsconfig = readFileSync(new URL('../tsconfig.json', import.meta.url), 'utf8');
  it('declares the stagger package as ES modules for Node 20 under Apache-2.0', () => {
    expect(pkg.name).toBe('stagger');
    expect(pkg.type).toBe('module');
    expect(pkg.engines.node).toBe('>=20');
    expect(pkg.license).toBe('Apache-2.0');
  });
  it('has an assets script that runs the asset fetcher and a vitest test script', () => {
    expect(pkg.scripts.assets).toBe('node scripts/fetch-assets.mjs');
    expect(pkg.scripts.test).toContain('vitest');
  });
  it('lists runtime and development dependencies', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@mujoco/mujoco', 'golem-spec']);
    for (const d of ['quickhull3d', 'meshoptimizer', 'vitest', 'fast-check', 'typescript', 'vite']) {
      expect(pkg.devDependencies[d]).toBeDefined();
    }
  });
  it('compiles with strict TypeScript through the base config', () => {
    expect(tsconfig).toContain('tsconfig.base.json');
    expect(readFileSync(new URL('../../../tsconfig.base.json', import.meta.url), 'utf8')).toContain('"strict": true');
  });
});

describe('runtime', () => {
  it('returns the same object for the same context and different objects otherwise', () => {
    const a = mkCtx(); const b = mkCtx();
    expect(runtimeFor(a)).toBe(runtimeFor(a));
    expect(runtimeFor(a)).not.toBe(runtimeFor(b));
  });
  it('starts with the default command, no delay and nothing latched', () => {
    const rt = runtimeFor(mkCtx());
    expect(Array.from(rt.command)).toEqual([0.5, 0, 0]);
    expect(rt.delaySteps).toBe(0);
    expect(rt.trigger.latched).toBe(false);
    expect(rt.push.latched).toBe(false);
    expect(rt.saved.has).toBe(false);
  });
  it('resetRuntime restores the defaults without replacing the arrays', () => {
    const rt = runtimeFor(mkCtx());
    const cmd = rt.command; const buf = rt.speedRing.buf;
    cmd[0] = 2; rt.delaySteps = 7; rt.trigger.latched = true; rt.push.latched = true; rt.saved.has = true;
    rt.speedRing.n = 5; buf[3] = 9;
    resetRuntime(rt);
    expect(rt.command).toBe(cmd);
    expect(rt.speedRing.buf).toBe(buf);
    expect(Array.from(cmd)).toEqual([0.5, 0, 0]);
    expect(rt.delaySteps).toBe(0);
    expect(rt.trigger.latched).toBe(false);
    expect(rt.push.latched).toBe(false);
    expect(rt.saved.has).toBe(false);
    expect(rt.speedRing.n).toBe(0);
    expect(buf[3]).toBe(0);
  });
  it('allocates nothing new on a second runtimeFor call', () => {
    const ctx = mkCtx();
    const rt = runtimeFor(ctx);
    const arrays = [rt.command, rt.trigger.pos, rt.speedRing.buf, rt.saved.gravity];
    const again = runtimeFor(ctx);
    expect([again.command, again.trigger.pos, again.speedRing.buf, again.saved.gravity]).toEqual(arrays);
    expect(again.command).toBe(arrays[0]);
  });
});
