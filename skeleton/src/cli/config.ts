// Config_File: locate, parse, write.
import type { KitFs } from './deps.js';
import { dirname, resolve } from './paths.js';

export const CONFIG_NAME = 'golem.config.json';

export interface GolemConfig {
  /** Path of the RobotApp module (assumption A6). */
  app: string;
  /** Requirements_File paths; the listed order is the check order. */
  requirements: string[];
  studioUrl?: string;
  /** Names `.kiro/specs/<robot>/`. */
  robot?: string;
  /** Positive finite seconds, default 60. */
  toolTimeCapS?: number;
  /** uint32, default 1 (assumption A7). */
  searchSeed?: number;
  /** Signal name to unit text, for apps that declare no RobotApp.signalUnits. */
  signalUnits?: Record<string, string>;
}

export interface LocatedApp {
  appDir: string;
  configPath: string;
  /** Paths of `app` and `requirements` are absolute. */
  config: GolemConfig;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
  constructor(message: string, readonly path: string, readonly field?: string) { super(message); }
}

export const FIELD_ORDER = ['app', 'requirements', 'studioUrl', 'robot', 'toolTimeCapS', 'searchSeed', 'signalUnits'] as const;

export function parseConfig(text: string, path: string): GolemConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`${path}: invalid JSON: ${(e as Error).message}`, path);
  }
  const bad = (field: string, why: string): never => {
    throw new ConfigError(`${path}: field "${field}" ${why}`, path, field);
  };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`${path}: the file must hold a JSON object`, path);
  }
  const o = raw as Record<string, unknown>;
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
  if (!has('app')) bad('app', 'is missing');
  if (typeof o['app'] !== 'string' || o['app'] === '') bad('app', 'must be a non-empty string');
  if (!has('requirements')) bad('requirements', 'is missing');
  const reqs = o['requirements'];
  if (!Array.isArray(reqs) || !reqs.every((r) => typeof r === 'string' && r !== '')) {
    bad('requirements', 'must be an array of non-empty strings');
  }
  if (has('studioUrl') && typeof o['studioUrl'] !== 'string') bad('studioUrl', 'must be a string');
  if (has('robot') && (typeof o['robot'] !== 'string' || o['robot'] === '')) bad('robot', 'must be a non-empty string');
  if (has('toolTimeCapS')) {
    const v = o['toolTimeCapS'];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) bad('toolTimeCapS', `must be a positive finite number, got ${JSON.stringify(v)}`);
  }
  if (has('searchSeed')) {
    const v = o['searchSeed'];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 0xffffffff) bad('searchSeed', `must be an integer from 0 to 4294967295, got ${JSON.stringify(v)}`);
  }
  if (has('signalUnits')) {
    const u = o['signalUnits'];
    if (typeof u !== 'object' || u === null || Array.isArray(u) || !Object.values(u).every((x) => typeof x === 'string' && x !== '')) {
      bad('signalUnits', 'must be an object of non-empty unit texts');
    }
  }
  const c: GolemConfig = { app: o['app'] as string, requirements: [...(reqs as string[])] };
  if (has('studioUrl')) c.studioUrl = o['studioUrl'] as string;
  if (has('robot')) c.robot = o['robot'] as string;
  if (has('toolTimeCapS')) c.toolTimeCapS = o['toolTimeCapS'] as number;
  if (has('searchSeed')) c.searchSeed = o['searchSeed'] as number;
  if (has('signalUnits')) c.signalUnits = { ...(o['signalUnits'] as Record<string, string>) };
  return c;
}

/** 2-space JSON, fixed key order, trailing newline. */
export function formatConfig(c: GolemConfig): string {
  const o: Record<string, unknown> = {};
  for (const k of FIELD_ORDER) {
    const v = c[k];
    if (v !== undefined) o[k] = v;
  }
  return `${JSON.stringify(o, null, 2)}\n`;
}

async function isFile(fs: KitFs, p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile;
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return false;
    throw e;
  }
}

/** `--app <dir>` looks only in that directory. Without it the search walks up from `cwd`. */
export async function locateApp(cwd: string, appFlag: string | undefined, fs: KitFs): Promise<LocatedApp> {
  let appDir: string | undefined;
  let startDir = cwd;
  if (appFlag !== undefined) {
    startDir = resolve(cwd, appFlag);
    if (await isFile(fs, `${startDir}/${CONFIG_NAME}`)) appDir = startDir;
  } else {
    let dir = resolve(cwd, '.');
    for (;;) {
      if (await isFile(fs, `${dir === '/' ? '' : dir.replace(/\/$/, '')}/${CONFIG_NAME}`)) { appDir = dir; break; }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  if (appDir === undefined) {
    throw new ConfigError(`no ${CONFIG_NAME} found from ${startDir}; run "npx golem-spec init" to create one`, startDir);
  }
  const configPath = `${appDir.replace(/\/$/, '')}/${CONFIG_NAME}`;
  const config = parseConfig(await fs.readFile(configPath), configPath);
  return {
    appDir,
    configPath,
    config: { ...config, app: resolve(appDir, config.app), requirements: config.requirements.map((r) => resolve(appDir as string, r)) },
  };
}
