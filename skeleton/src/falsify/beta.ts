// One-sided Clopper-Pearson upper bound through the regularized incomplete beta function.

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** ln Gamma(x), Lanczos g = 7. */
export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  x -= 1;
  let a = LANCZOS[0] as number;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += (LANCZOS[i] as number) / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  const qab = a + b; const qap = a + 1; const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 10000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

/** I_x(a, b) for a, b > 0 and x in [0, 1]. */
export function regularizedIncBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log1p(-x) - lnBeta);
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(x, a, b)) / a;
  return 1 - (front * betacf(1 - x, b, a)) / b;
}

/** Bisection stops when the bracket on x is narrower than this. */
export const CP_TOLERANCE = 1e-13;

/** Upper confidence bound on a failure rate: k failures in n trials. */
export function clopperPearsonUpper(n: number, k: number, confidence = 0.95): number {
  if (k >= n) return 1;
  if (k <= 0) return 1 - Math.pow(1 - confidence, 1 / n);
  let lo = k / n;
  let hi = 1;
  for (let i = 0; i < 200 && hi - lo > CP_TOLERANCE; i++) {
    const mid = (lo + hi) / 2;
    if (regularizedIncBeta(mid, k + 1, n - k) < confidence) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Rule of three for k = 0, Clopper-Pearson otherwise; undefined when n = 0. */
export function failureRateUpper95(n: number, k: number): number | undefined {
  if (n <= 0) return undefined;
  if (k <= 0) return Math.min(1, 3 / n);
  if (k >= n) return 1;
  return Math.min(1, clopperPearsonUpper(n, k, 0.95));
}
