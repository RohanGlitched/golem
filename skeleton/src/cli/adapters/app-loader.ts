// Loads the RobotApp module named by the Config_File (assumption A6).
// A JavaScript module is imported as it is. A TypeScript module is bundled with esbuild, which the kit does not depend
// on: it is found from the app's own project (every Vite project has it) or from the kit. The bundle goes under
// `node_modules/.cache/golem/`, imports `golem-spec` from the running kit, and keeps `import.meta.url` pointing at the
// original source file, so an app that reads `./robot/` relative to itself keeps working.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { RobotApp } from '../sibling-types.js';

const TS = /\.(c|m)?tsx?$/;

interface Esbuild {
  build(o: Record<string, unknown>): Promise<{ outputFiles: { text: string }[]; errors: { text: string }[] }>;
}

export interface PreparedApp { moduleUrl: string; app: RobotApp }

/** Kit entry points as file URLs, so a bundled app shares this kit's module instances. */
function kitEntry(specifier: string): string | undefined {
  const here = import.meta.url;
  const map: Record<string, string> = {
    'golem-spec': '../../index.js', 'golem-spec/node': '../../node.js', 'golem-spec/testing': '../../testing.js', 'golem-spec/ui': '../../ui/index.js',
  };
  const rel = map[specifier];
  return rel === undefined ? undefined : new URL(rel, here).href;
}

function findEsbuild(appPath: string): Esbuild | undefined {
  for (const base of [pathToFileURL(appPath).href, import.meta.url]) {
    try { return createRequire(base)('esbuild') as Esbuild; } catch { /* try the next place */ }
  }
  return undefined;
}

async function cacheDir(appPath: string): Promise<string> {
  let dir = dirname(appPath);
  for (;;) {
    try {
      if ((await stat(join(dir, 'node_modules'))).isDirectory()) return join(dir, 'node_modules', '.cache', 'golem');
    } catch { /* keep walking up */ }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return join(tmpdir(), 'golem-cache');
}

/** Bundles a TypeScript app to `<cache>/app-<pathhash>-<contenthash>.mjs` and returns that file's path. */
export async function bundleApp(appPath: string): Promise<string> {
  const esbuild = findEsbuild(appPath);
  if (esbuild === undefined) {
    throw new Error(`cannot load the TypeScript app ${appPath}: esbuild was not found. Install it (npm i -D esbuild) or point "app" at a built .js file`);
  }
  const plugin = {
    name: 'golem-app',
    setup(b: { onResolve(o: { filter: RegExp }, cb: (a: { path: string }) => unknown): void; onLoad(o: { filter: RegExp; namespace: string }, cb: (a: { path: string }) => Promise<unknown>): void }) {
      b.onResolve({ filter: /^golem-spec(\/.*)?$/ }, (a) => {
        const url = kitEntry(a.path);
        return url === undefined ? undefined : { path: url, external: true };
      });
      b.onLoad({ filter: /\.(c|m)?(t|j)sx?$/, namespace: 'file' }, async (a) => {
        if (a.path.includes('node_modules')) return undefined;
        const text = await readFile(a.path, 'utf8');
        if (!text.includes('import.meta.url')) return undefined;
        return { contents: text.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(a.path).href)), loader: /tsx?$/.test(a.path) ? 'ts' : 'js' };
      });
    },
  };
  const out = await esbuild.build({
    entryPoints: [appPath], bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false, outfile: 'app.mjs',
    sourcemap: 'inline', packages: 'external', logLevel: 'silent', plugins: [plugin],
  });
  const text = out.outputFiles[0]?.text;
  if (text === undefined) throw new Error(`esbuild produced no output for ${appPath}`);
  const dir = await cacheDir(appPath);
  const key = createHash('sha1').update(appPath).digest('hex').slice(0, 8);
  const file = join(dir, `app-${key}-${createHash('sha1').update(text).digest('hex').slice(0, 10)}.mjs`);
  await mkdir(dir, { recursive: true });
  try {
    await stat(file);
  } catch {
    const tmp = `${file}.tmp-${process.pid}`;
    await writeFile(tmp, text);
    await rename(tmp, file);
    for (const old of await readdir(dir)) {
      if (old.startsWith(`app-${key}-`) && join(dir, old) !== file && !old.includes('.tmp-')) await rm(join(dir, old), { force: true });
    }
  }
  return file;
}

