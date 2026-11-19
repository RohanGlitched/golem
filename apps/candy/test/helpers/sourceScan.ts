// Source hygiene scan: import paths into the skeleton, and clock or random reads in the app.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const SPECIFIER = /(?:\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?|\bexport\s+(?:type\s+)?[\w*{}\s,$]*\s+from\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;

/** Every module specifier in `source` (static, re-export, dynamic import and require). */
export function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(SPECIFIER)) out.push(m[2]!);
  return out;
}

export const PUBLIC_ENTRIES = ['golem-spec', 'golem-spec/ui', 'golem-spec/node'];

/** The specifiers that contain `skeleton/src`. */
export function deepImports(source: string): string[] {
  return importSpecifiers(source).filter((s) => s.replace(/\\/g, '/').includes('skeleton/src'));
}

/** Specifiers that reach the skeleton through anything but a public entry point: `golem-spec/<other>` or a relative path to skeleton/. */
export function badSkeletonImports(source: string): string[] {
  return importSpecifiers(source).filter((s) => {
    const p = s.replace(/\\/g, '/');
    if (p.includes('skeleton/')) return true;
    return p.startsWith('golem-spec') && !PUBLIC_ENTRIES.includes(p);
  });
}

const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** True when the code (comments removed) calls Math.random. */
export function usesRandom(source: string): boolean { return /\bMath\s*\.\s*random\b/.test(strip(source)); }
/** True when the code (comments removed) reads a wall clock. */
export function usesClock(source: string): boolean { return /\b(Date\s*\.\s*now|performance\s*\.\s*now|new\s+Date\b)/.test(strip(source)); }

/** Files under `dir` (relative to the app) with one of the extensions, skipping generated and dependency folders. */
export function files(dir: string, exts: string[], skip: string[] = ['node_modules', 'robot', 'test', '.kiro', 'dist', 'coverage']): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (skip.includes(name)) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (exts.some((e) => name.endsWith(e))) out.push(p);
    }
  };
  walk(join(APP_ROOT, dir));
  return out.sort();
}

export const read = (p: string): string => readFileSync(p, 'utf8');
export const rel = (p: string): string => relative(APP_ROOT, p).replace(/\\/g, '/');
