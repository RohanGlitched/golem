// Feature: candy-app, Property 11: IK step equals the damped-least-squares reference
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { adaptiveLambda, dlsStep, manipulability } from '../controller/ik';

/** Dense reference: solve (J J^T + l^2 I) y = e by Gaussian elimination with partial pivoting, dq = J^T y. */
function reference(J: number[], e: number[], lambda: number): number[] {
  const n = 5;
  const M: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n + 1 }, (_, j) => {
    if (j === n) return e[i]!;
    let s = i === j ? lambda * lambda : 0;
    for (let k = 0; k < 7; k++) s += J[i * 7 + k]! * J[j * 7 + k]!;
    return s;
  }));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  const y = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i]![n]!;
    for (let k = i + 1; k < n; k++) s -= M[i]![k]! * y[k]!;
    y[i] = s / M[i]![i]!;
  }
  return Array.from({ length: 7 }, (_, j) => { let s = 0; for (let i = 0; i < n; i++) s += J[i * 7 + j]! * y[i]!; return s; });
}

const entry = fc.double({ min: -1.5, max: 1.5, noNaN: true });
const jac = fc.array(entry, { minLength: 35, maxLength: 35 });
const vec5 = fc.array(fc.double({ min: -0.5, max: 0.5, noNaN: true }), { minLength: 5, maxLength: 5 });
/** Near-singular: row 4 is row 3 plus a small perturbation. */
const nearSingular = fc.tuple(jac, fc.double({ min: 0, max: 1e-4, noNaN: true })).map(([J, eps]) => {
  const out = J.slice();
  for (let k = 0; k < 7; k++) out[4 * 7 + k] = out[3 * 7 + k]! * (1 + eps);
  return out;
});

describe('damped least squares step', () => {
  it.each([['full rank', jac], ['near singular', nearSingular]] as const)('equals the dense reference within 1e-9 (%s)', (_n, gen) => {
    fc.assert(fc.property(gen, vec5, (J, e) => {
      const lambda = adaptiveLambda(manipulability(J));
      expect(lambda).toBeGreaterThanOrEqual(0.05);
      expect(lambda).toBeLessThanOrEqual(0.2);
      const out = new Float64Array(7);
      expect(dlsStep(J, e, lambda, out)).toBe(true);
      const ref = reference(J, e, lambda);
      const norm = Math.hypot(...ref);
      for (let j = 0; j < 7; j++) expect(Math.abs(out[j]! - ref[j]!)).toBeLessThanOrEqual(1e-9 * Math.max(1, norm));
    }), { numRuns: 300 });
  });

  it('raises lambda toward 0.20 as the manipulability falls', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 0.05, noNaN: true }), fc.double({ min: 0, max: 0.05, noNaN: true }), (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      expect(adaptiveLambda(lo)).toBeGreaterThanOrEqual(adaptiveLambda(hi));
    }), { numRuns: 200 });
  });
});