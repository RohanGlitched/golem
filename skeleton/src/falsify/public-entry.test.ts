// Smoke tests for the public entry points, the import graph and engine-code hygiene.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skeleton = resolve(src, '..');

/** Source text with comments removed (string contents are kept). */
function code(path: string): string {
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function specifiers(path: string): string[] {
  const text = code(path);
  const out: string[] = [];
  for (const re of [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s+['"]([^'"]+)['"]/g, /\bimport\(\s*(?:\/\*.*?\*\/\s*)?['"]([^'"]+)['"]\s*\)/g]) {
    for (const m of text.matchAll(re)) out.push(m[1] as string);
  }
  return out;
}

/** Every module reachable from `entry` through static and literal dynamic imports. */
function importGraph(entry: string): { files: string[]; external: string[] } {
  const seen = new Set<string>();
  const external = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const f = stack.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const s of specifiers(f)) {
      if (!s.startsWith('.')) { external.add(s); continue; }
      const base = resolve(dirname(f), s);
      const cand = [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.mjs'), base, `${base}.ts`, join(base, 'index.ts')].find((p) => existsSync(p) && !p.endsWith('\\') && /\.(ts|mjs|js)$/.test(p));
      if (cand === undefined) throw new Error(`cannot resolve ${s} from ${f}`);
      stack.push(cand);
    }
  }
  return { files: [...seen], external: [...external] };
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}

describe('public entry points', () => {
  it('keeps node: modules out of the falsify import graph and the golem-spec entry', () => {
    for (const entry of [join(src, 'falsify', 'index.ts'), join(src, 'index.ts')]) {
      const g = importGraph(entry);
      expect(g.external.filter((s) => s.startsWith('node:') || ['fs', 'path', 'os', 'worker_threads', 'child_process'].includes(s))).toEqual([]);
      expect(g.files.some((f) => f.endsWith(join('pool', 'node.ts')) || f.endsWith(join('pool', 'node-fs.ts')))).toBe(false);
    }
    // The walker does see Node modules where they are expected.
    const nodeGraph = importGraph(join(src, 'node.ts'));
    expect(nodeGraph.external).toContain('node:worker_threads');
    expect(nodeGraph.external).toContain('node:fs/promises');
    expect(importGraph(join(src, 'index.ts')).files.length).toBeGreaterThan(30);
  });

  it('exports everything an app needs from golem-spec and golem-spec/node, so no deep import is required', async () => {
    const main = (await import('../index.js')) as Record<string, unknown>;
    for (const name of [
      'falsify', 'latinHypercube', 'shrink', 'createSeedDatabase', 'pinCounterexample', 'memoryFileSystem', 'replayCounterexample',
      'InProcessPool', 'createBrowserPool', 'TrialScheduler',
      'AbortError', 'PoolClosedError', 'CancelledError', 'TrialError', 'TrialCrashError', 'RestartLimitError', 'LoadError', 'SeedDbError',
    ]) expect(typeof main[name], name).toBe('function');
    expect(main['createNodePool']).toBeUndefined();
    expect(main['nodeFileSystem']).toBeUndefined();
    const node = (await import('../node.js')) as Record<string, unknown>;
    expect(typeof node['createNodePool']).toBe('function');
    expect(typeof node['nodeFileSystem']).toBe('function');
    expect(typeof node['physicalCoreCount']).toBe('function');
    const testing = (await import('../testing.js')) as Record<string, unknown>;
    for (const name of ['directPool', 'makeSynthetic', 'syntheticTrialFn', 'fakeWorkerFactory', 'FakeTimers']) expect(typeof testing[name], name).toBe('function');
    expect(main['directPool']).toBeUndefined();
    expect(main['fakeWorkerFactory']).toBeUndefined();
    // cold dynamic import of every entry (MCP SDK included): under a full parallel run this took over 5 s
  }, 30000);

  it('maps every package export to a source entry', () => {
    const pkg = JSON.parse(readFileSync(join(skeleton, 'package.json'), 'utf8')) as { exports: Record<string, { default: string }> };
    for (const [key, target] of Object.entries(pkg.exports)) {
      const source = join(src, target.default.replace(/^\.\/dist\//, '').replace(/\.js$/, '.ts'));
      expect(existsSync(source), `${key} -> ${source}`).toBe(true);
    }
  });

  it('lists only dependencies named in tech.md', () => {
    const pkg = JSON.parse(readFileSync(join(skeleton, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>; peerDependencies?: Record<string, string>;
    };
    const tech = readFileSync(join(skeleton, '..', '.kiro', 'steering', 'tech.md'), 'utf8');
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['@modelcontextprotocol/sdk', '@mujoco/mujoco']);
    for (const dep of [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]) {
      const name = dep === 'react-dom' ? 'React' : dep;
      expect(tech.toLowerCase().includes(name.toLowerCase()), dep).toBe(true);
    }
  });

  it('never calls Math.random in falsify or pool engine code', () => {
    const engine = [...walk(join(src, 'falsify')), ...walk(join(src, 'pool'))]
      .filter((f) => /\.(ts|mjs)$/.test(f) && !/\.test\.ts$|testkit\.ts$|[\\/]testing\.ts$|\.arb\.ts$/.test(f));
    expect(engine.length).toBeGreaterThan(10);
    const offenders = engine.filter((f) => /Math\s*\.\s*random/.test(code(f)));
    expect(offenders).toEqual([]);
  });
});
