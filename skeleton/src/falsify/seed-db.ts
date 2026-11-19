// Pinned counterexamples at <root>/seeds/<app>/<reqId>.json, written atomically in canonical JSON.
import type { Counterexample } from './contract.js';
import { SeedDbError, errorMessage } from './errors.js';
import type { FileSystem } from './fs.js';
import type { PinnedSeedEntry, SeedReader } from './types.js';

export interface SeedDatabase extends SeedReader {
  add(appId: string, entry: PinnedSeedEntry): Promise<'added' | 'duplicate'>;
  write(appId: string, reqId: string, entries: PinnedSeedEntry[]): Promise<void>;
  pathFor(appId: string, reqId: string): string;
}

function validateId(id: string, what: string): void {
  const bad = typeof id !== 'string' || id.length === 0 || id.includes('/') || id.includes('\\')
    || id.includes('..') || id.includes('\0');
  if (bad) {
    throw new SeedDbError(
      `invalid ${what} ${JSON.stringify(id)}: must be non-empty and contain no '/', '\\', '..' or NUL`,
    );
  }
}

/** Returns a reason when `e` is not a valid entry, otherwise undefined. */
export function entryProblem(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return 'not an object';
  const o = e as Record<string, unknown>;
  if (typeof o['reqId'] !== 'string') return 'reqId must be a string';
  if (typeof o['scenario'] !== 'object' || o['scenario'] === null || Array.isArray(o['scenario'])) {
    return 'scenario must be an object';
  }
  for (const [k, v] of Object.entries(o['scenario'] as object)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return `scenario.${k} must be a finite number`;
  }
  if (typeof o['seed'] !== 'number' || !Number.isInteger(o['seed'])) return 'seed must be an integer';
  if (typeof o['robustness'] !== 'number' || !Number.isFinite(o['robustness'])) return 'robustness must be a finite number';
  if (typeof o['shrunk'] !== 'boolean') return 'shrunk must be a boolean';
  if (typeof o['foundAfter'] !== 'number' || !Number.isFinite(o['foundAfter'])) return 'foundAfter must be a number';
  const c = o['classification'];
  if (c !== undefined && c !== 'robust' && c !== 'seed-sensitive') return 'classification must be robust or seed-sensitive';
  const vs = o['verificationSeeds'];
  if (vs !== undefined && !(Array.isArray(vs) && vs.length === 3 && vs.every((x) => typeof x === 'number' && Number.isFinite(x)))) {
    return 'verificationSeeds must be an array of 3 numbers';
  }
  const vr = o['verificationRobustness'];
  if (vr !== undefined && !(Array.isArray(vr) && vr.length === 3 && vr.every((x) => x === null || (typeof x === 'number' && Number.isFinite(x))))) {
    return 'verificationRobustness must be an array of 3 numbers or nulls';
  }
  return undefined;
}

/** Same reqId, seed, dimension names and exact (===) values. Ignores robustness, shrunk, foundAfter. */
export function counterexampleEquals(a: Counterexample, b: Counterexample): boolean {
  if (a.reqId !== b.reqId || a.seed !== b.seed) return false;
  const ka = Object.keys(a.scenario);
  const kb = Object.keys(b.scenario);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b.scenario, k) && a.scenario[k] === b.scenario[k]);
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (typeof v === 'object' && v !== null) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

function assertFinite(v: unknown, where: string): void {
  if (typeof v === 'number' && !Number.isFinite(v)) throw new SeedDbError(`non-finite number at ${where}`);
  if (Array.isArray(v)) v.forEach((x, i) => assertFinite(x, `${where}[${i}]`));
  else if (typeof v === 'object' && v !== null) {
    for (const [k, x] of Object.entries(v)) assertFinite(x, `${where}.${k}`);
  }
}

/** Sorted keys, 2-space indent, one trailing newline. Non-finite numbers are rejected. */
export function canonicalJson(entries: readonly PinnedSeedEntry[]): string {
  assertFinite(entries, 'entries');
  return `${JSON.stringify(sortKeys(entries), null, 2)}\n`;
}

export function createSeedDatabase(fs: FileSystem, root = '.golem'): SeedDatabase {
  let counter = 0;
  const pathFor = (appId: string, reqId: string): string => {
    validateId(appId, 'app id');
    validateId(reqId, 'requirement id');
    return `${root}/seeds/${appId}/${reqId}.json`;
  };

  const read = async (appId: string, reqId: string): Promise<PinnedSeedEntry[]> => {
    const path = pathFor(appId, reqId);
    let text: string;
    try {
      text = await fs.readFile(path);
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') return [];
      throw new SeedDbError(`cannot read seed file ${path}: ${errorMessage(e)}`, { cause: e });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new SeedDbError(`seed file ${path} holds invalid JSON: ${errorMessage(e)}`, { cause: e });
    }
    if (!Array.isArray(parsed)) throw new SeedDbError(`seed file ${path} must hold a JSON array`);
    for (let i = 0; i < parsed.length; i++) {
      const problem = entryProblem(parsed[i]);
      if (problem !== undefined) throw new SeedDbError(`seed file ${path}: entry ${i} is invalid (${problem})`);
    }
    return parsed as PinnedSeedEntry[];
  };

  const write = async (appId: string, reqId: string, entries: PinnedSeedEntry[]): Promise<void> => {
    const path = pathFor(appId, reqId);
    for (let i = 0; i < entries.length; i++) {
      const problem = entryProblem(entries[i]);
      if (problem !== undefined) throw new SeedDbError(`cannot write ${path}: entry ${i} is invalid (${problem})`);
    }
    let text: string;
    try { text = canonicalJson(entries); } catch (e) {
      throw new SeedDbError(`cannot write ${path}: ${errorMessage(e)}`, { cause: e });
    }
    const tmp = `${path}.tmp-${counter++}`;
    try {
      await fs.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      await fs.writeFile(tmp, text);
      await fs.rename(tmp, path);
    } catch (e) {
      try { await fs.remove(tmp); } catch { /* ignore */ }
      throw new SeedDbError(`cannot write seed file ${path}: ${errorMessage(e)}`, { cause: e });
    }
  };

  return {
    pathFor,
    read,
    write,
    async add(appId, entry) {
      const existing = await read(appId, entry.reqId);
      if (existing.some((e) => counterexampleEquals(e, entry))) return 'duplicate';
      await write(appId, entry.reqId, [...existing, entry]);
      return 'added';
    },
  };
}

export function pinCounterexample(
  db: SeedDatabase, appId: string, entry: PinnedSeedEntry,
): Promise<'added' | 'duplicate'> {
  return db.add(appId, entry);
}
