import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { forbiddenImports, importSpecifiers } from './helpers/importScan';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', 'robot', 'dist', '.kiro']);

function sources(dir = ROOT): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else out.push(p);
  }
  return out;
}
const code = () => sources().filter((p) => /\.(ts|mts|mjs|js|tsx)$/.test(p));

describe('package layout', () => {
  it('imports skeleton code only through golem-spec entry points', () => {
    for (const f of code()) expect([f, forbiddenImports(readFileSync(f, 'utf8'))]).toEqual([f, []]);
  });

  it('uses no Math.random in controller/, lexicon.ts or app.ts', () => {
    const files = [...readdirSync(join(ROOT, 'controller')).map((f) => join(ROOT, 'controller', f)), join(ROOT, 'lexicon.ts'), join(ROOT, 'app.ts')];
    for (const f of files) expect([f, /Math\.random\s*\(/.test(readFileSync(f, 'utf8'))]).toEqual([f, false]);
  });

  it('contains no Python files', () => {
    expect(sources().filter((p) => /\.(py|pyc|ipynb)$/.test(p) || /requirements\.txt$/.test(p))).toEqual([]);
  });

  it('has the required files and folders', () => {
    for (const p of ['robot', 'controller', 'lexicon.ts', 'app.ts', '.kiro/specs/g1-walking/requirements.md', 'web', 'scripts/fetch-assets.mjs', 'README.md', 'proposals.md', 'LICENSE']) {
      expect([p, existsSync(join(ROOT, p))]).toEqual([p, true]);
    }
  });

  it('gives the regeneration command in the README', () => {
    expect(readFileSync(join(ROOT, 'README.md'), 'utf8')).toContain('npm run assets');
  });
});

describe('Feature: stagger-app, Property 37: The import scan flags exactly the forbidden imports', () => {
  const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/);
  const okSpec = fc.oneof(
    fc.constantFrom('golem-spec', 'golem-spec/ui', 'golem-spec/node', 'vitest', 'node:fs', './app.js', '../runtime'),
    fc.array(segment, { minLength: 1, maxLength: 4 }).map((s) => `./${s.join('/')}`),
  ).filter((s) => !s.includes('skeleton/src'));
  const badSpec = fc.tuple(fc.constantFrom('', '../', '../../', '../../../'), fc.array(segment, { maxLength: 3 }))
    .map(([pre, s]) => `${pre}skeleton/src/${s.join('/') || 'index'}.js`);
  const form = fc.constantFrom(
    (s: string) => `import { a } from '${s}';`,
    (s: string) => `import type { B } from "${s}";`,
    (s: string) => `import '${s}';`,
    (s: string) => `export * from '${s}';`,
    (s: string) => `const m = await import('${s}');`,
    (s: string) => `const r = require("${s}");`,
  );

  it('reports an import exactly when its specifier contains skeleton/src', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.boolean(), okSpec, badSpec, form), { maxLength: 8 }), (entries) => {
      const src = entries.map(([bad, ok, b, f]) => f(bad ? b : ok)).join('\n');
      const expected = entries.filter(([bad]) => bad).map(([, , b]) => b);
      expect(forbiddenImports(src)).toEqual(expected);
      expect(importSpecifiers(src)).toHaveLength(entries.length);
    }), { numRuns: 200 });
  });
});
