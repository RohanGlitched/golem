// The injection seam of the kit. Every side effect of a command goes through these interfaces, so tests
// can call `main(argv, io, deps)` in-process. `createDefaultDeps` (added with task 8.4) loads the heavy
// modules (sim, pool, MuJoCo) with `await import()` inside function bodies, so `golem check` never loads them.
import type { compileRequirement, compileRequirementsFile } from '../ears/index.js';
import type { SeedDatabase, falsify, pinCounterexample } from '../falsify/index.js';
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
  loadApp(modulePath: string): Promise<RobotApp>;
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
