// Build-time readers for repository files that the kit and how-kiro pages describe. A missing or malformed file stops the build with its path.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, SiteDataError, parseJson } from './data';

export function readRepoText(rel: string): string {
  const p = path.join(REPO_ROOT, rel);
  if (!existsSync(p)) throw new SiteDataError(rel, 'file not found');
  return readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
}

export function readRepoJson<T>(rel: string): T {
  return parseJson<T>(readRepoText(rel), rel);
}

export function listRepoFiles(rel: string, ext: string): string[] {
  const p = path.join(REPO_ROOT, rel);
  return existsSync(p) ? readdirSync(p).filter((f) => f.endsWith(ext)).sort() : [];
}

/** `key: value` pairs of a Markdown front matter block. Values are single-line. */
export function frontMatter(md: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of (m[1] as string).split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1] as string] = (kv[2] as string).replace(/^"(.*)"$/, '$1');
  }
  return out;
}

export interface HookDef { name: string; description?: string; trigger: string; matcher?: string; action: { type: string; command: string }; timeout?: number }
export interface HookFile { hooks: HookDef[] }