const RELATIVE_IMPORT = /\b(?:from|import)\s*\(?\s*['"]\.{1,2}\//;
const ESM_SYNTAX = /^\s*(?:export\s|import[\s{*'"])|\bimport\.meta\b/m;

/** The `type` of the nearest package.json at or above `file` (undefined when there is none or it sets no type). */
async function packageType(file: string): Promise<string | undefined> {
  let dir = dirname(file);
  for (;;) {
    try {
      return (JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { type?: string }).type;
    } catch { /* no readable package.json here: keep walking up */ }
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/**
 * A `.js` app written as an ES module, in a package that does not say `"type": "module"` (the default after
 * `npm init -y`), cannot be imported as it is. A self-contained app (no relative imports) is copied to
 * `<cache>/app-<hash>.mjs` with `import.meta.url` pointing at the original file, so `./robot/` still resolves.
 * Returns undefined when the file can be imported as it is.
 */
async function esmCopy(appPath: string): Promise<string | undefined> {
  if (!/\.js$/.test(appPath) || (await packageType(appPath)) === 'module') return undefined;
  const text = await readFile(appPath, 'utf8');
  if (!ESM_SYNTAX.test(text)) return undefined;
  if (RELATIVE_IMPORT.test(text)) {
    throw new Error(`${appPath} uses ES module syntax and imports other files, so set "type": "module" in the nearest package.json`);
  }
  const body = text.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(appPath).href));
  const dir = await cacheDir(appPath);
  const key = createHash('sha1').update(appPath).digest('hex').slice(0, 8);
  const file = join(dir, `app-${key}-${createHash('sha1').update(body).digest('hex').slice(0, 10)}.mjs`);
  await mkdir(dir, { recursive: true });
  try {
    await stat(file);
  } catch {
    const tmp = `${file}.tmp-${process.pid}`;
    await writeFile(tmp, body);
    await rename(tmp, file);
  }
  return file;
}

/** Imports the app module (building it first when it is TypeScript) and returns its RobotApp. */
export async function prepareApp(modulePath: string): Promise<PreparedApp> {
  const file = TS.test(modulePath) ? await bundleApp(modulePath) : ((await esmCopy(modulePath)) ?? modulePath);
  const moduleUrl = pathToFileURL(file).href;
  const mod = (await import(/* @vite-ignore */ moduleUrl)) as { default?: RobotApp; app?: RobotApp };
  const app = mod.default ?? mod.app;
  if (app === undefined || typeof app.id !== 'string' || app.lexicon === undefined) {
    throw new Error(`${modulePath} must export a RobotApp as its default export (or as "app")`);
  }
  return { moduleUrl, app };
}

/** The module the pool workers import: it exports `app` and a `requirements(id)` lookup that compiles the files. */
export async function writeWorkerModule(appModuleUrl: string, requirementFiles: readonly string[], appPath: string): Promise<string> {
  const dir = await cacheDir(appPath);
  const ears = new URL('../../ears/index.js', import.meta.url).href;
  const files = requirementFiles.map((f) => pathToFileURL(f).href);
  const text = `import * as mod from ${JSON.stringify(appModuleUrl)};
import { compileRequirementsFile } from ${JSON.stringify(ears)};
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const app = mod.default ?? mod.app;
const files = ${JSON.stringify(files)};
let compiled;
export function requirements(id) {
  compiled ??= files.flatMap((f) => compileRequirementsFile(readFileSync(fileURLToPath(f), 'utf8'), app.lexicon).requirements);
  return compiled.find((r) => r.id === id);
}
`;
  const file = join(dir, `worker-${createHash('sha1').update(text).digest('hex').slice(0, 10)}.mjs`);
  await mkdir(dir, { recursive: true });
  try {
    await stat(file);
  } catch {
    const tmp = `${file}.tmp-${process.pid}`;
    await writeFile(tmp, text);
    await rename(tmp, file);
  }
  return pathToFileURL(file).href;
}

export const modulePathOf = (url: string): string => fileURLToPath(url);
