// Pure geometry helpers shared by the controller, the signals and the lexicon: no MuJoCo, no clock, no random draw.
import {
  BOWL, BOWLS, CANDY_COUNT, D_OV, DROPPED_Z, HAND_START, OVERLAP_STEP, RESTING_SPEED, TABLE, TRAY, WORKSPACE, WORKSPACE_CENTRE,
} from './constants';

// ---------------------------------------------------------------- candy classification

export interface CandyState {
  x: number; y: number; z: number;
  /** Linear speed (m/s). */
  speed: number;
  /** Colour index 0 (orange), 1 (purple), 2 (green): the index of the bowl it belongs in. */
  colour: number;
  active: boolean;
}

export interface CandyCounts { sorted: number; misplaced: number; droppedOutside: number; active: number }

export function makeCandyStates(): CandyState[] {
  return Array.from({ length: CANDY_COUNT }, () => ({ x: 0, y: 0, z: 0, speed: 0, colour: 0, active: true }));
}

/** Index of the bowl whose volume holds the point, or -1. */
export function bowlAt(x: number, y: number, z: number): number {
  if (!(z >= 0 && z <= BOWL.zMax)) return -1;
  for (let b = 0; b < BOWLS.length; b++) {
    const bowl = BOWLS[b]!;
    if (Math.abs(x - bowl.x) <= BOWL.innerHalf && Math.abs(y - bowl.y) <= BOWL.innerHalf) return b;
  }
  return -1;
}

export function inTray(x: number, y: number): boolean {
  return x >= TRAY.xMin && x <= TRAY.xMax && y >= TRAY.yMin && y <= TRAY.yMax;
}

/**
 * Counts the candies. A candy is resting at 0.05 m/s or less. `sorted`: resting in the bowl of its colour.
 * `misplaced`: resting in another bowl. `droppedOutside`: low (z at most 0.04 m), in no bowl and outside the tray,
 * which includes the floor. Inactive candies count nowhere except in `active`.
 */
export function classifyCandies(c: readonly CandyState[], out: CandyCounts): CandyCounts {
  let sorted = 0, misplaced = 0, dropped = 0, active = 0;
  for (let i = 0; i < c.length; i++) {
    const s = c[i] as CandyState;
    if (!s.active) continue;
    active++;
    const b = bowlAt(s.x, s.y, s.z);
    if (b >= 0) {
      if (s.speed <= RESTING_SPEED) { if (b === s.colour) sorted++; else misplaced++; }
    } else if (s.z <= DROPPED_Z && !inTray(s.x, s.y)) {
      dropped++;
    }
  }
  out.sorted = sorted; out.misplaced = misplaced; out.droppedOutside = dropped; out.active = active;
  return out;
}

/** True when the point lies inside the Workspace box. */
export function inWorkspace(x: number, y: number, z: number): boolean {
  return x >= WORKSPACE.xMin && x <= WORKSPACE.xMax && y >= WORKSPACE.yMin && y <= WORKSPACE.yMax
    && z >= WORKSPACE.zMin && z <= WORKSPACE.zMax;
}

// ---------------------------------------------------------------- hand path

export interface HandValues { angle: number; speed: number; entry: number; height: number }

/** Where the ray from the workspace centre at azimuth `theta` leaves the Table (x, y into out[0], out[1]). */
export function tableEdgePoint(theta: number, out: Float64Array): void {
  const dx = Math.cos(theta), dy = Math.sin(theta);
  const tx = dx > 0 ? (TABLE.xMax - WORKSPACE_CENTRE.x) / dx : dx < 0 ? (TABLE.xMin - WORKSPACE_CENTRE.x) / dx : Infinity;
  const ty = dy > 0 ? (TABLE.yMax - WORKSPACE_CENTRE.y) / dy : dy < 0 ? (TABLE.yMin - WORKSPACE_CENTRE.y) / dy : Infinity;
  const t = tx < ty ? tx : ty;
  out[0] = WORKSPACE_CENTRE.x + t * dx;
  out[1] = WORKSPACE_CENTRE.y + t * dy;
}

