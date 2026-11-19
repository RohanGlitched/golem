// Exact small-sample statistics. No dependencies. See design.md, "Statistics".

/** Average ranks (1-based) of the values, ties share the mean of their positions. */
export function averageRanks(values: readonly number[]): number[] {
  const idx = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]![1]] = r;
    i = j + 1;
  }
  return ranks;
}

export interface Wilcoxon {
  /** Non-zero differences. */
  n: number;
  /** Sum of the ranks of the positive differences (a - b > 0). */
  wPlus: number;
  wMinus: number;
  /** Two-sided exact p; 1 when n = 0. */
  p: number;
}

export const WILCOXON_MAX_N = 20;

/** Paired exact two-sided Wilcoxon signed-rank test of a against b. Zero differences are dropped. */
export function wilcoxonSignedRank(a: readonly number[], b: readonly number[]): Wilcoxon {
  if (a.length !== b.length) throw new RangeError('paired samples must have the same length');
  const d = a.map((x, i) => x - b[i]!).filter((x) => x !== 0);
  const n = d.length;
  if (n > WILCOXON_MAX_N) throw new RangeError(`exact Wilcoxon supports at most ${WILCOXON_MAX_N} non-zero differences, got ${n}`);
  if (n === 0) return { n: 0, wPlus: 0, wMinus: 0, p: 1 };
  const ranks = averageRanks(d.map(Math.abs));
  // Doubled ranks are integers, so subset sums can be counted exactly.
  const r2 = ranks.map((r) => Math.round(2 * r));
  const total2 = r2.reduce((s, x) => s + x, 0);
  let counts = new Float64Array(total2 + 1);
  counts[0] = 1;
  for (const r of r2) {
    const next = new Float64Array(total2 + 1);
    for (let s = 0; s <= total2; s++) {
      const c = counts[s]!;
      if (c === 0) continue;
      next[s] = next[s]! + c;
      next[s + r] = next[s + r]! + c;
    }
    counts = next;
  }
  const w2 = d.reduce((s, x, i) => (x > 0 ? s + r2[i]! : s), 0);
  const all = 2 ** n;
  let le = 0;
  let ge = 0;
  for (let s = 0; s <= total2; s++) {
    if (s <= w2) le += counts[s]!;
    if (s >= w2) ge += counts[s]!;
  }
  const p = Math.min(1, (2 * Math.min(le, ge)) / all);
  return { n, wPlus: w2 / 2, wMinus: (total2 - w2) / 2, p };
}

// ---- regularised incomplete beta ----

function lnGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const cj of c) ser += cj / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betaCf(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

/** I_x(a, b). */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betaCf(a, b, x)) / a : 1 - (bt * betaCf(b, a, 1 - x)) / b;
}

/** The x with I_x(a, b) = p, by bisection to 1e-13. */
export function betaQuantile(p: number, a: number, b: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200 && hi - lo > 1e-13; i++) {
    const mid = (lo + hi) / 2;
    if (betaCdf(mid, a, b) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Exact two-sided Clopper-Pearson interval for k successes in n trials. */
export function clopperPearson(k: number, n: number, confidence = 0.95): { lo: number; hi: number } {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n < 1 || k < 0 || k > n) throw new RangeError(`bad counts k=${k} n=${n}`);
  const alpha = 1 - confidence;
  const lo = k === 0 ? 0 : betaQuantile(alpha / 2, k, n - k + 1);
  const hi = k === n ? 1 : betaQuantile(1 - alpha / 2, k + 1, n - k);
  return { lo, hi };
}

/** Type 7 quantile (linear interpolation, the R default). */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((x, y) => x - y);
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo]! + (h - lo) * (s[hi]! - s[lo]!);
}

export const median = (v: readonly number[]): number => quantile(v, 0.5);
export const iqr = (v: readonly number[]): number => quantile(v, 0.75) - quantile(v, 0.25);

function lnChoose(n: number, k: number): number {
  return lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);
}

/** Two-sided Fisher exact test on [[a, b], [c, d]]: the sum of probabilities not above the observed one. */
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2;
  if (n === 0) return 1;
  const lp = (x: number): number => lnChoose(r1, x) + lnChoose(r2, c1 - x) - lnChoose(n, c1);
  const lo = Math.max(0, c1 - r2), hi = Math.min(r1, c1);
  const pObs = Math.exp(lp(a));
  let p = 0;
  for (let x = lo; x <= hi; x++) {
    const px = Math.exp(lp(x));
    if (px <= pObs * (1 + 1e-7)) p += px;
  }
  return Math.min(1, p);
}
