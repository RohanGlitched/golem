// Number formatting without exponents or binary noise.
const nf = new Map<number, Intl.NumberFormat>();

/** `sig` significant digits, never an exponent, no grouping. */
export function formatSig(x: number, sig = 3): string {
  if (!Number.isFinite(x)) return String(x);
  let f = nf.get(sig);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { maximumSignificantDigits: sig, useGrouping: false });
    nf.set(sig, f);
  }
  const s = f.format(x === 0 ? 0 : x);
  return s === '-0' ? '0' : s;
}

/** Decimal places of the shortest decimal representation of x. */
export function decimalsOf(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const s = String(Math.abs(x));
  const e = /e([+-]\d+)$/.exec(s);
  const mant = e ? s.slice(0, s.indexOf('e')) : s;
  const dot = mant.indexOf('.');
  const d = dot < 0 ? 0 : mant.length - dot - 1;
  return Math.max(0, d - (e ? Number(e[1]) : 0));
}

/** Rounds to `decimals` places, removing binary noise such as 0.30000000000000004. */
export function roundTo(x: number, decimals: number): number {
  if (!Number.isFinite(x)) return x;
  const d = Math.min(Math.max(0, Math.round(decimals)), 15);
  const r = Number(x.toFixed(d));
  return r === 0 ? 0 : r;
}

export function formatQuantityValue(v: number, decimals: number): string {
  return roundTo(v, decimals).toFixed(Math.min(Math.max(0, decimals), 15));
}
