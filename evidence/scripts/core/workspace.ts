// Pure helpers for the agent-gate workspaces: Stop-hook removal and snapshot diffs.
import { createHash } from 'node:crypto';

export const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

const isStop = (h: unknown): boolean => {
  if (h === null || typeof h !== 'object') return false;
  const o = h as { trigger?: unknown; name?: unknown };
  return typeof o.trigger === 'string' && o.trigger.toLowerCase() === 'stop';
};

/** Removes every hook whose trigger is `stop` (any case) from `{ hooks: [...] }` JSON, a Kiro hooks file or an agent file. Returns the new text and how many were removed. */
export function stripStopHooks(json: string): { text: string; removed: number } {
  const doc = JSON.parse(json) as { hooks?: unknown };
  if (!Array.isArray(doc.hooks)) return { text: json, removed: 0 };
  const kept = doc.hooks.filter((h) => !isStop(h));
  const removed = doc.hooks.length - kept.length;
  if (removed === 0) return { text: json, removed: 0 };
  return { text: `${JSON.stringify({ ...doc, hooks: kept }, null, 2)}\n`, removed };
}

export const hasStopHook = (json: string): boolean => {
  const doc = JSON.parse(json) as { hooks?: unknown };
  return Array.isArray(doc.hooks) && doc.hooks.some(isStop);
};

export type Snapshot = Record<string, string>;

export interface SnapshotDiff { added: string[]; removed: string[]; changed: string[]; requirementsModified: boolean }

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const added = Object.keys(after).filter((k) => !(k in before)).sort();
  const removed = Object.keys(before).filter((k) => !(k in after)).sort();
  const changed = Object.keys(after).filter((k) => k in before && before[k] !== after[k]).sort();
  const isReq = (p: string): boolean => /(^|\/)requirements\.md$/.test(p);
  return { added, removed, changed, requirementsModified: [...added, ...removed, ...changed].some(isReq) };
}