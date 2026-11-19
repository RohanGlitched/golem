// Fakes for KitDeps: a recording pool over the synthetic trial, a fake clock, a CliIo that collects output,
// a spy on the lazy loaders, and a fake `kiro-cli` runner that models the verified upgrade and validate behaviour.
import { compileRequirement, compileRequirementsFile } from '../../src/ears/index.js';
import { AbortError, createSeedDatabase, falsify, pinCounterexample } from '../../src/falsify/index.js';
import type { FileSystem } from '../../src/falsify/index.js';
import type { CliIo, KitDeps, TracedRun } from '../../src/cli/deps.js';
import { TraceUnavailableError } from '../../src/cli/deps.js';
import type { CompiledRequirement, RobotApp, TrialPool, TrialResult, TrialSpec } from '../../src/cli/sibling-types.js';
import { createMemoryFs, type MemoryKitFs } from './memory-fs.js';
import { compileTiny, tinyApp, tinyLexicon, tinyTrial, TINY_REQUIREMENTS } from './tiny-app.js';

export const APP_DIR = '/proj/app';
export const PACK_ROOT = '/pack';

export interface FakeClock { ms: number; advance(ms: number): void; now(): Date; mono(): number }

export function createFakeClock(startIso = '2026-10-31T04:00:00.000Z'): FakeClock {
  const c: FakeClock = {
    ms: Date.parse(startIso),
    advance(ms) { c.ms += ms; },
    now: () => new Date(c.ms),
    mono: () => c.ms,
  };
  return c;
}

export interface TestIo extends CliIo {
  out: string[];
  err: string[];
  stdoutText(): string;
  stderrText(): string;
  /** Text returned by `stdin.read`. */
  setStdin(text: string | undefined): void;
}

export function createTestIo(cwd = APP_DIR): TestIo {
  let stdin: string | undefined;
  const io: TestIo = {
    out: [], err: [], cwd,
    stdout: { write: (s) => { io.out.push(s); } },
    stderr: { write: (s) => { io.err.push(s); } },
    stdin: { isTTY: false, read: async () => stdin },
    stdoutText: () => io.out.join(''),
    stderrText: () => io.err.join(''),
    setStdin: (t) => { stdin = t; },
  };
  return io;
}

export interface Spies {
  loadApp: number;
  createPool: number;
  poolRun: number;
  poolClose: number;
  runTraced: number;
  falsify: number;
  poolSpecs: TrialSpec[];
}

export interface TestDepsOptions {
  fs?: MemoryKitFs;
  app?: RobotApp;
  clock?: FakeClock;
  /** Replaces the trial function of the fake pool. Default: the synthetic Tiny trial. */
  trial?: (req: CompiledRequirement, spec: TrialSpec) => TrialResult;
  /** Requirement lookup for the pool. Default: compile the Tiny requirement file in `fs`. */
  requirementsFor?: () => CompiledRequirement[];
  falsifyImpl?: KitDeps['falsify'];
  /** `runTraced` fails with this error instead of running. */
  traceError?: Error;
  poolError?: Error;
  commit?: string | undefined;
}

export interface TestDeps {
  deps: KitDeps;
  fs: MemoryKitFs;
  spies: Spies;
  clock: FakeClock;
}

export const asFileSystem = (fs: MemoryKitFs): FileSystem => ({
  readFile: (p) => fs.readFile(p),
  writeFile: (p, d) => fs.writeFile(p, d),
  rename: (a, b) => fs.rename(a, b),
  mkdir: (p, o) => fs.mkdir(p, o),
  remove: (p) => fs.remove(p),
});

/** Config and requirement file of the Tiny app at `APP_DIR`. */
export function seedTinyProject(fs: MemoryKitFs, requirements: string = TINY_REQUIREMENTS, dir: string = APP_DIR): void {
  fs.put(`${dir}/golem.config.json`, '{\n  "app": "./app.js",\n  "requirements": [".kiro/specs/tiny/requirements.md"],\n  "robot": "tiny"\n}\n');
  fs.put(`${dir}/.kiro/specs/tiny/requirements.md`, requirements);
}

