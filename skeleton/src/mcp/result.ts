// Tool_Result: exactly two text blocks, a one-line summary and a JSON block of at most 32768 bytes.
export interface ToolResult {
  content: [{ type: 'text'; text: string }, { type: 'text'; text: string }];
  isError?: true;
  [key: string]: unknown;
}

export const SUMMARY_MAX = 200;
export const JSON_MAX_BYTES = 32768;

const byteLength = (s: string): number => new TextEncoder().encode(s).length;

/** Collapses line breaks and whitespace runs, trims, and cuts to `max` UTF-16 units without splitting a pair. */
export function oneLine(s: string, max = SUMMARY_MAX): string {
  let t = s.replace(/\s+/g, ' ').trim();
  if (t === '') t = '(no summary)';
  if (t.length > max) {
    t = t.slice(0, max);
    const last = t.charCodeAt(t.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) t = t.slice(0, -1);
  }
  return t;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Path = (string | number)[];
type Bag = Record<string | number, Json>;

function walk(v: Json, path: Path, pick: (v: Json, path: Path) => void): void {
  pick(v, path);
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i], pick));
  else if (typeof v === 'object' && v !== null) for (const k of Object.keys(v)) walk((v as Bag)[k] as Json, [...path, k], pick);
}

function longest(root: Json, want: (v: Json) => number): { path: Path; len: number } {
  const best = { path: [] as Path, len: 0 };
  walk(root, [], (x, p) => { const n = want(x); if (n > best.len) { best.path = p; best.len = n; } });
  return best;
}

function holder(root: Json, path: Path): Bag {
  let cur: Json = root;
  for (let i = 0; i < path.length - 1; i++) cur = (cur as Bag)[path[i] as string | number] as Json;
  return cur as Bag;
}

const label = (path: Path, isObj: boolean): string => {
  const p = isObj ? path : path.slice(1);
  return p.length === 0 ? '$' : p.join('.');
};

/**
 * Serialises `json`. While the UTF-8 length exceeds `maxBytes` it halves the longest array (first found on ties),
 * keeping the leading elements, and records `{ original, kept }` under its dotted path in `truncated`. When no array is
 * left it cuts the longest string. The result stays valid JSON.
 */
export function limitJson(json: unknown, maxBytes = JSON_MAX_BYTES): { text: string; truncated?: Record<string, { original: number; kept: number }> } {
  const base = JSON.stringify(json);
  if (base === undefined) return { text: 'null' };
  if (byteLength(base) <= maxBytes) return { text: base };
  const root = JSON.parse(base) as Json;
  const isObj = typeof root === 'object' && root !== null && !Array.isArray(root);
  const wrapper: { [k: string]: Json } = isObj ? (root as { [k: string]: Json }) : { value: root };
  const truncated: Record<string, { original: number; kept: number }> = {};
  const render = (): string => JSON.stringify({ ...wrapper, truncated });
  for (let guard = 0; guard < 100000; guard++) {
    const text = render();
    if (byteLength(text) <= maxBytes) return { text, truncated };
    const arr = longest(wrapper, (x) => (Array.isArray(x) ? x.length : 0));
    if (arr.len > 0) {
      const a = holder(wrapper, arr.path)[arr.path[arr.path.length - 1] as string | number] as Json[];
      const key = label(arr.path, isObj);
      const kept = Math.floor(a.length / 2);
      truncated[key] = { original: truncated[key]?.original ?? a.length, kept };
      a.length = kept;
      continue;
    }
    const str = longest(wrapper, (x) => (typeof x === 'string' ? x.length : 0));
    if (str.len > 0) {
      const bag = holder(wrapper, str.path);
      const k = str.path[str.path.length - 1] as string | number;
      const s = bag[k] as string;
      const kept = Math.floor(s.length / 2);
      const key = label(str.path, isObj);
      truncated[key] = { original: truncated[key]?.original ?? s.length, kept };
      bag[k] = s.slice(0, kept);
      continue;
    }
    break;
  }
  return { text: JSON.stringify({ error: 'result too large', truncated: true }), truncated };
}

export function makeToolResult(summary: string, json: unknown, isError?: boolean): ToolResult {
  const r: ToolResult = {
    content: [{ type: 'text', text: oneLine(summary) }, { type: 'text', text: limitJson(json).text }],
  };
  if (isError === true) r.isError = true;
  return r;
}
