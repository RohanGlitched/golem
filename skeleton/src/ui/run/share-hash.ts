// Share_Hash: "#g=" + base64url(UTF-8(compact JSON)). Isomorphic (no Buffer), parsed locally only.
import type { Scenario, ShareState } from '../types.js';

export const SHARE_PREFIX = '#g=';
export const SHARE_MAX = 4000;
export const UNREADABLE = 'it could not be read';

const nz = (x: number): number => (x === 0 ? 0 : x);

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return undefined;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  let bin: string;
  try { bin = atob(b64); } catch { return undefined; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeShare(s: ShareState): string {
  const l: Record<string, string> = {};
  for (const k of Object.keys(s.lines).sort()) l[k] = s.lines[k] as string;
  const payload: Record<string, unknown> = { v: 1, l };
  if (s.pick) {
    const d: Record<string, number> = {};
    for (const k of Object.keys(s.pick.scenario).sort()) d[k] = nz(s.pick.scenario[k] as number);
    payload['c'] = { r: s.pick.reqId, s: nz(s.pick.seed), d };
  }
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

export const shareFragment = (s: ShareState): string => SHARE_PREFIX + encodeShare(s);

/** Never throws. `ignored` lists, in words, what was left out. */
export function decodeShare(hash: string, knownIds: ReadonlySet<string>): { state: ShareState; ignored: string[] } {
  const empty: ShareState = { lines: {} };
  let h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (h === '') return { state: empty, ignored: [] };
  if (!h.startsWith('g=')) return { state: empty, ignored: [] };
  h = h.slice(2);
  const bytes = fromBase64Url(h);
  if (!bytes) return { state: empty, ignored: [UNREADABLE] };
  let o: unknown;
  try { o = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return { state: empty, ignored: [UNREADABLE] }; }
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return { state: empty, ignored: [UNREADABLE] };
  const r = o as Record<string, unknown>;
  if (r['v'] !== 1) return { state: empty, ignored: [UNREADABLE] };
  const ignored: string[] = [];
  const lines: Record<string, string> = {};
  const l = r['l'];
  if (l !== undefined) {
    if (l === null || typeof l !== 'object' || Array.isArray(l)) ignored.push('the edited lines, which could not be read');
    else {
      for (const [id, text] of Object.entries(l as Record<string, unknown>)) {
        if (!knownIds.has(id)) ignored.push(`line ${id}, which is not in this file`);
        else if (typeof text !== 'string') ignored.push(`line ${id}, whose text could not be read`);
        else lines[id] = text;
      }
    }
  }
  const state: ShareState = { lines };
  const c = r['c'];
  if (c !== undefined) {
    const cc = c as Record<string, unknown> | null;
    const d = cc && typeof cc === 'object' ? cc['d'] : undefined;
    const scenario: Scenario = {};
    let ok = !!cc && typeof cc === 'object' && typeof cc['r'] === 'string' && typeof cc['s'] === 'number'
      && Number.isInteger(cc['s']) && !!d && typeof d === 'object' && !Array.isArray(d);
    if (ok) {
      for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) { ok = false; break; }
        scenario[k] = nz(v);
      }
    }
    if (!ok) ignored.push('the selected seed, which could not be read');
    else if (!knownIds.has(cc!['r'] as string)) ignored.push(`the seed of line ${cc!['r'] as string}, which is not in this file`);
    else state.pick = { reqId: cc!['r'] as string, seed: nz(cc!['s'] as number), scenario };
  }
  return { state, ignored };
}

/** Keeps only the lines whose text differs from the original. */
export function buildShareState(
  original: Record<string, string>, current: Record<string, string>, pick?: ShareState['pick'],
): ShareState {
  const lines: Record<string, string> = {};
  for (const [id, text] of Object.entries(current)) if (original[id] !== text) lines[id] = text;
  return pick ? { lines, pick } : { lines };
}

export function fitShare(
  state: ShareState, original: Record<string, string>, maxChars = SHARE_MAX,
): { hash: string; omittedIds: string[]; tooLong: boolean } {
  const lines: Record<string, string> = {};
  for (const [id, t] of Object.entries(state.lines)) if (original[id] !== t) lines[id] = t;
  let s: ShareState = state.pick ? { lines, pick: state.pick } : { lines };
  let hash = shareFragment(s);
  const omittedIds: string[] = [];
  if (hash.length <= maxChars) return { hash, omittedIds, tooLong: false };
  const order = Object.keys(original);
  const ids = Object.keys(lines).sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib) || (a < b ? -1 : a > b ? 1 : 0);
  });
  while (hash.length > maxChars && ids.length > 0) {
    const id = ids.pop() as string;
    delete lines[id];
    omittedIds.unshift(id);
    hash = shareFragment(s);
  }
  if (hash.length > maxChars && s.pick) { s = { lines }; hash = shareFragment(s); }
  return { hash, omittedIds, tooLong: true };
}

export function tooLongText(omittedIds: string[]): string {
  if (omittedIds.length === 0) return 'The link is too long: it leaves out the selected seed';
  const list = omittedIds.length === 1 ? omittedIds[0] as string
    : `${omittedIds.slice(0, -1).join(', ')} and ${omittedIds[omittedIds.length - 1] as string}`;
  return `The link is too long: it leaves out edits to line${omittedIds.length === 1 ? '' : 's'} ${list}`;
}

export const ignoredText = (ignored: string[]): string => `Ignored the shared link: ${ignored.join('; ')}`;
