// Pose frame math. Scalar only, no allocation. MuJoCo order is wxyz, three.js is xyzw.

/** Reads body `b` of frame `f` into out = [px, py, pz, qx, qy, qz, qw] (three.js order). */
export function frameToTRS(frames: ArrayLike<number>, nbody: number, f: number, b: number, out: Float64Array): void {
  const o = (f * nbody + b) * 7;
  out[0] = frames[o] as number; out[1] = frames[o + 1] as number; out[2] = frames[o + 2] as number;
  out[3] = frames[o + 4] as number; out[4] = frames[o + 5] as number; out[5] = frames[o + 6] as number;
  out[6] = frames[o + 3] as number;
}

/** Column-major 4x4 from translation and unit quaternion (scale 1). */
export function writeMatrixTRS(
  out: ArrayLike<number> & { [i: number]: number }, off: number,
  px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number,
): void {
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  out[off] = 1 - 2 * (yy + zz); out[off + 1] = 2 * (xy + wz); out[off + 2] = 2 * (xz - wy); out[off + 3] = 0;
  out[off + 4] = 2 * (xy - wz); out[off + 5] = 1 - 2 * (xx + zz); out[off + 6] = 2 * (yz + wx); out[off + 7] = 0;
  out[off + 8] = 2 * (xz + wy); out[off + 9] = 2 * (yz - wx); out[off + 10] = 1 - 2 * (xx + yy); out[off + 11] = 0;
  out[off + 12] = px; out[off + 13] = py; out[off + 14] = pz; out[off + 15] = 1;
}

/**
 * Body pose of frame f blended toward f+1 by alpha: lerp position, nlerp orientation with the
 * shortest-arc sign rule. out = [px, py, pz, qx, qy, qz, qw].
 */
export function nlerp(
  frames: ArrayLike<number>, nbody: number, f0: number, f1: number, b: number, alpha: number, out: Float64Array,
): void {
  const o0 = (f0 * nbody + b) * 7;
  const o1 = (f1 * nbody + b) * 7;
  const a = alpha;
  const ia = 1 - a;
  out[0] = ia * (frames[o0] as number) + a * (frames[o1] as number);
  out[1] = ia * (frames[o0 + 1] as number) + a * (frames[o1 + 1] as number);
  out[2] = ia * (frames[o0 + 2] as number) + a * (frames[o1 + 2] as number);
  const w0 = frames[o0 + 3] as number, x0 = frames[o0 + 4] as number, y0 = frames[o0 + 5] as number, z0 = frames[o0 + 6] as number;
  const w1 = frames[o1 + 3] as number, x1 = frames[o1 + 4] as number, y1 = frames[o1 + 5] as number, z1 = frames[o1 + 6] as number;
  const dot = w0 * w1 + x0 * x1 + y0 * y1 + z0 * z1;
  const s = dot < 0 ? -1 : 1;
  let qw = ia * w0 + a * s * w1;
  let qx = ia * x0 + a * s * x1;
  let qy = ia * y0 + a * s * y1;
  let qz = ia * z0 + a * s * z1;
  const n = Math.hypot(qw, qx, qy, qz);
  if (n > 1e-12) { qw /= n; qx /= n; qy /= n; qz /= n; } else { qw = 1; qx = 0; qy = 0; qz = 0; }
  out[3] = qx; out[4] = qy; out[5] = qz; out[6] = qw;
}

/** Rotates v by the wxyz quaternion q (unit). Writes into out. */
export function quatRotateWXYZ(
  qw: number, qx: number, qy: number, qz: number, vx: number, vy: number, vz: number, out: Float64Array,
): void {
  // t = 2 q.xyz x v ; v' = v + w t + q.xyz x t
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
}
