// Shove maths: plane through the grab point, ray hit, spring force, key push direction.
import type { V3 } from '../types.js';

export const FORCE_CAP = 400;

/** Horizontal unit normal of the Shove_Plane, or null when the camera looks straight down. */
export function shovePlaneNormal(dirCam: V3): V3 | null {
  const h = Math.hypot(dirCam[0], dirCam[1]);
  if (h < 1e-6) return null;
  return [dirCam[0] / h, dirCam[1] / h, 0];
}

/** Ray O + t d against the plane through G with normal n. Null when parallel or behind. */
export function rayPlane(O: V3, d: V3, G: V3, n: V3): V3 | null {
  const nd = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
  if (Math.abs(nd) < 1e-9) return null;
  const t = (n[0] * (G[0] - O[0]) + n[1] * (G[1] - O[1]) + n[2] * (G[2] - O[2])) / nd;
  if (t < 0) return null;
  return [O[0] + t * d[0], O[1] + t * d[1], O[2] + t * d[2]];
}

export function springForce(G: V3, target: V3, k: number, cap = FORCE_CAP): V3 {
  let fx = k * (target[0] - G[0]), fy = k * (target[1] - G[1]), fz = k * (target[2] - G[2]);
  const m = Math.hypot(fx, fy, fz);
  if (m > cap) { const s = cap / m; fx *= s; fy *= s; fz *= s; }
  return [fx, fy, fz];
}

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/** Camera-relative push direction in the horizontal plane (unit), or null with a vertical camera. */
export function keyPushDirection(key: ArrowKey, dirCam: V3): V3 | null {
  const h = Math.hypot(dirCam[0], dirCam[1]);
  if (h < 1e-6) return null;
  const fx = dirCam[0] / h, fy = dirCam[1] / h;
  const rx = fy, ry = -fx;
  switch (key) {
    case 'ArrowUp': return [fx, fy, 0];
    case 'ArrowDown': return [-fx, -fy, 0];
    case 'ArrowRight': return [rx, ry, 0];
    case 'ArrowLeft': return [-rx, -ry, 0];
  }
}

export function directionName(key: ArrowKey): string {
  return { ArrowUp: 'far side', ArrowDown: 'near side', ArrowLeft: 'left', ArrowRight: 'right' }[key];
}

export function keyPushSteps(simDt: number): number { return Math.round(0.2 / simDt); }
export const KEY_PUSH_FORCE = 100;
