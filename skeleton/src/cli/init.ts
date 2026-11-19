// `golem init`: compute a WritePlan (read-only), then execute it (design D8). Every write is temp file plus rename.
import { formatConfig } from './config.js';
import type { KitFs } from './deps.js';
import { basename, dirname, isInside, normalize, resolve } from './paths.js';
import { atomicWriteFile, tmpCounter } from './store.js';

export interface PackManifest { files: { rel: string; sha256: string; kind: 'copy' | 'merge-mcp' }[] }
export type PlanAction = 'write' | 'skip' | 'merge';
export interface PlanEntry { rel: string; target: string; kind: 'copy' | 'merge-mcp' | 'config'; action: PlanAction; reason?: string }
export interface WritePlan { targetDir: string; entries: PlanEntry[] }

export class PackError extends Error {
  override name = 'PackError';
}
export class InitError extends Error {
  override name = 'InitError';
}

export const CONFIG_PLACEHOLDER = { app: './app.js', requirements: ['.kiro/specs/robot/requirements.md'] };
const MCP_REL = 'settings/mcp.json';

/** Reads `<packRoot>/manifest.json`. Any failure names the pack path (requirement 9.15). */
export async function readManifest(fs: KitFs, packRoot: string): Promise<PackManifest> {
  try {
    const m = JSON.parse(await fs.readFile(`${packRoot}/manifest.json`)) as PackManifest;
    if (!Array.isArray(m.files) || !m.files.every((f) => typeof f.rel === 'string' && (f.kind === 'copy' || f.kind === 'merge-mcp'))) {
      throw new Error('manifest.json has no valid files list');
    }
    return m;
  } catch (e) {
    throw new PackError(`the Kiro pack at ${packRoot} cannot be read: ${(e as Error).message}`);
  }
}

/** True when `candidate` is `target` or below it. Both are real paths. */
export const containedIn = (realTarget: string, realCandidate: string): boolean => isInside(realTarget, realCandidate);

/** Resolves symlinks through the nearest existing ancestor and appends the segments that do not exist yet. */
async function realLocation(fs: KitFs, path: string): Promise<string> {
  const tail: string[] = [];
  let cur = normalize(path);
  for (;;) {
    try {
      const real = await fs.realpath(cur);
      return normalize([real, ...tail.reverse()].join('/'));
    } catch (e) {
      if ((e as { code?: string }).code !== 'ENOENT') throw e;
      const up = dirname(cur);
      if (up === cur) return normalize(path);
      tail.push(basename(cur));
      cur = up;
    }
  }
}

async function exists(fs: KitFs, p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return false;
    throw e;
  }
}

/** Read-only. A target outside the target directory (`..`, absolute path, symlink) fails the whole plan. */
export async function buildPlan(fs: KitFs, targetDir: string, m: PackManifest, o: { force: boolean }): Promise<WritePlan> {
  const realTarget = await realLocation(fs, targetDir);
  const entries: PlanEntry[] = [];
  const consider = async (rel: string, target: string, kind: PlanEntry['kind']): Promise<void> => {
    const real = await realLocation(fs, target);
    if (!containedIn(realTarget, real)) throw new InitError(`refusing to write ${target}: it resolves to ${real}, outside ${realTarget}`);
    const present = await exists(fs, target);
    let action: PlanAction;
    if (!present) action = 'write';
    else if (kind === 'merge-mcp') action = 'merge';
    else action = o.force ? 'write' : 'skip';
    entries.push({ rel, target, kind, action, ...(action === 'skip' ? { reason: 'exists' } : {}) });
  };
  for (const f of m.files) await consider(f.rel, resolve(`${targetDir}/.kiro`, f.rel), f.kind);
  await consider('golem.config.json', `${targetDir}/golem.config.json`, 'config');
  return { targetDir, entries };
}

/** The `golem` entry is the only one init touches (assumptions A9, A10). Throws on invalid existing JSON. */
export function mergeMcpSettings(existing: string | undefined, template: string, force: boolean): { text: string; outcome: 'created' | 'added' | 'kept' | 'replaced' } {
  if (existing === undefined) return { text: template, outcome: 'created' };
  const tpl = JSON.parse(template) as { mcpServers: Record<string, unknown> };
  let cur: unknown;
  try {
    cur = JSON.parse(existing);
  } catch (e) {
    throw new InitError(`.kiro/settings/mcp.json is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) throw new InitError('.kiro/settings/mcp.json must hold a JSON object');
  const obj = cur as Record<string, unknown>;
  const servers = obj['mcpServers'];
  if (servers !== undefined && (typeof servers !== 'object' || servers === null || Array.isArray(servers))) {
    throw new InitError('.kiro/settings/mcp.json: "mcpServers" must be an object');
  }
  const has = servers !== undefined && Object.prototype.hasOwnProperty.call(servers, 'golem');
  if (has && !force) return { text: existing, outcome: 'kept' };
  const merged = { ...obj, mcpServers: { ...(servers as Record<string, unknown> | undefined), golem: tpl.mcpServers['golem'] } };
  return { text: `${JSON.stringify(merged, null, 2)}\n`, outcome: has ? 'replaced' : 'added' };
}

const shown = (plan: WritePlan, e: PlanEntry): string => (e.target.startsWith(`${plan.targetDir}/`) ? e.target.slice(plan.targetDir.length + 1) : e.target);

/**
 * Reads every pack file first, so an unreadable pack writes nothing. Then writes in manifest order and stops at the
 * first failure (the old file stays, the temp file is removed, the failing path is named).
 */
export async function executePlan(fs: KitFs, plan: WritePlan, packRoot: string, o: { force: boolean }, say: (line: string) => void): Promise<void> {
  const payload = new Map<PlanEntry, string | Uint8Array>();
  const notes = new Map<PlanEntry, string>();
  for (const e of plan.entries) {
    if (e.action === 'skip') continue;
    if (e.kind === 'config') { payload.set(e, formatConfig(CONFIG_PLACEHOLDER)); continue; }
    let bytes: Uint8Array;
    try {
      bytes = await fs.readBytes(`${packRoot}/${e.rel}`);
    } catch (err) {
      throw new PackError(`the Kiro pack at ${packRoot} cannot be read: ${e.rel}: ${(err as Error).message}`);
    }
    if (e.action === 'merge') {
      const r = mergeMcpSettings(await fs.readFile(e.target), new TextDecoder().decode(bytes), o.force);
      notes.set(e, r.outcome);
      if (r.outcome === 'kept') continue;
      payload.set(e, r.text);
    } else {
      payload.set(e, bytes);
    }
  }
  const nextTmp = tmpCounter();
  for (const e of plan.entries) {
    const data = payload.get(e);
    if (data === undefined) {
      say(`skipped ${shown(plan, e)} (exists)`);
      continue;
    }
    try {
      await atomicWriteFile(fs, e.target, data, nextTmp);
    } catch (err) {
      throw new InitError(`cannot write ${e.target}: ${(err as Error).message}`);
    }
    if (e.action === 'merge') say(`merged ${shown(plan, e)}: golem entry ${notes.get(e) ?? 'added'}`);
    else say(`wrote ${shown(plan, e)}`);
  }
}
