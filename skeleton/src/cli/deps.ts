// The injection seam of the kit. Every side effect of a command goes through these interfaces, so tests
// can call `main(argv, io, deps)` in-process. `createDefaultDeps` (added with task 8.4) loads the heavy
// modules (sim, pool, MuJoCo) with `await import()` inside function bodies, so `golem check` never loads them.
import { fileURLToPath } from 'node:url';
import { compileRequirement, compileRequirementsFile } from '../ears/index.js';
import { createSeedDatabase, falsify, pinCounterexample, type SeedDatabase } from '../falsify/index.js';
import { nodeFileSystem } from '../pool/node-fs.js';
import type { CompiledRequirement, RobotApp, Trace, TrialPool, TrialResult, TrialSpec } from './sibling-types.js';

/** The `node:fs/promises` subset the kit uses. A missing file rejects with `error.code === 'ENOENT'`. */
export interface KitFs {
  readFile(p: string): Promise<string>;
  readBytes(p: string): Promise<Uint8Array>;
  writeFile(p: string, data: string | Uint8Array): Promise<void>;
  rename(a: string, b: string): Promise<void>;
  mkdir(p: string, o: { recursive: true }): Promise<void>;
  /** Ignores a missing path. */
  remove(p: string): Promise<void>;
  realpath(p: string): Promise<string>;
  readdir(p: string): Promise<string[]>;
  stat(p: string): Promise<{ isFile: boolean; isDirectory: boolean }>;
}

export interface CliIo {
  stdout: { write(s: string): void };
  stderr: { write(s: string): void };
  /** `read` resolves with the text, or `undefined` when nothing arrived within `timeoutMs`. */
  stdin: { isTTY: boolean; read(timeoutMs: number): Promise<string | undefined> };
  cwd: string;
}

export interface CreatePoolOptions {
  app: RobotApp;
  appDir: string;
  size?: number;
  /** Absolute paths of the Requirements_Files, so that workers can compile the same requirements. */
  requirementFiles?: string[];
}

export interface TracedRun { result: TrialResult; trace: Trace }

export interface KitDeps {
  fs: KitFs;
  /** Wall time, for stamps and pruning only. */
  now(): Date;
  /** Monotonic milliseconds, for durations. */
  clock(): number;
  /** Absolute path of `skeleton/kiro-pack`. */
  packRoot: string;
  /** `appDir` is the directory whose files `appChanged` watches (default: the folder of the module). */
  loadApp(modulePath: string, appDir?: string): Promise<RobotApp>;
  /**
   * True when a source or model file under the app directory is newer than it was when `app` was loaded, so a long-lived
   * process (the MCP server) must call loadApp again and recreate its pool. Absent in test deps: nothing ever changes.
   */
  appChanged?(app: RobotApp): Promise<boolean>;
  compileFile: typeof compileRequirementsFile;
  compileLine: typeof compileRequirement;
  falsify: typeof falsify;
  createSeedDatabase(root: string): SeedDatabase;
  pinCounterexample: typeof pinCounterexample;
  createPool(o: CreatePoolOptions): Promise<TrialPool>;
  runTraced(app: RobotApp, req: CompiledRequirement, spec: TrialSpec): Promise<TracedRun>;
  gitCommit(appDir: string): Promise<string | undefined>;
  /** Releases what the default deps hold (the cached MuJoCo models of `runTraced`). Called once at the end of `main`. */
  dispose?(): Promise<void>;
}

/** Thrown by `runTraced` when the simulator cannot give the trace of a trial. */
export class TraceUnavailableError extends Error {
  constructor(message = 'trace unavailable: golem-sim does not expose the trace of a trial (TrialResult.trace with recordTrace)') {
    super(message);
    this.name = 'TraceUnavailableError';
  }
}

// ---------------------------------------------------------------- default deps

/** Real Node dependencies. Every heavy module (sim, pool, MuJoCo, esbuild) is loaded by `await import()` inside a function. */
export function createDefaultDeps(): KitDeps {
  const modulesOfApp = new WeakMap<RobotApp, { moduleUrl: string; modulePath: string; appDir: string; stamp: number }>();
  let runner: ReturnType<typeof import('./adapters/trace.js').createTraceRunner> | undefined;
  const slash = (p: string): string => p.replace(/\\/g, '/');

  const fs: KitFs = {
    async readFile(p) { return (await import('node:fs/promises')).readFile(p, 'utf8'); },
    async readBytes(p) { return new Uint8Array(await (await import('node:fs/promises')).readFile(p)); },
    async writeFile(p, d) { await (await import('node:fs/promises')).writeFile(p, d); },
    async rename(a, b) { await (await import('node:fs/promises')).rename(a, b); },
    async mkdir(p, o) { await (await import('node:fs/promises')).mkdir(p, o); },
    async remove(p) { await (await import('node:fs/promises')).rm(p, { force: true }); },
    async realpath(p) { return slash(await (await import('node:fs/promises')).realpath(p)); },
    async readdir(p) { return (await import('node:fs/promises')).readdir(p); },
    async stat(p) { const s = await (await import('node:fs/promises')).stat(p); return { isFile: s.isFile(), isDirectory: s.isDirectory() }; },
  };

  return {
    fs,
    now: () => new Date(),
    clock: () => performance.now(),
    packRoot: slash(fileURLToPath(new URL('../../kiro-pack', import.meta.url))),
    async loadApp(modulePath, appDir) {
      const { prepareApp, newestSourceMtime } = await import('./adapters/app-loader.js');
      const dir = appDir ?? (await import('node:path')).dirname(modulePath);
      // The stamp is taken before the import, so an edit made while the module loads is seen as a change by the next call.
      const stamp = await newestSourceMtime(dir);
      const { moduleUrl, app } = await prepareApp(modulePath, stamp);
      modulesOfApp.set(app, { moduleUrl, modulePath, appDir: dir, stamp });
      return app;
    },
    async appChanged(app) {
      const known = modulesOfApp.get(app);
      if (known === undefined) return false;
      const { newestSourceMtime } = await import('./adapters/app-loader.js');
      return (await newestSourceMtime(known.appDir)) > known.stamp;
    },
    compileFile: compileRequirementsFile,
    compileLine: compileRequirement,
    falsify,
    createSeedDatabase: (root) => createSeedDatabase(nodeFileSystem(), root),
    pinCounterexample,
    async createPool(o) {
      const known = modulesOfApp.get(o.app);
      if (known === undefined) throw new Error('internal error: the app was not loaded through loadApp');
      const { writeWorkerModule } = await import('./adapters/app-loader.js');
      const appModule = await writeWorkerModule(known.moduleUrl, o.requirementFiles ?? [], known.modulePath);
      const { createNodePool } = await import('../pool/node.js');
      return createNodePool({ appId: o.app.id, ...(o.size !== undefined ? { size: o.size } : {}), config: { appModule } });
    },
    async runTraced(app, req, spec) {
      if (runner === undefined) {
        const { createTraceRunner } = await import('./adapters/trace.js');
        runner = createTraceRunner(async () => (await import('../sim/index.js')) as unknown as import('./adapters/trace.js').SimLike);
      }
      return runner.runTraced(app, req, spec);
    },
    async gitCommit(appDir) {
      try {
        const { execFile } = await import('node:child_process');
        return await new Promise<string | undefined>((resolve) => {
          execFile('git', ['rev-parse', '--short', 'HEAD'], { cwd: appDir, timeout: 3000, windowsHide: true }, (err, out) => resolve(err !== null ? undefined : out.trim() || undefined));
        });
      } catch { return undefined; }
    },
    async dispose() { await runner?.dispose(); runner = undefined; },
  };
}