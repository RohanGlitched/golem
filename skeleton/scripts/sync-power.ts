// Copies the skills, the steering file and the finalized agents from `kiro-pack/` into `power/` and `crew-app/`.
// `--check` changes nothing: it exits 1 and lists every path that differs by one byte (requirements 25.7 and 26.7).
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Tree = Map<string, Uint8Array>;

export function readTree(dir: string): Tree {
  const out: Tree = new Map();
  const walk = (d: string): void => {
    let names: string[];
    try { names = readdirSync(d).sort(); } catch { return; }
    for (const n of names) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(dir, p).replace(/\\/g, '/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(dir);
  return out;
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Paths that are missing from `dst`, extra in `dst`, or differ in at least one byte. */
export function diffTrees(src: Tree, dst: Tree): string[] {
  const out: string[] = [];
  for (const [p, b] of src) { const o = dst.get(p); if (o === undefined) out.push(`${p} (missing)`); else if (!same(b, o)) out.push(`${p} (differs)`); }
  for (const p of dst.keys()) if (!src.has(p)) out.push(`${p} (extra)`);
  return out.sort();
}

export interface SyncDirs { pack: string; power: string; crew: string; rootLicense: string }

/** Every (source tree, destination directory, label) pair the sync maintains. */
function plan(d: SyncDirs): { label: string; src: Tree; dir: string }[] {
  const skills = readTree(join(d.pack, 'skills'));
  const steering = new Map([...readTree(join(d.pack, 'steering'))].filter(([p]) => p === 'golem-ears.md'));
  const agents = new Map([...readTree(join(d.pack, 'agents'))].filter(([p]) => p.endsWith('.json')));
  return [
    { label: 'power/skills', src: skills, dir: join(d.power, 'skills') },
    { label: 'power/steering', src: steering, dir: join(d.power, 'steering') },
    { label: 'crew-app/skills', src: skills, dir: join(d.crew, 'skills') },
    { label: 'crew-app/agents', src: agents, dir: join(d.crew, 'agents') },
  ];
}

/** The differing paths, prefixed with their tree. Empty when everything is in sync. */
export function checkSync(d: SyncDirs): string[] {
  const out: string[] = [];
  for (const { label, src, dir } of plan(d)) for (const x of diffTrees(src, readTree(dir))) out.push(`${label}/${x}`);
  try {
    if (!same(new Uint8Array(readFileSync(join(d.power, 'LICENSE'))), new Uint8Array(readFileSync(d.rootLicense)))) out.push('power/LICENSE (differs from the repository LICENSE)');
  } catch { out.push('power/LICENSE (missing)'); }
  return out;
}

export function writeSync(d: SyncDirs): string[] {
  const written: string[] = [];
  for (const { label, src, dir } of plan(d)) {
    for (const [p, b] of src) {
      const target = join(dir, p);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, b);
      written.push(`${label}/${p}`);
    }
  }
  return written;
}

/** Runs the script. Returns the exit code. */
export function runSync(argv: readonly string[], d: SyncDirs, log: (s: string) => void = console.log): number {
  if (argv.includes('--check')) {
    const diff = checkSync(d);
    for (const x of diff) log(`differs: ${x}`);
    if (diff.length > 0) return 1;
    log('power and crew-app are in sync with kiro-pack');
    return 0;
  }
  const w = writeSync(d);
  log(`synced ${w.length} files`);
  return 0;
}

const here = dirname(fileURLToPath(import.meta.url));
const defaults: SyncDirs = { pack: join(here, '..', 'kiro-pack'), power: join(here, '..', 'power'), crew: join(here, '..', 'crew-app'), rootLicense: join(here, '..', '..', 'LICENSE') };

// vite-node hides the script from argv, so `npm run pack:sync` and `pack:check` are recognised by their lifecycle event.
const event = process.env['npm_lifecycle_event'];
if (process.env['VITEST'] === undefined && (event === 'pack:sync' || event === 'pack:check' || process.argv.slice(1).some((a) => /sync-power\.[tj]s$/.test(a)))) {
  process.exitCode = runSync(event === 'pack:check' ? ['--check'] : process.argv.slice(2), defaults);
}
