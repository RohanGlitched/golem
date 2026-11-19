// Atomic writes, stable JSON, the report file and the gate-state file.
import type { KitFs } from './deps.js';
import { dirname } from './paths.js';
import type { GateOverride, GateState, ReportFile, ReportMeta, ReportVerdict } from './types.js';

export type { GateOverride, GateState, ReportFile, ReportMeta, ReportVerdict };

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A counter owned by the caller for temp file names; never `Math.random`. */
export function tmpCounter(prefix = ''): () => string {
  let n = 0;
  return () => `${prefix}${n++}`;
}

/** mkdir -p, write `<path>.tmp-<token>`, rename over `path`. On failure removes the temp file and names the path. */
export async function atomicWriteFile(fs: KitFs, path: string, data: string | Uint8Array, nextTmp: () => string): Promise<void> {
  const tmp = `${path}.tmp-${nextTmp()}`;
  try {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, path);
  } catch (e) {
    try { await fs.remove(tmp); } catch { /* the temp file may not exist */ }
    throw new Error(`cannot write ${path}: ${errText(e)}`, { cause: e });
  }
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (typeof v === 'object' && v !== null) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) Object.defineProperty(out, k, { value: sortKeys((v as Record<string, unknown>)[k]), enumerable: true, writable: true, configurable: true });
    return out;
  }
  return v;
}

/** Sorted keys, 2 spaces, non-finite numbers as `null`, trailing newline. */
export function stableJson(v: unknown): string {
  return `${JSON.stringify(sortKeys(v), (_k, x: unknown) => (typeof x === 'number' && !Number.isFinite(x) ? null : x), 2)}\n`;
}

// ---------------------------------------------------------------- report

export async function readReport(fs: KitFs, path: string): Promise<{ report?: ReportFile; unreadable?: string }> {
  let text: string;
  try {
    text = await fs.readFile(path);
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return {};
    return { unreadable: `${path} cannot be read: ${errText(e)}` };
  }
  try {
    const j = JSON.parse(text) as Partial<ReportFile>;
    if (typeof j !== 'object' || j === null || j.schema !== 1 || !Array.isArray(j.verdicts)
      || typeof j.meta !== 'object' || j.meta === null) {
      return { unreadable: `${path} is not a golem report (schema 1 with verdicts and meta expected)` };
    }
    return { report: { schema: 1, verdicts: j.verdicts, meta: j.meta, gateOverrides: Array.isArray(j.gateOverrides) ? j.gateOverrides : [] } };
  } catch (e) {
    return { unreadable: `${path} holds invalid JSON: ${errText(e)}` };
  }
}

/**
 * Scope `all` replaces the verdicts. Scope `{ reqId }` replaces that entry (or appends it) and leaves every other
 * entry unchanged. `gateOverrides` are always kept. `meta` describes the last run.
 */
export function mergeReport(
  prev: ReportFile | undefined, next: ReportVerdict[], meta: ReportMeta, scope: 'all' | { reqId: string },
): ReportFile {
  const overrides = prev?.gateOverrides ?? [];
  if (scope === 'all') return { schema: 1, verdicts: next, meta, gateOverrides: overrides };
  const verdicts = [...(prev?.verdicts ?? [])];
  const entry = next.find((v) => v.reqId === scope.reqId);
  if (entry !== undefined) {
    const i = verdicts.findIndex((v) => v.reqId === scope.reqId);
    if (i >= 0) verdicts[i] = entry; else verdicts.push(entry);
  }
  return { schema: 1, verdicts, meta, gateOverrides: overrides };
}

export function appendOverride(r: ReportFile, o: GateOverride): ReportFile {
  return { ...r, gateOverrides: [...r.gateOverrides, o] };
}

export async function writeReport(fs: KitFs, path: string, r: ReportFile, nextTmp: () => string): Promise<void> {
  await atomicWriteFile(fs, path, stableJson(r), nextTmp);
}

// ---------------------------------------------------------------- gate state

function validState(j: unknown): j is GateState {
  if (typeof j !== 'object' || j === null || Array.isArray(j)) return false;
  return Object.values(j).every((e) => typeof e === 'object' && e !== null
    && Number.isInteger((e as { count?: unknown }).count) && (e as { count: number }).count >= 0
    && typeof (e as { updatedAt?: unknown }).updatedAt === 'string');
}

/** Missing file: `{}` silently. Unreadable or wrong shape: `{}` and a warning that names the path. */
export async function readGateState(fs: KitFs, path: string, warn: (m: string) => void): Promise<GateState> {
  let text: string;
  try {
    text = await fs.readFile(path);
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return {};
    warn(`warning: ${path} cannot be read (${errText(e)}); treating the gate state as empty`);
    return {};
  }
  try {
    const j: unknown = JSON.parse(text);
    if (validState(j)) return j;
  } catch { /* falls through to the warning */ }
  warn(`warning: ${path} is not valid gate state; treating it as empty`);
  return {};
}

export async function writeGateState(fs: KitFs, path: string, s: GateState, nextTmp: () => string): Promise<void> {
  await atomicWriteFile(fs, path, stableJson(s), nextTmp);
}
