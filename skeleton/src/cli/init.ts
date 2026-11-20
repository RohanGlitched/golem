// `golem init`: compute a WritePlan (read-only), then execute it (design D8). Every write is temp file plus rename.
import { formatConfig, parseConfig, type GolemConfig } from './config.js';
import type { KitFs } from './deps.js';
import { basename, dirname, isInside, normalize, resolve } from './paths.js';
import { atomicWriteFile, tmpCounter } from './store.js';

export interface PackManifest { files: { rel: string; sha256: string; kind: 'copy' | 'merge-mcp' }[] }
export type PlanAction = 'write' | 'skip' | 'merge';
export interface PlanEntry {
  rel: string; target: string; kind: 'copy' | 'merge-mcp' | 'config' | 'starter'; action: PlanAction; reason?: string;
  /** `starter` entries: the file's path under the starter root. */
  src?: string;
  /** `config` entries: which config text to write. */
  config?: 'placeholder' | 'starter';
  /** Printed after the path: `wrote app.js (starter cart-pole robot)`. */
  note?: string;
}
export interface WritePlan {
  targetDir: string;
  entries: PlanEntry[];
  /** Present when the starter robot was asked for: its root, and why it is not written (when it is not). */
  starter?: { root: string; skipped?: string };
}

export class PackError extends Error {
  override name = 'PackError';
}
export class InitError extends Error {
  override name = 'InitError';
}

export const CONFIG_PLACEHOLDER = { app: './app.js', requirements: ['.kiro/specs/robot/requirements.md'] };
const MCP_REL = 'settings/mcp.json';

/** The starter cart-pole robot: files under `<package>/starter/` and where each goes in the project. */
export const STARTER_FILES: readonly { src: string; dest: string }[] = [
  { src: 'app.js', dest: 'app.js' },
  { src: 'robot/scene.xml', dest: 'robot/scene.xml' },
  { src: 'requirements.md', dest: '.kiro/specs/cartpole/requirements.md' },
  { src: 'README.md', dest: 'README.md' },
  { src: 'controller.py', dest: 'controller.py' },
  { src: 'golem_bridge.py', dest: 'golem_bridge.py' },
];
/** The README may already be the project's own; every other starter file makes the starter stand down when it exists. */
const STARTER_OPTIONAL = 'README.md';
export const STARTER_CONFIG: GolemConfig = {
  app: './app.js',
  requirements: ['.kiro/specs/cartpole/requirements.md'],
  robot: 'cartpole',
  signalUnits: { pole_angle: 'rad', cart_x: 'm' },
};
export const STARTER_NOTE = 'starter cart-pole robot';

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

/** The text of golem.config.json, or undefined when there is none. */
async function readConfigText(fs: KitFs, targetDir: string): Promise<string | undefined> {
  try {
    return await fs.readFile(`${targetDir}/golem.config.json`);
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return undefined;
    throw e;
  }
}

/** True when the config parses and its `app` file exists: the project already has a robot. */
async function namesExistingApp(fs: KitFs, targetDir: string, text: string): Promise<boolean> {
  try {
    return await exists(fs, resolve(targetDir, parseConfig(text, 'golem.config.json').app));
  } catch (e) {
    if ((e as { name?: string }).name === 'ConfigError') return false;
    throw e;
  }
}

/** Why the starter robot must not be written here, or undefined when it may be. Never touches anything. */
async function starterBlocker(fs: KitFs, targetDir: string, configText: string | undefined): Promise<string | undefined> {
  // An absent config, or the empty placeholder an earlier `golem init` wrote, leaves room for the starter.
  if (configText !== undefined && configText !== formatConfig(CONFIG_PLACEHOLDER)) {
    return (await namesExistingApp(fs, targetDir, configText)) ? 'golem.config.json names an app that exists' : 'golem.config.json exists';
  }
  for (const f of STARTER_FILES) {
    if (f.dest !== STARTER_OPTIONAL && (await exists(fs, resolve(targetDir, f.dest)))) return `${f.dest} exists`;
  }
  if (await exists(fs, resolve(targetDir, 'robot'))) return 'robot/ exists';
  return undefined;
}

