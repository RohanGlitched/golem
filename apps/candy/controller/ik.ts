// Damped-least-squares inverse kinematics on the suction-cup tip.
//
// Task rows (5): three tip position rows, then two tilt rows (rotation about the world x and y axes) weighted by
// IK.tiltWeight (m/rad). The rotation about the cup axis is free. The update is
//
//   dq = J^T (J J^T + lambda^2 I)^-1 e
//
// with lambda raised near singular configurations (small manipulability mu = sqrt(det(J J^T))). Iterations run on a
// scratch MjData that the solver owns, so the live data.qpos is never touched. All working arrays are allocated
// once in the constructor.
import { IK } from '../constants';

const NJ = 7;   // arm joints
const NR = 5;   // task rows

export interface IkResult {
  /** Joint targets (7 values, rad). */
  q: Float64Array;
  /** Tip position error of `q` (m), or Infinity when the Jacobian was not finite. */
  error: number;
  iterations: number;
  converged: boolean;
}

export function makeIkResult(): IkResult {
  return { q: new Float64Array(NJ), error: Infinity, iterations: 0, converged: false };
}

// ---------------------------------------------------------------- pure numeric core

const A = new Float64Array(NR * NR);     // J J^T, then its Cholesky factor
const Lf = new Float64Array(NR * NR);
const Y = new Float64Array(NR);

/**
 * Cholesky factor of the 5x5 symmetric matrix in `A` (lower triangle) into `Lf`. Returns false when a pivot is
 * not positive.
 */
function cholesky(src: Float64Array, shift: number): boolean {
  for (let i = 0; i < NR; i++) {
    for (let j = 0; j <= i; j++) {
      let s = src[i * NR + j] as number;
      if (i === j) s += shift;
      for (let k = 0; k < j; k++) s -= (Lf[i * NR + k] as number) * (Lf[j * NR + k] as number);
      if (i === j) {
        if (!(s > 0)) return false;
        Lf[i * NR + i] = Math.sqrt(s);
      } else {
        Lf[i * NR + j] = s / (Lf[j * NR + j] as number);
      }
    }
  }
  return true;
}

/** J J^T into A. @param J 5x7 row-major */
function gram(J: ArrayLike<number>): void {
  for (let i = 0; i < NR; i++) {
    for (let j = 0; j <= i; j++) {
      let s = 0;
      for (let k = 0; k < NJ; k++) s += (J[i * NJ + k] as number) * (J[j * NJ + k] as number);
      A[i * NR + j] = s;
      A[j * NR + i] = s;
    }
  }
}

/** Manipulability mu = sqrt(det(J J^T)) of a 5x7 row-major Jacobian; 0 when J J^T is singular. */
export function manipulability(J: ArrayLike<number>): number {
  gram(J);
  if (!cholesky(A, 0)) return 0;
  let det = 1;
  for (let i = 0; i < NR; i++) det *= (Lf[i * NR + i] as number) ** 2;
  return Math.sqrt(det);
}

/** Damping factor from the manipulability: lambda0 above mu0, rising to lambdaMax as mu goes to 0. */
export function adaptiveLambda(mu: number): number {
  if (!(mu < IK.mu0)) return IK.lambda0;
  const r = 1 - (mu > 0 ? mu : 0) / IK.mu0;
  return IK.lambda0 + (IK.lambdaMax - IK.lambda0) * r * r;
}

/**
 * Damped-least-squares joint update dq = J^T (J J^T + lambda^2 I)^-1 e, before any step limit.
 * @param J 5x7 row-major @param e 5 values @param out 7 values
 * @returns false when the damped system could not be factored (only for a non-finite input)
 */
export function dlsStep(J: ArrayLike<number>, e: ArrayLike<number>, lambda: number, out: Float64Array): boolean {
  gram(J);
  if (!cholesky(A, lambda * lambda)) return false;
  // forward and back substitution
  for (let i = 0; i < NR; i++) {
    let s = e[i] as number;
    for (let k = 0; k < i; k++) s -= (Lf[i * NR + k] as number) * (Y[k] as number);
    Y[i] = s / (Lf[i * NR + i] as number);
  }
  for (let i = NR - 1; i >= 0; i--) {
    let s = Y[i] as number;
    for (let k = i + 1; k < NR; k++) s -= (Lf[k * NR + i] as number) * (Y[k] as number);
    Y[i] = s / (Lf[i * NR + i] as number);
  }
  for (let j = 0; j < NJ; j++) {
    let s = 0;
    for (let i = 0; i < NR; i++) s += (J[i * NJ + j] as number) * (Y[i] as number);
    out[j] = s;
  }
  return true;
}

// ---------------------------------------------------------------- the solver

export class IkSolver {
  private readonly mj: any;
  private readonly model: any;
  private readonly site: number;
  private readonly nv: number;
  private data: any;
  private jacp: any;
  private jacr: any;
  private jp!: Float64Array;
  private jr!: Float64Array;
  private qpos!: Float64Array;
  private sitePos!: Float64Array;
  private siteMat!: Float64Array;
  private disposed = false;

  private readonly lo = new Float64Array(NJ);
  private readonly hi = new Float64Array(NJ);
  private readonly J = new Float64Array(NR * NJ);
  private readonly e = new Float64Array(NR);
  private readonly dq = new Float64Array(NJ);
  private readonly q = new Float64Array(NJ);

