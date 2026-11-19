// Experiment 2 pure core: bisection for the largest push that holds, the cell grid and the summary.
export interface MapRow { dirDeg: number; phase: number; seed: number; heldN: number; brokeN: number | null; trials: number }

export interface MapParams { line: string; dirs: number; phases: number; seeds: number; steps: number; fmax: number }

export interface Cell { dirIndex: number; phaseIndex: number; seedIndex: number }

export const BASE_SEED = 1000;

/** Directions outermost, then phases, then seeds; `dirIndices` restricts the directions. */
export function planCells(p: Pick<MapParams, 'dirs' | 'phases' | 'seeds'>, dirIndices?: readonly number[]): Cell[] {
  const out: Cell[] = [];
  for (let d = 0; d < p.dirs; d++) {
    if (dirIndices && !dirIndices.includes(d)) continue;
    for (let ph = 0; ph < p.phases; ph++) for (let s = 0; s < p.seeds; s++) out.push({ dirIndex: d, phaseIndex: ph, seedIndex: s });
  }
  return out;
}

export const cellKey = (r: { dirDeg: number; phase: number; seed: number }): string => `${r.dirDeg}|${r.phase}|${r.seed}`;

export function cellScenario(c: Cell, p: Pick<MapParams, 'dirs' | 'phases'>): { dirDeg: number; phase: number; seed: number; angle: number } {
  return { dirDeg: (360 * c.dirIndex) / p.dirs, phase: c.phaseIndex / p.phases, seed: BASE_SEED + c.seedIndex, angle: (2 * Math.PI * c.dirIndex) / p.dirs };
}

/**
 * The largest force on [0, fmax] that holds, by `steps` bisection steps. `robustnessAt(force)` is >= 0 when the
 * requirement holds. One trial at fmax first: if it holds, the cell is `heldN = fmax` and `brokeN = null`.
 */
export async function bisectCell(robustnessAt: (force: number) => Promise<number>, fmax: number, steps: number): Promise<{ heldN: number; brokeN: number | null; trials: number }> {
  let lo = 0;
  let hi = fmax;
  let trials = 1;
  if ((await robustnessAt(hi)) >= 0) return { heldN: fmax, brokeN: null, trials };
  for (let k = 0; k < steps; k++) {
    const mid = (lo + hi) / 2;
    trials++;
    if ((await robustnessAt(mid)) >= 0) lo = mid; else hi = mid;
  }
  return { heldN: lo, brokeN: hi, trials };
}

export interface DirSummary { dirDeg: number; minHeldN: number; weakestPhase: number; meanHeldN: number }

export interface MapSummary {
  meta: MapParams & { cells: number; trials: number; seconds: number; weakest: DirSummary; strongest: DirSummary };
  summary: DirSummary[];
}

export const sortRows = (rows: readonly MapRow[]): MapRow[] =>
  [...rows].sort((a, b) => a.dirDeg - b.dirDeg || a.phase - b.phase || a.seed - b.seed);

/** Per direction the weakest phase (first minimum in the order given), overall weakest and strongest direction. */
export function summarizeMap(rows: readonly MapRow[], params: MapParams, seconds: number): MapSummary {
  const byDir = new Map<number, MapRow[]>();
  for (const r of rows) (byDir.get(r.dirDeg) ?? byDir.set(r.dirDeg, []).get(r.dirDeg)!).push(r);
  const summary = [...byDir.entries()].sort((a, b) => a[0] - b[0]).map(([dirDeg, rs]) => {
    const weakest = rs.reduce((a, b) => (b.heldN < a.heldN ? b : a));
    return { dirDeg, minHeldN: weakest.heldN, weakestPhase: weakest.phase, meanHeldN: rs.reduce((s, r) => s + r.heldN, 0) / rs.length };
  });
  const weakest = summary.reduce((a, b) => (b.minHeldN < a.minHeldN ? b : a));
  const strongest = summary.reduce((a, b) => (b.minHeldN > a.minHeldN ? b : a));
  return {
    meta: { ...params, cells: rows.length, trials: rows.reduce((s, r) => s + r.trials, 0), seconds, weakest, strongest },
    summary,
  };
}
export interface RowComparison { compared: number; missing: string[]; mismatched: { key: string; got: MapRow; want: MapRow }[]; equal: boolean }

/** Compares `got` with the committed rows `want`, cell by cell (heldN, brokeN, trials), for the cells present in `got`. */
export function compareRows(got: readonly MapRow[], want: readonly MapRow[]): RowComparison {
  const w = new Map(want.map((r) => [cellKey(r), r]));
  const missing: string[] = [];
  const mismatched: RowComparison['mismatched'] = [];
  for (const g of got) {
    const ref = w.get(cellKey(g));
    if (!ref) { missing.push(cellKey(g)); continue; }
    if (g.heldN !== ref.heldN || g.brokeN !== ref.brokeN || g.trials !== ref.trials) mismatched.push({ key: cellKey(g), got: g, want: ref });
  }
  return { compared: got.length, missing, mismatched, equal: got.length > 0 && missing.length === 0 && mismatched.length === 0 };
}