/**
 * Read-only. A target outside the target directory (`..`, absolute path, symlink) fails the whole plan.
 * `o.starterRoot` asks for the starter robot; `force` never applies to it.
 */
export async function buildPlan(fs: KitFs, targetDir: string, m: PackManifest, o: { force: boolean; starterRoot?: string }): Promise<WritePlan> {
  const realTarget = await realLocation(fs, targetDir);
  const entries: PlanEntry[] = [];
  const consider = async (rel: string, target: string, kind: PlanEntry['kind'], extra: Partial<PlanEntry> = {}): Promise<PlanEntry> => {
    const real = await realLocation(fs, target);
    if (!containedIn(realTarget, real)) throw new InitError(`refusing to write ${target}: it resolves to ${real}, outside ${realTarget}`);
    const present = await exists(fs, target);
    let action: PlanAction;
    if (!present) action = 'write';
    else if (kind === 'merge-mcp') action = 'merge';
    else action = o.force && kind !== 'starter' ? 'write' : 'skip';
    const entry: PlanEntry = { rel, target, kind, action, ...extra, ...(action === 'skip' ? { reason: 'exists' } : {}) };
    entries.push(entry);
    return entry;
  };
  for (const f of m.files) await consider(f.rel, resolve(`${targetDir}/.kiro`, f.rel), f.kind);

  const configText = await readConfigText(fs, targetDir);
  let starter: WritePlan['starter'];
  if (o.starterRoot !== undefined) {
    const why = await starterBlocker(fs, targetDir, configText);
    starter = why === undefined ? { root: o.starterRoot } : { root: o.starterRoot, skipped: why };
    if (why === undefined) {
      for (const f of STARTER_FILES) {
        await consider(f.dest, resolve(targetDir, f.dest), 'starter', { src: f.src, ...(f.dest === 'app.js' ? { note: STARTER_NOTE } : {}) });
      }
    }
  }

  const config = await consider('golem.config.json', `${targetDir}/golem.config.json`, 'config');
  if (starter !== undefined && starter.skipped === undefined) {
    // No config, or the empty placeholder of an earlier init: the starter's config replaces it.
    config.config = 'starter';
    if (configText !== undefined) { config.action = 'write'; delete config.reason; config.note = 'replaced the empty placeholder'; }
  } else if (config.action === 'write' && configText !== undefined && (await namesExistingApp(fs, targetDir, configText))) {
    // `--force` refreshes the pack; it never throws away a config that points at a working app.
    config.action = 'skip';
    config.reason = 'names an app that exists';
  }
  return { targetDir, entries, ...(starter !== undefined ? { starter } : {}) };
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
    if (e.kind === 'config') { payload.set(e, formatConfig(e.config === 'starter' ? STARTER_CONFIG : CONFIG_PLACEHOLDER)); continue; }
    if (e.kind === 'starter') {
      try {
        payload.set(e, await fs.readBytes(`${plan.starter?.root ?? ''}/${e.src ?? e.rel}`));
      } catch (err) {
        throw new PackError(`the starter robot at ${plan.starter?.root ?? '(unset)'} cannot be read: ${e.src ?? e.rel}: ${(err as Error).message}`);
      }
      continue;
    }
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
      say(`skipped ${shown(plan, e)} (${e.reason ?? 'exists'})`);
      continue;
    }
    try {
      await atomicWriteFile(fs, e.target, data, nextTmp);
    } catch (err) {
      throw new InitError(`cannot write ${e.target}: ${(err as Error).message}`);
    }
    if (e.action === 'merge') say(`merged ${shown(plan, e)}: golem entry ${notes.get(e) ?? 'added'}`);
    else say(`wrote ${shown(plan, e)}${e.note !== undefined ? ` (${e.note})` : ''}`);
  }
  if (plan.starter?.skipped !== undefined) say(`skipped starter robot (${plan.starter.skipped})`);
}

/** True when the plan wrote the starter robot's app.js. */
export const starterWritten = (plan: WritePlan): boolean => plan.entries.some((e) => e.kind === 'starter' && e.rel === 'app.js' && e.action === 'write');
