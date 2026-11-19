// Platform-neutral path helpers. The kit keeps every path in `/` form (also on Windows, where Node accepts it),
// so the in-memory KitFs of the tests and the real file system see the same strings.

const DRIVE = /^[A-Za-z]:\//;

/** `\` to `/`, repeated `/` collapsed (a leading `//` is kept), no trailing `/` except for the root. */
export function slash(p: string): string {
  let s = p.replace(/\\/g, '/');
  const lead = s.startsWith('//') && !s.startsWith('///') ? '/' : '';
  s = lead + s.replace(/\/{2,}/g, '/');
  if (s.length > 1 && s.endsWith('/') && !/^[A-Za-z]:\/$/.test(s)) s = s.slice(0, -1);
  return s;
}

export function isAbsolute(p: string): boolean {
  const s = p.replace(/\\/g, '/');
  return s.startsWith('/') || DRIVE.test(s);
}

function rootOf(s: string): string {
  if (s.startsWith('//')) return '//';
  if (s.startsWith('/')) return '/';
  const m = DRIVE.exec(s);
  return m ? m[0] : '';
}

/** Resolves `.` and `..` segments of an absolute path or of a relative one (kept relative). */
export function normalize(p: string): string {
  const s = slash(p);
  const root = rootOf(s);
  const rest = s.slice(root.length);
  const out: string[] = [];
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (root === '') out.push('..');
      continue;
    }
    out.push(seg);
  }
  const body = out.join('/');
  if (root !== '') return body === '' ? root : root + body;
  return body === '' ? '.' : body;
}

/** `rel` against `base`; an absolute `rel` stays. */
export function resolve(base: string, rel: string): string {
  if (isAbsolute(rel)) return normalize(rel);
  return normalize(`${slash(base)}/${rel}`);
}

export function join(...parts: string[]): string {
  return normalize(parts.filter((p) => p !== '').join('/'));
}

export function dirname(p: string): string {
  const s = normalize(p);
  const root = rootOf(s);
  const i = s.lastIndexOf('/');
  if (i < root.length) return root === '' ? '.' : root;
  return s.slice(0, i);
}

export function basename(p: string): string {
  const s = slash(p);
  return s.slice(s.lastIndexOf('/') + 1);
}

/** `p` relative to `base`, both absolute or both relative. Falls back to `p` when they share no root. */
export function relative(base: string, p: string): string {
  const a = normalize(base).split('/').filter((x) => x !== '');
  const b = normalize(p).split('/').filter((x) => x !== '');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = a.slice(i).map(() => '..');
  const out = [...up, ...b.slice(i)].join('/');
  return out === '' ? '.' : out;
}

/** True when `child` is `parent` or lies below it. Both must be normalised and absolute. */
export function isInside(parent: string, child: string): boolean {
  const a = normalize(parent);
  const b = normalize(child);
  if (a === b) return true;
  const prefix = a.endsWith('/') ? a : `${a}/`;
  return b.startsWith(prefix);
}