/** Index of the bowl centre nearest to (x, y); the lower index wins a tie. */
export function nearestBowl(x: number, y: number): number {
  let best = 0, bestD = Infinity;
  for (let b = 0; b < BOWLS.length; b++) {
    const bowl = BOWLS[b]!;
    const d = (x - bowl.x) * (x - bowl.x) + (y - bowl.y) * (y - bowl.y);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

const edge = new Float64Array(2);

/**
 * Pose of the Hand (x, y, z, yaw) into `out`. Before the entry (`t - tTrigger < entry`) the Hand is at its start
 * pose. At the entry it appears at the Table edge E on the ray at azimuth `angle`, at `height`, and moves in a
 * straight line toward the centre of the nearest bowl at `speed`, holding there on arrival. Its yaw is `angle`, so
 * the forearm points back toward the edge it came from. The result depends only on the arguments.
 */
export function handPose(out: Float64Array, t: number, tTrigger: number, v: HandValues): void {
  const tau = t - tTrigger - v.entry;
  if (!(tau >= 0)) {
    out[0] = HAND_START.x; out[1] = HAND_START.y; out[2] = HAND_START.z; out[3] = HAND_START.yaw;
    return;
  }
  tableEdgePoint(v.angle, edge);
  const ex = edge[0] as number, ey = edge[1] as number;
  const bowl = BOWLS[nearestBowl(ex, ey)]!;
  const dx = bowl.x - ex, dy = bowl.y - ey;
  const len = Math.sqrt(dx * dx + dy * dy);
  const travelled = Math.min(v.speed * tau, len);
  const k = len > 0 ? travelled / len : 0;
  out[0] = ex + dx * k; out[1] = ey + dy * k; out[2] = v.height; out[3] = v.angle;
}

// ---------------------------------------------------------------- candy placement

/**
 * Shifts later candies along +x in steps of 0.01 m until every pair of centres is at least D_OV (0.036 m) apart
 * horizontally. In place, deterministic. `xy` holds (x, y) of candies 0 to 5. Candy i moves only because of earlier
 * candies (j < i), using their already shifted positions.
 */
export function resolveOverlaps(xy: Float64Array): void {
  const n = xy.length / 2;
  for (let i = 1; i < n; i++) {
    for (let guard = 0; guard < 1000; guard++) {
      let clash = false;
      for (let j = 0; j < i; j++) {
        const dx = (xy[2 * i] as number) - (xy[2 * j] as number), dy = (xy[2 * i + 1] as number) - (xy[2 * j + 1] as number);
        if (Math.sqrt(dx * dx + dy * dy) < D_OV) { clash = true; break; }
      }
      if (!clash) break;
      xy[2 * i] = (xy[2 * i] as number) + OVERLAP_STEP;
    }
  }
}

// ---------------------------------------------------------------- candy selection

/**
 * The next candy to pick: among the active, non-skipped candies on the tray (centre inside the tray rectangle and
 * z at most 0.04 m), the one with the smallest floor(1000 * distance from the base axis), the lower id on ties.
 * -1 when there is none. `pos` holds (x, y, z) of candies 0 to 5.
 */
export function chooseCandy(pos: ArrayLike<number>, active: ArrayLike<number>, skip: ArrayLike<number>): number {
  let best = -1, bestQ = Infinity;
  for (let i = 0; i < CANDY_COUNT; i++) {
    if (!active[i] || skip[i]) continue;
    const x = pos[3 * i] as number, y = pos[3 * i + 1] as number, z = pos[3 * i + 2] as number;
    if (!(inTray(x, y) && z <= DROPPED_Z)) continue;
    const q = Math.floor(1000 * Math.sqrt(x * x + y * y));
    if (q < bestQ) { bestQ = q; best = i; }
  }
  return best;
}