export function createTestDeps(o: TestDepsOptions = {}): TestDeps {
  const fs = o.fs ?? createMemoryFs();
  const clock = o.clock ?? createFakeClock();
  const app = o.app ?? tinyApp;
  const spies: Spies = { loadApp: 0, createPool: 0, poolRun: 0, poolClose: 0, runTraced: 0, falsify: 0, poolSpecs: [] };
  const reqs = (): CompiledRequirement[] => (o.requirementsFor !== undefined ? o.requirementsFor() : compileTiny(fs.text(`${APP_DIR}/.kiro/specs/tiny/requirements.md`) ?? TINY_REQUIREMENTS));
  const find = (id: string): CompiledRequirement => {
    const r = reqs().find((x) => x.id === id);
    if (r === undefined) throw new Error(`no requirement ${id}`);
    return r;
  };
  const trial = o.trial ?? ((req, spec) => tinyTrial(req, spec).result);

  const deps: KitDeps = {
    fs,
    now: () => clock.now(),
    clock: () => clock.mono(),
    packRoot: PACK_ROOT,
    async loadApp() { spies.loadApp++; return app; },
    compileFile: compileRequirementsFile,
    compileLine: compileRequirement,
    falsify: (async (...args: Parameters<KitDeps['falsify']>) => {
      spies.falsify++;
      return (o.falsifyImpl ?? falsify)(...args);
    }) as KitDeps['falsify'],
    createSeedDatabase: (root) => createSeedDatabase(asFileSystem(fs), root),
    pinCounterexample,
    async createPool(): Promise<TrialPool> {
      spies.createPool++;
      if (o.poolError !== undefined) throw o.poolError;
      let closed = false;
      return {
        size: 2,
        async run(specs, onResult, opts) {
          spies.poolRun++;
          const out: TrialResult[] = [];
          for (const spec of specs) {
            if (opts?.signal?.aborted === true) throw new AbortError();
            spies.poolSpecs.push(spec);
            const r = trial(find(spec.reqId), spec);
            out.push(r);
            await onResult?.(r);
          }
          return out;
        },
        async close() { if (!closed) { closed = true; spies.poolClose++; } },
      };
    },
    async runTraced(a, req, spec): Promise<TracedRun> {
      spies.runTraced++;
      if (o.traceError !== undefined) throw o.traceError;
      void a;
      return tinyTrial(req, spec);
    },
    async gitCommit() { return o.commit; },
  };
  return { deps, fs, spies, clock };
}

export { TraceUnavailableError, tinyLexicon };

// ---------------------------------------------------------------- fake kiro-cli runner

export interface RunnerResult { code: number; stdout: string; stderr: string }
export type KiroRunner = (cmd: string, args: readonly string[], files?: FakeKiroFiles) => Promise<RunnerResult | 'missing'>;
export type FakeKiroFiles = Map<string, string>;

export interface FakeKiro {
  /** The files the fake `kiro-cli` sees (path to text). Shared with `buildPack` through `readFile` and `writeFile`. */
  files: FakeKiroFiles;
  calls: string[][];
  run: (cmd: string, args: readonly string[]) => Promise<RunnerResult | 'missing'>;
  /** Next `agent upgrade` or `agent validate` exits with this code and stderr. */
  failNext(kind: 'upgrade' | 'validate', code: number, stderr: string): void;
  missing: boolean;
}

/**
 * Models the behaviour verified on kiro-cli 3.5.0: `agent upgrade <dir>` adds `permissions` and `kiroUpgrade` to a
 * V2 file, reports a file that already has them as skipped and leaves its bytes unchanged, `agent validate --path`
 * exits 0 on a file with `permissions`.
 */
