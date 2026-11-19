import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { falsify } from './falsifier.js';
import { arbPinnedRows, arbRunCase, loggingPool, optionsOf, pinnedEntries, seedDbOf } from './falsifier.testkit.js';
import type { ProgressEvent } from './types.js';

import { arbSpace } from './testing.js';

describe('falsifier Phase 0', () => {
  // Feature: golem-falsify, Property 24: Phase 0 ordering and no writes
  it('runs valid pinned entries in ascending stored robustness (ties in file order), lists invalid ones, and never writes', async () => {
    await fc.assert(
      fc.asyncProperty(arbSpace, arbPinnedRows, fc.array(fc.nat(4), { maxLength: 3 }), fc.array(fc.constantFrom('range', 'extra', 'missing'), { maxLength: 3 }), async (space, rows, at, kinds) => {
        const entries: Record<string, unknown>[] = pinnedEntries(space, rows).map((e) => ({ ...e }));
        const invalidIdx = new Set<number>();
        at.forEach((pos, j) => {
          const i = pos % (entries.length + 1);
          const base = pinnedEntries(space, [{ fracs: [0.5], robustness: 0, seed: 99 + j }])[0]!;
          const sc: Record<string, number> = { ...base.scenario };
          const d = space.dims[0]!;
          if (kinds[j] === 'range') sc[d.name] = d.max + 1 + Math.abs(d.max);
          else if (kinds[j] === 'extra') sc['not.a.dim'] = 1;
          else delete sc[d.name];
          entries.splice(i, 0, { ...base, scenario: sc, robustness: -10 });
        });
        entries.forEach((e, i) => { if (Object.keys(e['scenario'] as object).includes('not.a.dim') || !space.dims.every((d) => (e['scenario'] as Record<string, number>)[d.name] !== undefined && (e['scenario'] as Record<string, number>)[d.name]! >= d.min && (e['scenario'] as Record<string, number>)[d.name]! <= d.max)) invalidIdx.add(i); });
        const valid = entries.map((e, i) => ({ e, i })).filter((x) => !invalidIdx.has(x.i));
        const expected = [...valid].sort((a, b) => (a.e['robustness'] as number) - (b.e['robustness'] as number) || a.i - b.i).map((x) => x.e);
        const { db, fs } = seedDbOf(entries);
        const { pool, log } = loggingPool({ kind: 'const', value: 1 });
        const r = await falsify({ id: 'R1', space }, pool, { appId: 'app', budget: { maxTrials: 200 }, searchSeed: 3, seedDb: db });
        // The seed file is JSON, which stores -0 as 0, so compare against what the file can hold.
        const asStored = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
        expect(log.slice(0, expected.length).map((t) => [t.spec.seed, t.spec.scenario])).toEqual(expected.map((e) => [e['seed'], asStored(e['scenario'])]));
        expect(r.meta.phaseTrials.p0).toBe(expected.length);
        expect(r.meta.skippedPinned.map((s) => s.index)).toEqual([...invalidIdx].sort((a, b) => a - b));
        expect(r.meta.skippedPinned.every((s) => s.reason.length > 0)).toBe(true);
        expect(fs.count('writeFile', 'rename', 'mkdir', 'remove')).toBe(0);
      }),
      { numRuns: 150 },
    );
  });
});