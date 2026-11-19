import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_ROOT, badSkeletonImports, deepImports, files, importSpecifiers, read, rel, usesClock, usesRandom } from './helpers/sourceScan';

/** Source files of the app: TypeScript and the asset scripts, without tests, generated robot/ and dependencies. */
const source = files('.', ['.ts', '.mjs']).filter((p) => !rel(p).endsWith('.d.ts'));
const typed = source.filter((p) => p.endsWith('.ts'));
/** Where a wall clock is forbidden: the controller, the lexicon pieces and the app (Requirements 5.14, 10.9). */
const deterministic = typed.filter((p) => /^(controller\/|app\.ts|lexicon\.ts|perturbations\.ts|predicates\.ts|signals\.ts|geometry\.ts|runtime\.ts)/.test(rel(p)));

describe('layout', () => {
  it('has the folders and files that the structure rule names', () => {
    for (const p of ['robot', 'controller', 'scripts', 'web', '.kiro', 'lexicon.ts', 'app.ts', 'package.json']) {
      expect(existsSync(`${APP_ROOT}${p}`), p).toBe(true);
    }
  });
  it('declares golem-spec as a dependency', () => {
    const pkg = JSON.parse(readFileSync(`${APP_ROOT}package.json`, 'utf8'));
    expect(pkg.dependencies['golem-spec']).toBeDefined();
  });
  it('finds the app sources it is meant to scan', () => {
    const names = typed.map(rel);
    for (const n of ['app.ts', 'lexicon.ts', 'controller/index.ts', 'controller/ssm.ts', 'signals.ts']) expect(names).toContain(n);
    expect(names.some((n) => n.startsWith('test/') || n.startsWith('robot/'))).toBe(false);
  });
});

describe('imports', () => {
  it('has no import path that contains skeleton/src, in the sources and in the tests', () => {
    const everything = [...source, ...files('test', ['.ts'], ['node_modules']).filter((p) => !/hygiene\.test|p37-hygiene|sourceScan/.test(p))];
    for (const p of everything) expect(deepImports(read(p)), rel(p)).toEqual([]);
  });
  it('reaches the skeleton only through golem-spec, golem-spec/ui, golem-spec/ui/worker or golem-spec/node', () => {
    for (const p of source) expect(badSkeletonImports(read(p)), rel(p)).toEqual([]);
    const used = new Set(source.flatMap((p) => importSpecifiers(read(p))).filter((s) => s.startsWith('golem-spec')));
    expect([...used].every((s) => ['golem-spec', 'golem-spec/ui', 'golem-spec/ui/worker', 'golem-spec/node'].includes(s))).toBe(true);
    expect(used.has('golem-spec')).toBe(true);
  });
});

describe('determinism', () => {
  it('has no Math.random anywhere in the app', () => {
    for (const p of source) expect(usesRandom(read(p)), rel(p)).toBe(false);
  });
  it('reads no wall clock in controller/, lexicon.ts, app.ts and the files they use', () => {
    expect(deterministic.length).toBeGreaterThan(10);
    for (const p of deterministic) expect(usesClock(read(p)), rel(p)).toBe(false);
  });
});
