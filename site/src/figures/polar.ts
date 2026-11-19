// Polar geometry for the G1 stability map. Pure: used at build time to draw the SVG and in the browser to redraw it.
// 0 deg is at the top (the robot's heading). Angles count counterclockwise, matching push.angle: 90 deg is a push
// from the robot's left, drawn on the left. Radius is linear in force.
import type { MapCell } from '../build/data';

export interface PolarSpec { cx: number; cy: number; radius: number; maxN: number; halfWidthDeg: number }

export const DEFAULT_SPEC: PolarSpec = { cx: 280, cy: 270, radius: 215, maxN: 300, halfWidthDeg: 5 };

const rad = (deg: number): number => ((-deg - 90) * Math.PI) / 180;

/** Radius in px of a force, clamped to the outer ring. */
export function radiusOf(spec: PolarSpec, forceN: number): number {
  return (Math.max(0, Math.min(forceN, spec.maxN)) / spec.maxN) * spec.radius;
}

export function polarPoint(spec: PolarSpec, dirDeg: number, forceN: number): { x: number; y: number } {
  const r = radiusOf(spec, forceN);
  return { x: spec.cx + r * Math.cos(rad(dirDeg)), y: spec.cy + r * Math.sin(rad(dirDeg)) };
}

/** Inverse of polarPoint: direction in [0, 360) and force in N. */
export function fromPolar(spec: PolarSpec, x: number, y: number): { dirDeg: number; forceN: number } {
  const dx = x - spec.cx;
  const dy = y - spec.cy;
  const deg = -((Math.atan2(dy, dx) * 180) / Math.PI) - 90;
  return { dirDeg: ((deg % 360) + 360) % 360, forceN: (Math.hypot(dx, dy) / spec.radius) * spec.maxN };
}

const f = (n: number): string => n.toFixed(2);

/** A wedge from the centre to the force, spanning dir +- halfWidth. */
export function wedgePath(spec: PolarSpec, dirDeg: number, forceN: number): string {
  const r = radiusOf(spec, forceN);
  if (r <= 0) return `M${f(spec.cx)} ${f(spec.cy)}Z`;
  const a = polarPoint({ ...spec, maxN: spec.maxN }, dirDeg - spec.halfWidthDeg, forceN);
  const b = polarPoint(spec, dirDeg + spec.halfWidthDeg, forceN);
  return `M${f(spec.cx)} ${f(spec.cy)}L${f(a.x)} ${f(a.y)}A${f(r)} ${f(r)} 0 0 0 ${f(b.x)} ${f(b.y)}Z`;
}

export interface DirectionCell { phase: number; heldN: number; brokeN: number }
export interface DirectionData { dirDeg: number; cells: DirectionCell[]; meanHeldN: number }

/** Per direction and stride phase: the weakest of the seeds (smallest held force). Sorted by direction, then phase. */
export function groupByDirection(cells: MapCell[]): DirectionData[] {
  const dirs = new Map<number, Map<number, DirectionCell>>();
  const sums = new Map<number, { s: number; n: number }>();
  for (const c of cells) {
    const byPhase = dirs.get(c.dirDeg) ?? new Map<number, DirectionCell>();
    const cur = byPhase.get(c.phase);
    if (!cur || c.heldN < cur.heldN) byPhase.set(c.phase, { phase: c.phase, heldN: c.heldN, brokeN: c.brokeN });
    dirs.set(c.dirDeg, byPhase);
    const s = sums.get(c.dirDeg) ?? { s: 0, n: 0 };
    s.s += c.heldN; s.n += 1;
    sums.set(c.dirDeg, s);
  }
  return [...dirs.keys()].sort((a, b) => a - b).map((d) => ({
    dirDeg: d,
    cells: [...(dirs.get(d) as Map<number, DirectionCell>).values()].sort((a, b) => a.phase - b.phase),
    meanHeldN: (sums.get(d) as { s: number; n: number }).s / (sums.get(d) as { s: number; n: number }).n,
  }));
}

/** The cell that sets a direction's boundary: the smallest held force, over all phases (or only `phase`). */
export function weakestCell(d: DirectionData, phase?: number): DirectionCell | undefined {
  const pool = phase === undefined ? d.cells : d.cells.filter((c) => c.phase === phase);
  return pool.reduce<DirectionCell | undefined>((m, c) => (!m || c.heldN < m.heldN ? c : m), undefined);
}

/** The sentence the hover readout and the text alternative use. */
export function describeDirection(d: DirectionData, phase?: number): string {
  const w = weakestCell(d, phase);
  if (!w) return `${d.dirDeg}°: no data for this stride phase.`;
  const where = phase === undefined ? `weakest stride phase ${w.phase}` : `stride phase ${phase}`;
  return `${d.dirDeg}°: holds ${w.heldN.toFixed(1)} N, breaks at ${w.brokeN.toFixed(1)} N (${where}). Mean over phases and seeds ${d.meanHeldN.toFixed(1)} N.`;
}
