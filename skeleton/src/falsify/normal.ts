// Normal distribution helpers. erfc uses a positive-term series below 2 and a Lentz continued
// fraction above, which keeps full relative precision in the tails without tabulated coefficients.

const SQRT_PI = Math.sqrt(Math.PI);
const SQRT2 = Math.SQRT2;

function erfSeries(x: number): number {
  // erf(x) = 2/sqrt(pi) * exp(-x^2) * sum_{n>=0} 2^n x^(2n+1) / (1*3*...*(2n+1)); all terms positive.
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n < 200; n++) {
    term *= (2 * x2) / (2 * n + 1);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return (2 / SQRT_PI) * Math.exp(-x2) * sum;
}

function erfcFraction(x: number): number {
  // erfc(x) = exp(-x^2)/sqrt(pi) * 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + 2/(x + ...)))))
  const tiny = 1e-300;
  let f = x === 0 ? tiny : x;
  let c = f;
  let d = 0;
  for (let k = 1; k < 2000; k++) {
    const a = k / 2;
    d = x + a * d;
    if (d === 0) d = tiny;
    c = x + a / c;
    if (c === 0) c = tiny;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (SQRT_PI * f);
}

export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x < 0) return 2 - erfc(-x);
  if (x < 2) return 1 - erfSeries(x);
  if (x > 27) return 0;
  return erfcFraction(x);
}

export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / SQRT2);
}

function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/** Inverse of normalCdf on (0, 1); -Infinity at 0, +Infinity at 1, NaN outside [0, 1]. */
export function normalQuantile(p: number): number {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  if (p > 0.5) return -normalQuantile(1 - p);
  // Abramowitz-Stegun 26.2.23 start (error < 4.5e-4), then Halley steps on the exact CDF.
  const t = Math.sqrt(-2 * Math.log(p));
  let x = -(t - (2.515517 + t * (0.802853 + t * 0.010328)) / (1 + t * (1.432788 + t * (0.189269 + t * 0.001308))));
  for (let i = 0; i < 12; i++) {
    const pdf = normalPdf(x);
    if (pdf === 0) break;
    const u = (normalCdf(x) - p) / pdf;
    const step = u / (1 + (x * u) / 2);
    x -= step;
    if (Math.abs(step) <= 1e-15 * Math.max(1, Math.abs(x))) break;
  }
  return x;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Inverse-CDF draw from N(mu, sigma) truncated to [lo, hi], one uniform `u` in [0, 1) per draw.
 * Non-decreasing in u. If the interval carries negligible mass (mean about 7 sigma outside) the
 * truncated density's mode, clamp(mu, lo, hi), is returned.
 */
export function drawTruncatedNormal(mu: number, sigma: number, lo: number, hi: number, u: number): number {
  let za = (lo - mu) / sigma;
  let zb = (hi - mu) / sigma;
  let flip = false;
  if (za > 0) {
    [za, zb] = [-zb, -za];
    flip = true;
  }
  const a = normalCdf(za);
  const b = normalCdf(zb);
  const mass = b - a;
  let x: number;
  if (mass >= 1e-12) {
    // Mirrored case: y = -z, so draw from the top of the mirrored interval to keep x non-decreasing in u.
    const y = normalQuantile(flip ? b - u * mass : a + u * mass);
    x = flip ? mu - sigma * y : mu + sigma * y;
  } else {
    x = clamp(mu, lo, hi);
  }
  // A draw at the very edge of the mass can round to a quantile of exactly 0 or 1 (±Infinity): that is the bound on
  // that side, so the draw stays monotone in u. Only NaN falls back to mu.
  if (!Number.isFinite(x)) x = x > 0 ? hi : x < 0 ? lo : clamp(mu, lo, hi);
  return clamp(x, lo, hi);
}
