import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrialSpec } from 'golem-spec';
import { mapLine, runMap } from './map-g1.js';
import { readJsonl } from './core/jsonl.js';
import type { MapParams, MapRow } from './core/map.js';

const params: MapParams = { line: 'x', dirs: 4, phases: 2, seeds: 1, steps: 8, fmax: 400 };

/** A synthetic pool: the policy survives pushes below 100 N, plus 20 N for each direction index. */
function fakePool(counter: { trials: number }) {
  return {
    size: 3,
    async run(specs: TrialSpec[]) {
      counter.trials += specs.length;
      return specs.map((s) => {
        const dir = Math.round(((s.scenario['push.angle'] ?? 0) / (2 * Math.PI)) * 4);
        return { spec: s, robustness: 100 + 20 * dir - (s.scenario['push.force'] ?? 0), worstAt: 0, unit: 'm', wallMs: 0 };
      });
    },
  };
}

describe('runMap', () => {
  it('writes one row per cell with the bisected bound, and resumes without rerunning cells', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'golem-map-'));
    try {
      const outPath = join(dir, 'g1-map.jsonl');
      const c = { trials: 0 };
      const base = { params, appId: 'stagger', reqId: '1.1', pool: fakePool(c), outPath, log: () => undefined, now: () => 0 };
      const rows = await runMap(base);
      expect(rows).toHaveLength(8);
      const r90 = readJsonl<MapRow>(outPath).find((r) => r.dirDeg === 90 && r.phase === 0)!;
      expect(r90.heldN).toBeLessThanOrEqual(120);
      expect(r90.brokeN! - r90.heldN).toBeCloseTo(400 / 256, 9);
      expect(c.trials).toBe(8 * 9);
      await runMap(base);
      expect(c.trials).toBe(8 * 9);
      expect(readJsonl(outPath)).toHaveLength(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('runs only the chosen directions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'golem-map-'));
    try {
      const rows = await runMap({ params, appId: 'stagger', reqId: '1.1', pool: fakePool({ trials: 0 }), outPath: join(dir, 'm.jsonl'), dirIndices: [1], log: () => undefined, now: () => 0 });
      expect(new Set(rows.map((r) => r.dirDeg))).toEqual(new Set([90]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the map requirement file', () => {
  it('holds the registered line', () => {
    expect(mapLine()).toBe('WHEN the pelvis is pushed with up to 400 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s');
  });
});