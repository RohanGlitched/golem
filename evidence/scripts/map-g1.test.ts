import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrialSpec } from 'golem-spec';
import { DEFAULT_PARAMS, mapLine, mapParamsFromFlags, runMap } from './map-g1.js';
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

describe('held-out directions and seeds', () => {
  it('runs the cells at the shifted directions with the new first seed, and writes rows that do not collide with the default grid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'golem-map-'));
    try {
      const seen: TrialSpec[] = [];
      const pool = { size: 2, async run(specs: TrialSpec[]) { seen.push(...specs); return specs.map((s) => ({ spec: s, robustness: 100 - (s.scenario['push.force'] ?? 0), worstAt: 0, unit: 'm', wallMs: 0 })); } };
      const outPath = join(dir, 'm.jsonl');
      const rows = await runMap({ params: { ...params, seeds: 2, dirOffset: 45, seedBase: 7000 }, appId: 'stagger', reqId: '1.1', pool, outPath, log: () => undefined, now: () => 0 });
      expect(new Set(rows.map((r) => r.dirDeg))).toEqual(new Set([45, 135, 225, 315]));
      expect(new Set(rows.map((r) => r.seed))).toEqual(new Set([7000, 7001]));
      expect(new Set(seen.map((s) => s.seed))).toEqual(new Set([7000, 7001]));
      const angles = new Set(seen.map((s) => Math.round((s.scenario['push.angle'] as number) * 180 / Math.PI)));
      expect(angles).toEqual(new Set([45, 135, 225, 315]));
      expect(readJsonl(outPath)).toHaveLength(rows.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('mapParamsFromFlags', () => {
  it('gives the default parameters, with neither new key, when the flags are absent', () => {
    expect(mapParamsFromFlags({}, 'x')).toEqual({ line: 'x', ...DEFAULT_PARAMS });
  });
  it('reads --dir-offset as a number and --seed-base as an integer', () => {
    expect(mapParamsFromFlags({ 'dir-offset': '2.5', 'seed-base': '9000' }, 'x')).toMatchObject({ dirOffset: 2.5, seedBase: 9000 });
    expect(mapParamsFromFlags({ 'dir-offset': '-5' }, 'x').dirOffset).toBe(-5);
  });
  it('rejects a flag without a usable value', () => {
    expect(() => mapParamsFromFlags({ 'dir-offset': true }, 'x')).toThrow('--dir-offset needs a number');
    expect(() => mapParamsFromFlags({ 'dir-offset': 'abc' }, 'x')).toThrow('--dir-offset needs a number');
    expect(() => mapParamsFromFlags({ 'seed-base': '1.5' }, 'x')).toThrow('--seed-base needs an integer');
  });
  it('refuses --verify together with either flag, because the committed map uses the default grid', () => {
    expect(() => mapParamsFromFlags({ verify: true, 'seed-base': '5' }, 'x')).toThrow('--verify');
    expect(() => mapParamsFromFlags({ verify: true, 'dir-offset': '5' }, 'x')).toThrow('--verify');
    expect(() => mapParamsFromFlags({ verify: true }, 'x')).not.toThrow();
  });
});

describe('the map requirement file', () => {
  it('holds the registered line', () => {
    expect(mapLine()).toBe('WHEN the pelvis is pushed with up to 400 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s');
  });
});