export function createFakeKiro(files: FakeKiroFiles = new Map()): FakeKiro {
  const fails: { kind: string; code: number; stderr: string }[] = [];
  const k: FakeKiro = {
    files, calls: [], missing: false,
    failNext: (kind, code, stderr) => { fails.push({ kind, code, stderr }); },
    async run(cmd, args) {
      k.calls.push([cmd, ...args]);
      if (k.missing || cmd !== 'kiro-cli') return 'missing';
      const [group, action] = args;
      if (group !== 'agent') return { code: 2, stdout: '', stderr: `unknown command ${String(group)}` };
      const f = fails.findIndex((x) => x.kind === action);
      if (f >= 0) { const [x] = fails.splice(f, 1); const y = x as (typeof fails)[number]; return { code: y.code, stdout: '', stderr: y.stderr }; }
      if (action === 'upgrade') {
        const dir = (args[2] ?? '').replace(/\\/g, '/');
        const lines: string[] = [];
        for (const [p, text] of [...files]) {
          if (!p.startsWith(`${dir}/`) || p.slice(dir.length + 1).includes('/') || !p.endsWith('.json')) continue;
          if (text.charCodeAt(0) === 0xfeff) return { code: 1, stdout: '', stderr: `${p}: Invalid JSON: expected value at line 1 column 1` };
          const j = JSON.parse(text) as Record<string, unknown>;
          if (j['permissions'] !== undefined || j['kiroUpgrade'] !== undefined) {
            lines.push(`skipped ${p}: out of sync (not rebuilt)`);
            continue;
          }
          files.set(p, `${JSON.stringify(fakeUpgrade(j), null, 2)}\n`);
          lines.push(`upgraded ${p}`);
        }
        return { code: 0, stdout: lines.join('\n'), stderr: '' };
      }
      if (action === 'validate') {
        const i = args.indexOf('--path');
        if (i < 0) return { code: 2, stdout: '', stderr: 'unexpected positional argument; use --path' };
        const p = (args[i + 1] ?? '').replace(/\\/g, '/');
        const text = files.get(p);
        if (text === undefined) return { code: 1, stdout: '', stderr: `${p}: not found` };
        const j = JSON.parse(text) as Record<string, unknown>;
        return j['permissions'] === undefined
          ? { code: 1, stdout: '', stderr: `${p}: not a universal agent file` }
          : { code: 0, stdout: 'valid', stderr: '' };
      }
      return { code: 2, stdout: '', stderr: `unknown action ${String(action)}` };
    },
  };
  return k;
}

interface V2Hook { matcher?: string; command: string; timeout_ms?: number }

/** A small model of the upgrade: write allow/deny rules from `toolsSettings`, array-form hooks, marker. */
export function fakeUpgrade(j: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...j };
  const rules: Record<string, unknown>[] = [];
  const ts = (j['toolsSettings'] ?? {}) as { write?: { allowedPaths?: string[]; deniedPaths?: string[] } };
  if (ts.write?.allowedPaths !== undefined) rules.push({ capability: 'fs_write', match: ts.write.allowedPaths, effect: 'allow' });
  if (ts.write?.deniedPaths !== undefined) rules.push({ capability: 'fs_write', match: ts.write.deniedPaths, effect: 'deny' });
  for (const t of (j['allowedTools'] as string[] | undefined) ?? []) {
    if (t === 'read') rules.push({ capability: 'fs_read', effect: 'allow' });
    else if (t.startsWith('@')) rules.push({ capability: 'mcp', match: [t.slice(1)], effect: 'allow' });
  }
  out['permissions'] = { rules };
  const hooks = j['hooks'] as Record<string, V2Hook[]> | undefined;
  if (hooks !== undefined && !Array.isArray(hooks)) {
    const arr: Record<string, unknown>[] = [];
    for (const [trigger, list] of Object.entries(hooks)) {
      list.forEach((h, i) => {
        const e: Record<string, unknown> = { name: `${trigger}-${i}`, trigger };
        if (h.matcher !== undefined) e['matcher'] = h.matcher === 'fs_write' ? 'write' : h.matcher;
        e['action'] = { type: 'command', command: h.command };
        if (h.timeout_ms !== undefined) e['timeout'] = Math.ceil(h.timeout_ms / 1000);
        arr.push(e);
      });
    }
    out['hooks'] = arr;
  }
  if (Array.isArray(j['tools'])) out['tools'] = [...(j['tools'] as string[])].sort();
  out['kiroUpgrade'] = { revision: 1, fingerprint: 'fake', source: 'v2' };
  return out;
}
