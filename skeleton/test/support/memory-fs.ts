// In-memory KitFs for tests: ENOENT as `error.code`, rename, realpath, symlinks, and failure injection.
import type { KitFs } from '../../src/cli/deps.js';
import { dirname, normalize, resolve } from '../../src/cli/paths.js';

export interface MemoryKitFs extends KitFs {
  /** Raw files by normalised path. */
  readonly files: Map<string, Uint8Array>;
  readonly dirs: Set<string>;
  readonly symlinks: Map<string, string>;
  /** Every mutating call, in order: `write <path>`, `rename <a> <b>`, `remove <path>`, `mkdir <path>`. */
  readonly log: string[];
  put(path: string, data: string | Uint8Array): void;
  text(path: string): string | undefined;
  symlink(path: string, target: string): void;
  /** Makes the next matching call fail once with `error`. */
  failOn(kind: 'write' | 'rename' | 'remove', match: RegExp | string, error?: Error): void;
  /** All file paths, sorted. */
  list(): string[];
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function enoent(op: string, p: string): Error {
  const e = new Error(`ENOENT: no such file or directory, ${op} '${p}'`) as Error & { code: string };
  e.code = 'ENOENT';
  return e;
}

export function createMemoryFs(initial: Record<string, string | Uint8Array> = {}): MemoryKitFs {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(['/']);
  const symlinks = new Map<string, string>();
  const log: string[] = [];
  const failures: { kind: string; match: RegExp | string; error: Error }[] = [];

  const hit = (kind: string, subject: string): void => {
    const i = failures.findIndex((f) => f.kind === kind
      && (typeof f.match === 'string' ? subject.includes(f.match) : f.match.test(subject)));
    if (i >= 0) {
      const [f] = failures.splice(i, 1);
      throw (f as (typeof failures)[number]).error;
    }
  };

  /** Resolves symlinks in every segment of the path (up to 16 hops). */
  const real = (p: string): string => {
    let cur = normalize(p);
    for (let hop = 0; hop < 16; hop++) {
      const segs = cur.split('/');
      let changed = false;
      let acc = '';
      for (let i = 1; i < segs.length; i++) {
        acc += `/${segs[i]}`;
        const t = symlinks.get(acc);
        if (t !== undefined) {
          cur = normalize(`${resolve(dirname(acc), t)}/${segs.slice(i + 1).join('/')}`);
          changed = true;
          break;
        }
      }
      if (!changed) return cur;
    }
    throw new Error(`ELOOP: too many symbolic links, '${p}'`);
  };

  const mkdirs = (p: string): void => {
    let cur = normalize(p);
    while (cur !== '/' && cur !== '.' && !dirs.has(cur)) {
      dirs.add(cur);
      cur = dirname(cur);
    }
  };

  const fs: MemoryKitFs = {
    files, dirs, symlinks, log,
    async readFile(p) {
      const b = files.get(real(p));
      if (b === undefined) throw enoent('open', p);
      return dec.decode(b);
    },
    async readBytes(p) {
      const b = files.get(real(p));
      if (b === undefined) throw enoent('open', p);
      return b.slice();
    },
    async writeFile(p, data) {
      const rp = real(p);
      hit('write', rp);
      if (!dirs.has(dirname(rp))) throw enoent('open', p);
      log.push(`write ${rp}`);
      files.set(rp, typeof data === 'string' ? enc.encode(data) : data.slice());
    },
    async rename(a, b) {
      const ra = real(a);
      const rb = real(b);
      hit('rename', `${ra} ${rb}`);
      const v = files.get(ra);
      if (v === undefined) throw enoent('rename', a);
      log.push(`rename ${ra} ${rb}`);
      files.delete(ra);
      files.set(rb, v);
    },
    async mkdir(p) {
      log.push(`mkdir ${real(p)}`);
      mkdirs(real(p));
    },
    async remove(p) {
      const rp = real(p);
      hit('remove', rp);
      log.push(`remove ${rp}`);
      files.delete(rp);
    },
    async realpath(p) {
      const rp = real(p);
      if (!files.has(rp) && !dirs.has(rp)) throw enoent('realpath', p);
      return rp;
    },
    async readdir(p) {
      const rp = real(p);
      if (!dirs.has(rp)) throw enoent('scandir', p);
      const prefix = rp === '/' ? '/' : `${rp}/`;
      const names = new Set<string>();
      for (const f of [...files.keys(), ...dirs]) {
        if (f !== rp && f.startsWith(prefix)) names.add(f.slice(prefix.length).split('/')[0] as string);
      }
      return [...names].sort();
    },
    async stat(p) {
      const rp = real(p);
      if (files.has(rp)) return { isFile: true, isDirectory: false };
      if (dirs.has(rp)) return { isFile: false, isDirectory: true };
      throw enoent('stat', p);
    },
    put(path, data) {
      const rp = real(path);
      mkdirs(dirname(rp));
      files.set(rp, typeof data === 'string' ? enc.encode(data) : data.slice());
    },
    text(path) {
      const b = files.get(real(path));
      return b === undefined ? undefined : dec.decode(b);
    },
    symlink(path, target) {
      mkdirs(dirname(normalize(path)));
      symlinks.set(normalize(path), target);
    },
    failOn(kind, match, error = new Error(`injected ${kind} failure`)) {
      failures.push({ kind, match, error });
    },
    list: () => [...files.keys()].sort(),
  };
  for (const [p, d] of Object.entries(initial)) fs.put(p, d);
  return fs;
}
