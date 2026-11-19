// Test-only: compiles the worker entry (and everything it imports) to plain ESM so a real
// worker_threads Worker can run it from the TypeScript sources. Output goes under
// skeleton/node_modules/.cache so bare imports such as '@mujoco/mujoco' still resolve.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { removeTempDir } from './temp-dir.testkit.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..');

export interface WorkerBuild {
  /** URL of the compiled `pool/node-entry.js`. */
  entry: URL;
  /** URL of a compiled source file, by its path under `src/` with a `.js` extension. */
  url(rel: string): URL;
  outDir: string;
  dispose(): void;
}

export function buildWorkerEntry(extraRoots: string[] = []): WorkerBuild {
  const outDir = resolve(srcRoot, '..', 'node_modules', '.cache', `golem-pool-test-${process.pid}-${Date.now()}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'package.json'), '{ "type": "module" }\n');
  const roots = [join(srcRoot, 'pool', 'node-entry.ts'), ...extraRoots.map((r) => join(srcRoot, r))];
  const program = ts.createProgram(roots, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    rootDir: srcRoot,
    outDir,
    skipLibCheck: true,
    noEmitOnError: false,
    declaration: false,
    sourceMap: false,
    isolatedModules: true,
    esModuleInterop: true,
    types: ['node'],
  });
  const emitted = program.emit();
  if (emitted.emitSkipped) throw new Error('worker entry build was skipped');
  return {
    entry: pathToFileURL(join(outDir, 'pool', 'node-entry.js')),
    url: (rel) => pathToFileURL(join(outDir, rel)),
    outDir,
    dispose: () => removeTempDir(outDir),
  };
}

/** URL of the synthetic trial module fixture (plain .mjs, no build needed). */
export const syntheticTrialModule = pathToFileURL(join(here, 'fixtures', 'synthetic-trial.mjs')).href;
