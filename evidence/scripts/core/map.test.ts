import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { bisectCell, cellScenario, compareRows, planCells, sortRows, summarizeMap, type MapParams, type MapRow } from './map.js';
import { parseJsonl } from './jsonl.js';

const results = (f: string): string => new URL(`../../results/${f}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

describe('bisectCell', () => {
  it('finds the threshold of a monotone requirement within fmax / 2^steps, and held < broke', async () => {
    await fc.assert(fc.asyncProperty(fc.double({ min: 0.001, max: 399.9, noNaN: true }), async (thr) => {
      const r = await bisectCell(async (f) => thr - f, 400, 8);
      expect(r.brokeN).not.toBeNull();
      expect(r.heldN).toBeLessThanOrEqual(thr);
      expect(r.brokeN!).toBeGreaterThan(thr);
      expect(r.brokeN! - r.heldN).toBeCloseTo(400 / 256, 9);
      expect(r.trials).toBe(9);
    }), { numRuns: 100 });
  });
  it('stops after one trial when the push at fmax holds', async () => {
    expect(await bisectCell(async () => 1, 400, 8)).toEqual({ heldN: 400, brokeN: null, trials: 1 });
  });
  it('reports 0 N held when nothing holds', async () => {
    expect(await bisectCell(async () => -1, 400, 8)).toMatchObject({ heldN: 0, brokeN: 400 / 256 });
  });
});

describe('planCells and cellScenario', () => {
  it('plans dirs x phases x seeds, or only the chosen directions', () => {
    expect(planCells({ dirs: 36, phases: 5, seeds: 3 })).toHaveLength(540);
    expect(planCells({ dirs: 36, phases: 5, seeds: 3 }, [0, 18])).toHaveLength(30);
  });
  it('maps indices to degrees, stride fraction, radians and trial seed as the prototype did', () => {
    const s = cellScenario({ dirIndex: 18, phaseIndex: 3, seedIndex: 2 }, { dirs: 36, phases: 5 });
    expect(s).toMatchObject({ dirDeg: 180, phase: 0.6, seed: 1002 });
    expect(s.angle).toBeCloseTo(Math.PI, 12);
  });
});

describe('summarizeMap on the committed run', () => {
  const rows = parseJsonl<MapRow>(readFileSync(results('g1-map.jsonl'), 'utf8'));
  const committed = JSON.parse(readFileSync(results('g1-map.summary.json'), 'utf8')) as ReturnType<typeof summarizeMap>;
  const { seconds, ...metaParams } = committed.meta;
  void seconds;
  const params: MapParams = { line: metaParams.line, dirs: metaParams.dirs, phases: metaParams.phases, seeds: metaParams.seeds, steps: metaParams.steps, fmax: metaParams.fmax };

  it('reproduces the committed summary exactly (apart from seconds) from the rows in file order', () => {
    const s = summarizeMap(rows, params, committed.meta.seconds);
    expect(s).toEqual(committed);
  });
  it('gives the same summary when the rows are sorted, which is how a new run orders them', () => {
    const s = summarizeMap(sortRows(rows), params, committed.meta.seconds);
    expect(s).toEqual(committed);
  });
  it('has 540 cells of 9 trials or fewer, and 4,860 trials', () => {
    expect(rows).toHaveLength(540);
    expect(rows.reduce((a, r) => a + r.trials, 0)).toBe(4860);
  });
});

describe('compareRows', () => {
  const a: MapRow = { dirDeg: 0, phase: 0, seed: 1000, heldN: 10, brokeN: 11.5, trials: 9 };
  it('is equal for identical rows and reports a changed bound', () => {
    expect(compareRows([a], [a]).equal).toBe(true);
    const r = compareRows([{ ...a, heldN: 12 }], [a]);
    expect(r.equal).toBe(false);
    expect(r.mismatched).toHaveLength(1);
  });
  it('reports a cell the committed file does not have, and is not equal for an empty run', () => {
    expect(compareRows([{ ...a, dirDeg: 10 }], [a]).missing).toEqual(['10|0|1000']);
    expect(compareRows([], [a]).equal).toBe(false);
  });
});