// Append-only JSONL with sorted keys. Pure helpers plus two small fs functions.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json | undefined };

/** JSON with object keys sorted at every level, so equal records give equal bytes. */
export function stableStringify(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => [k, sortKeys(o[k])]));
  }
  return v;
}

/** Parses JSONL text. A final line without a newline that does not parse (a crash mid-write) is ignored. */
export function parseJsonl<T = Record<string, Json>>(text: string): T[] {
  const lines = text.split('\n');
  const out: T[] = [];
  lines.forEach((line, i) => {
    if (line.trim() === '') return;
    try {
      out.push(JSON.parse(line) as T);
    } catch (e) {
      if (i !== lines.length - 1) throw new Error(`bad JSON on line ${i + 1}: ${(e as Error).message}`);
    }
  });
  return out;
}

export function readJsonl<T = Record<string, Json>>(path: string): T[] {
  return existsSync(path) ? parseJsonl<T>(readFileSync(path, 'utf8')) : [];
}

export function appendJsonl(path: string, rec: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${stableStringify(rec)}\n`);
}

/** The keys not yet done, in plan order. Running a plan twice therefore appends nothing the second time. */
export function remaining<K>(plan: readonly K[], key: (k: K) => string, done: ReadonlySet<string>): K[] {
  return plan.filter((k) => !done.has(key(k)));
}