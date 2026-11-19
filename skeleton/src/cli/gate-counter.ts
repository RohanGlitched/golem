// The loop guard of `golem gate --kiro`: a pure counter keyed by session id.
import type { GateState } from './types.js';

export const BLOCK_LIMIT = 5;
export const DEDUPE_WINDOW_S = 2;
export const PRUNE_AFTER_MS = 7 * 24 * 3600 * 1000;
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

type Entry = { count: number; updatedAt: string };

const own = (s: object, k: string): boolean => Object.prototype.hasOwnProperty.call(s, k);

function copyState(s: Readonly<GateState>): GateState {
  const out: GateState = {};
  for (const k of Object.keys(s)) Object.defineProperty(out, k, { value: s[k], enumerable: true, writable: true, configurable: true });
  return out;
}

function setKey(s: GateState, k: string, v: Entry): void {
  Object.defineProperty(s, k, { value: v, enumerable: true, writable: true, configurable: true });
}

/** What a stop allowed on a red gate records: every id that is not met, and those among them that are not `held`. */
export function overrideIds(unmet: readonly { id: string; status: 'held' | 'broken' | 'error' }[]): { unmetReqIds: string[]; brokenReqIds: string[] } {
  return { unmetReqIds: unmet.map((u) => u.id), brokenReqIds: unmet.filter((u) => u.status !== 'held').map((u) => u.id) };
}

/** Seconds from the stored `updatedAt` of the session to `startMs`, or `undefined` without a usable entry. */
export function elapsedSeconds(state: Readonly<GateState>, sessionId: string, startMs: number): number | undefined {
  if (!own(state, sessionId)) return undefined;
  const t = Date.parse((state[sessionId] as Entry).updatedAt);
  return Number.isNaN(t) ? undefined : (startMs - t) / 1000;
}

/**
 * Green: allow, delete the key. Red below the limit: block, count + 1. Red at the limit: allow once and store
 * count 0 (no latch). Red within DEDUPE_WINDOW_S of the stored `updatedAt`: same Stop event, state unchanged,
 * allow only when the stored count is 0. No clock, file or random access; the input is not mutated.
 */
export function gateCounter(
  state: Readonly<GateState>, sessionId: string, gateGreen: boolean, nowIso?: string, elapsedS?: number,
): { allowStop: boolean; nextState: GateState } {
  const next = copyState(state);
  if (gateGreen) {
    delete next[sessionId];
    return { allowStop: true, nextState: next };
  }
  const entry = own(state, sessionId) ? (state[sessionId] as Entry) : undefined;
  const stored = entry !== undefined && Number.isInteger(entry.count) && entry.count >= 0 ? entry.count : 0;
  if (entry !== undefined && elapsedS !== undefined && Number.isFinite(elapsedS) && elapsedS >= 0 && elapsedS < DEDUPE_WINDOW_S) {
    return { allowStop: stored === 0, nextState: next };
  }
  const stamp = nowIso ?? entry?.updatedAt ?? EPOCH_ISO;
  if (stored < BLOCK_LIMIT) {
    setKey(next, sessionId, { count: stored + 1, updatedAt: stamp });
    return { allowStop: false, nextState: next };
  }
  setKey(next, sessionId, { count: 0, updatedAt: stamp });
  return { allowStop: true, nextState: next };
}

/** Drops entries older than 7 days and entries whose `updatedAt` is not a valid time. */
export function pruneState(state: Readonly<GateState>, nowMs: number): GateState {
  const out: GateState = {};
  for (const k of Object.keys(state)) {
    const e = state[k] as Entry;
    const t = Date.parse(e.updatedAt);
    if (Number.isNaN(t)) continue;
    if (nowMs - t > PRUNE_AFTER_MS) continue;
    setKey(out, k, e);
  }
  return out;
}

/** The Session_Id of a Stop payload: a non-empty string `session_id`, else `default`. Nothing else is read. */
export function parseStopPayload(raw: string | undefined): { sessionId: string } {
  if (raw === undefined || raw.trim() === '') return { sessionId: 'default' };
  try {
    const j: unknown = JSON.parse(raw);
    if (typeof j === 'object' && j !== null && !Array.isArray(j)) {
      const id = (j as Record<string, unknown>)['session_id'];
      if (typeof id === 'string' && id !== '') return { sessionId: id };
    }
  } catch { /* ignored: an invalid payload means `default` */ }
  return { sessionId: 'default' };
}
