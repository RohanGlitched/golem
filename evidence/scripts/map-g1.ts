// Experiment 2: the G1 stability map. For each push direction, stride phase and seed, the largest 0.2 s pelvis push
// the walking policy survives for 3 s, by bisection. Same method as the prototype (see PREREG.md), on the Node pool.
import { readFileSync } from 'node:fs';
import type { TrialPool, TrialSpec } from 'golem-spec';
import { appendJsonl, readJsonl } from './core/jsonl.js';
import { intFlag, numFlag } from './lib/args.js';
import { BASE_SEED, bisectCell, cellKey, cellScenario, planCells, sortRows, summarizeMap, type Cell, type MapParams, type MapRow, type MapSummary } from './core/map.js';

export const MAP_REQUIREMENTS_FILE = new URL('../requirements/map-g1.md', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

export function mapLine(): string {
  const m = /^\d+\.\s+(WHEN .*)$/m.exec(readFileSync(MAP_REQUIREMENTS_FILE, 'utf8'));
  if (!m) throw new Error(`no EARS line in ${MAP_REQUIREMENTS_FILE}`);
  return m[1]!;
}

export const DEFAULT_PARAMS = { dirs: 36, phases: 5, seeds: 3, steps: 8, fmax: 400 } as const;

/**
 * The map parameters from the command line. `--dir-offset <deg>` shifts every direction and `--seed-base <n>` sets the first seed,
 * to re-run the map on held-out directions and seeds. A run that sets neither has exactly the default parameters.
 */
export function mapParamsFromFlags(flags: Record<string, string | true>, line: string): MapParams {
  const dirOffset = numFlag(flags, 'dir-offset');
  const seedBase = flags['seed-base'] !== undefined ? intFlag(flags, 'seed-base', BASE_SEED) : undefined;
  if (flags['verify'] === true && (dirOffset !== undefined || seedBase !== undefined)) {
    throw new Error('--verify compares with the committed map, which uses the default directions and seeds; drop --dir-offset and --seed-base');
  }
  return {
    line,
    dirs: intFlag(flags, 'dirs', DEFAULT_PARAMS.dirs), phases: intFlag(flags, 'phases', DEFAULT_PARAMS.phases),
    seeds: intFlag(flags, 'seeds', DEFAULT_PARAMS.seeds), steps: intFlag(flags, 'steps', DEFAULT_PARAMS.steps),
    fmax: intFlag(flags, 'fmax', DEFAULT_PARAMS.fmax),
    // Only a run that sets them records them, so a default run keeps the committed summary shape.
    ...(dirOffset !== undefined ? { dirOffset } : {}),
    ...(seedBase !== undefined ? { seedBase } : {}),
  };
}

export interface MapRunOptions {
  params: MapParams;
  appId: string;
  reqId: string;
  pool: Pick<TrialPool, 'run' | 'size'>;
  outPath: string;
  dirIndices?: number[];
  concurrency?: number;
  log(s: string): void;
  now(): number;
}

/** Runs the cells that are not in `outPath` yet; returns all rows (old and new). */
export async function runMap(o: MapRunOptions): Promise<MapRow[]> {
  const existing = readJsonl<MapRow>(o.outPath);
  const done = new Set(existing.map(cellKey));
  const todo = planCells(o.params, o.dirIndices).filter((c) => !done.has(cellKey(cellScenario(c, o.params))));
  o.log(`map-g1: ${todo.length} cells to do, ${existing.length} already on disk`);
  const rows = [...existing];
  const t0 = o.now();
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < todo.length) {
      const cell = todo[next++] as Cell;
      const sc = cellScenario(cell, o.params);
      const run = async (force: number): Promise<number> => {
        const spec: TrialSpec = {
          app: o.appId, reqId: o.reqId, seed: sc.seed,
          scenario: { 'push.force': force, 'push.angle': sc.angle, 'push.phase': sc.phase },
        };
        const [r] = await o.pool.run([spec]);
        if (!r) throw new Error('pool returned no result');
        return r.robustness;
      };
      const b = await bisectCell(run, o.params.fmax, o.params.steps);
      const row: MapRow = { dirDeg: sc.dirDeg, phase: sc.phase, seed: sc.seed, heldN: b.heldN, brokeN: b.brokeN, trials: b.trials };
      appendJsonl(o.outPath, row);
      rows.push(row);
      if (rows.length % 10 === 0) o.log(`${rows.length} cells, ${((o.now() - t0) / 1000).toFixed(0)} s`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? o.pool.size) }, lane));
  return rows;
}

export function mapSummary(rows: readonly MapRow[], params: MapParams, seconds: number): MapSummary {
  return summarizeMap(sortRows(rows), params, seconds);
}