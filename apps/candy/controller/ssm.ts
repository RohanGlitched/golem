/**
 * Speed-and-separation monitoring, version 1 (SSM_v1).
 *
 * SSM_v1 measures the separation from the suction-cup TIP ONLY. Every other link of the arm (the forearm, the
 * elbow, the wrist) is unmonitored. This is the known limit of v1, and it is kept on purpose: GOLEM is meant to
 * falsify the requirement "keep every link at least 0.10 m from the hand" against it. Do not add a second
 * distance check, a link argument or any model access here. A broken requirement leads to a controller change in
 * a later spec or an entry in proposals.md, never to a weaker requirement.
 *
 * Both functions are pure: they read no model, no link position and no velocity.
 */
import { HAND, SSM } from '../constants';

/**
 * Distance (m) from the tip to the nearest hand geom: the palm sphere or the forearm capsule.
 * @param tip tip position (x, y, z)
 * @param hand hand pose as the controller reads it (x, y, z, yaw): the palm centre and the forearm direction
 * @returns a distance of at least 0; NaN when any coordinate is NaN, Infinity when one is infinite
 */
export function separation(tip: ArrayLike<number>, hand: ArrayLike<number>): number {
  const tx = tip[0] as number, ty = tip[1] as number, tz = tip[2] as number;
  const px = hand[0] as number, py = hand[1] as number, pz = hand[2] as number, yaw = hand[3] as number;
  const dx = tx - px, dy = ty - py, dz = tz - pz;
  const toPalm = Math.sqrt(dx * dx + dy * dy + dz * dz) - HAND.palmRadius;
  // forearm: segment from the palm centre along (cos yaw, sin yaw, 0) for 0.30 m
  const ux = Math.cos(yaw), uy = Math.sin(yaw);
  let s = dx * ux + dy * uy;
  if (s < 0) s = 0; else if (s > HAND.forearmLength) s = HAND.forearmLength;
  const qx = dx - s * ux, qy = dy - s * uy;
  const toForearm = Math.sqrt(qx * qx + qy * qy + dz * dz) - HAND.forearmRadius;
  const d = toPalm < toForearm ? toPalm : toForearm;
  return d > 0 ? d : (d <= 0 ? 0 : d);   // a NaN passes through
}

/**
 * Speed scale from the separation d (m): 0 at or below the stop distance (or when d is not finite), 1 at or above
 * the slowdown distance, linear in between. Monotone non-decreasing in d.
 */
export function speedScale(d: number): number {
  if (!Number.isFinite(d) || d <= SSM.stop) return 0;
  if (d >= SSM.slowdown) return 1;
  return (d - SSM.stop) / (SSM.slowdown - SSM.stop);
}
