// Every ```ts block in the falsify and pool READMEs must type-check against the public entries.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function blocks(readme: string): string[] {
  const text = readFileSync(readme, 'utf8');
  return [...text.matchAll(/```ts\r?\n([\s\S]*?)```/g)].map((m) => m[1] as string);
}

function typeErrors(files: Record<string, string>): string[] {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    strict: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    noEmit: true,
    types: ['node'],
    baseUrl: src,
    paths: {
      'golem-spec': ['index.ts'],
      'golem-spec/node': ['node.ts'],
      'golem-spec/testing': ['testing.ts'],
    },
  };
  const host = ts.createCompilerHost(options);
  const norm = (f: string) => resolve(f);
  const virtual = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]));
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.fileExists = (f) => virtual.has(norm(f)) || fileExists(f);
  host.readFile = (f) => virtual.get(norm(f)) ?? readFile(f);
  host.getSourceFile = (f, lang, onError, create) => {
    const v = virtual.get(norm(f));
    return v !== undefined ? ts.createSourceFile(f, v, lang) : getSourceFile(f, lang, onError, create);
  };
  const program = ts.createProgram([...virtual.keys()], options, host);
  const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.file === undefined || virtual.has(norm(d.file.fileName)));
  return diags.map((d) => `${d.file ? `${d.file.fileName}: ` : ''}${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}

describe('README examples', () => {
  it('type-check every ts block of falsify/README.md and pool/README.md against the public exports', () => {
    const files: Record<string, string> = {};
    let n = 0;
    for (const readme of [join(src, 'falsify', 'README.md'), join(src, 'pool', 'README.md')]) {
      for (const b of blocks(readme)) files[join(src, '__readme__', `block${n++}.ts`)] = `${b}\nexport {};\n`;
    }
    expect(n).toBeGreaterThanOrEqual(3);
    expect(typeErrors(files)).toEqual([]);
  }, 120000);

  it('catches a block that misuses the API', () => {
    const bad = { [join(src, '__readme__', 'bad.ts')]: "import { InProcessPool } from 'golem-spec';\nconst p: number = new InProcessPool(() => 1);\nexport {};\n" };
    const errs = typeErrors(bad);
    expect(errs.some((e) => e.includes('not assignable'))).toBe(true);
    expect(errs.some((e) => e.includes('Cannot find module'))).toBe(false);
  }, 120000);
});