  constructor(mj: any, model: any, siteId: number) {
    this.mj = mj; this.model = model; this.site = siteId;
    this.nv = model.nv as number;
    const range: Float64Array = model.jnt_range;
    for (let j = 0; j < NJ; j++) { this.lo[j] = range[2 * j] as number; this.hi[j] = range[2 * j + 1] as number; }
    this.data = new mj.MjData(model);
    this.jacp = new mj.DoubleBuffer(3 * this.nv);
    this.jacr = new mj.DoubleBuffer(3 * this.nv);
    this.readViews();
  }

  private readViews(): void {
    this.jp = this.view(this.jacp); this.jr = this.view(this.jacr);
    this.qpos = this.data.qpos; this.sitePos = this.data.site_xpos; this.siteMat = this.data.site_xmat;
  }

  private view(buf: any): Float64Array {
    return typeof buf.GetView === 'function' ? buf.GetView() : buf.getView();
  }

  /** Re-reads the views after WASM memory growth detached them. */
  private sync(): void {
    if (this.qpos.buffer.byteLength === 0 || this.jp.buffer.byteLength === 0 || this.sitePos.buffer.byteLength === 0) this.readViews();
  }

  /**
   * Moves the tip toward `target` (3 values, m), starting from `qStart` (7 joints). Writes the best joint
   * configuration found, its tip error and the iteration count into `out`. `data.qpos` of the live trial is not read
   * or written.
   */
  solve(target: ArrayLike<number>, qStart: ArrayLike<number>, out: IkResult): IkResult {
    if (this.disposed) throw new Error('IkSolver was disposed');
    const mj = this.mj, model = this.model, nv = this.nv;
    const q = this.q;
    for (let j = 0; j < NJ; j++) q[j] = qStart[j] as number;
    const best = out.q;
    for (let j = 0; j < NJ; j++) best[j] = qStart[j] as number;
    out.error = Infinity; out.iterations = 0; out.converged = false;
    const tx = target[0] as number, ty = target[1] as number, tz = target[2] as number;
    const tiltTol = Math.sin(IK.tiltTol);
    let bestErr = Infinity;
    const J = this.J, e = this.e, dq = this.dq;

    for (let it = 0; it <= IK.maxIterations; it++) {
      this.sync();
      for (let j = 0; j < NJ; j++) this.qpos[j] = q[j] as number;
      mj.mj_kinematics(model, this.data);
      mj.mj_comPos(model, this.data);
      const s = 3 * this.site;
      const ex = tx - (this.sitePos[s] as number), ey = ty - (this.sitePos[s + 1] as number), ez = tz - (this.sitePos[s + 2] as number);
      const err = Math.sqrt(ex * ex + ey * ey + ez * ez);
      // the tip axis is column 3 of the site frame; the wanted axis is (0, 0, -1)
      const ax = this.siteMat[9 * this.site + 2] as number, ay = this.siteMat[9 * this.site + 5] as number;
      const tilt = Math.sqrt(ax * ax + ay * ay);
      if (!Number.isFinite(err) || !Number.isFinite(tilt)) { return fail(out, qStart); }
      if (err < bestErr) {
        bestErr = err;
        for (let j = 0; j < NJ; j++) best[j] = q[j] as number;
        out.error = err;
      }
      out.iterations = it;
      if (err <= IK.posTol && tilt <= tiltTol) { out.converged = true; break; }
      if (it === IK.maxIterations) break;

      mj.mj_jacSite(model, this.data, this.jacp, this.jacr, this.site);
      this.sync();
      const w = IK.tiltWeight;
      for (let j = 0; j < NJ; j++) {
        J[j] = this.jp[j] as number;
        J[NJ + j] = this.jp[nv + j] as number;
        J[2 * NJ + j] = this.jp[2 * nv + j] as number;
        J[3 * NJ + j] = w * (this.jr[j] as number);
        J[4 * NJ + j] = w * (this.jr[nv + j] as number);
      }
      for (let k = 0; k < NR * NJ; k++) if (!Number.isFinite(J[k] as number)) return fail(out, qStart);
      e[0] = ex; e[1] = ey; e[2] = ez; e[3] = -w * ay; e[4] = w * ax;

      const lambda = adaptiveLambda(manipulability(J));
      if (!dlsStep(J, e, lambda, dq)) return fail(out, qStart);
      let big = 0;
      for (let j = 0; j < NJ; j++) { const a = Math.abs(dq[j] as number); if (a > big) big = a; }
      if (!Number.isFinite(big)) return fail(out, qStart);
      const scale = big > IK.stepLimit ? IK.stepLimit / big : 1;
      for (let j = 0; j < NJ; j++) {
        let v = (q[j] as number) + scale * (dq[j] as number);
        const lo = this.lo[j] as number, hi = this.hi[j] as number;
        if (v < lo) v = lo; else if (v > hi) v = hi;
        q[j] = v;
      }
    }
    return out;
  }

  /** Deletes the scratch MjData and both Jacobian buffers. Calling it again does nothing. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.jacp.delete(); this.jacr.delete(); this.data.delete();
  }
}

function fail(out: IkResult, qStart: ArrayLike<number>): IkResult {
  for (let j = 0; j < NJ; j++) out.q[j] = qStart[j] as number;
  out.error = Infinity; out.converged = false;
  return out;
}
