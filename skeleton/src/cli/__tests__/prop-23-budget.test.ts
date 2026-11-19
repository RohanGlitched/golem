import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toFalsifyOptions } from '../service.js';
import type { RunOptions } from '../types.js';
import { GREEN_REQUIREMENTS, createHarness } from '../../../test/support/harness.js';
import { propConfig } from '../../../test/support/prop.js';
import { falsify } from '../../falsify/index.js';

const kinds = ['test', 'gate', 'mcp-run', 'mcp-falsify'] as const;
const arb = fc.record({
  kind: fc.constantFrom(...kinds),
  budget: fc.option(fc.integer({ min: 1, max: 1024 }), { nil: undefined }),
  timeS: fc.option(fc.double({ min: 0.001, max: 600, noNaN: true }), { nil: undefined }),
  seed: fc.option(fc.integer({ min: 1, max: 0xffffffff }), { nil: undefined }),
  cfgSeed: fc.option(fc.integer({ min: 0, max: 0xffffffff }), { nil: undefined }),
  pinned: fc.integer({ min: 0, max: 6 }),
  mode: fc.constantFrom('full' as const, 'random-only' as const),
});

describe('Property 23: flags map to the right budget', () => {
  // Feature: golem-kit, Property 23: Flags map to the right budget
  it('gives maxTrials and maxWallMs per budget kind, both limits when both flags are given, and the right seed', () => {
    fc.assert(fc.property(arb, (c) => {
      const o: RunOptions = {
        mode: c.mode, budgetKind: c.kind,
        ...(c.budget !== undefined ? { budget: c.budget } : {}), ...(c.timeS !== undefined ? { timeS: c.timeS } : {}), ...(c.seed !== undefined ? { searchSeed: c.seed } : {}),
      };
      const r = toFalsifyOptions(o, { config: { app: 'a', requirements: [], ...(c.cfgSeed !== undefined ? { searchSeed: c.cfgSeed } : {}) } }, c.pinned, 'tiny');
      const flagged = c.budget !== undefined || c.timeS !== undefined;
      if (c.kind === 'test' || c.kind === 'gate') {
        expect(r.budget.maxTrials).toBe(c.budget ?? (flagged ? undefined : c.kind === 'gate' ? 24 + c.pinned : 64));
        expect(r.budget.maxWallMs).toBe(c.timeS !== undefined ? c.timeS * 1000 : undefined);
      } else if (c.kind === 'mcp-run') {
        expect(r.budget).toEqual({ maxTrials: c.budget ?? 24 });
      } else {
        expect(r.budget).toEqual({ maxTrials: (c.budget ?? 24) + c.pinned });
      }
      expect(r.searchSeed).toBe(c.seed ?? c.cfgSeed ?? 1);
      expect(r.mode).toBe(c.mode);
      expect(r.appId).toBe('tiny');
    }), propConfig);
  });

  it('passes the seed database to the falsifier as a read-only reader', async () => {
    const seen: object[] = [];
    const h = createHarness({
      requirements: GREEN_REQUIREMENTS,
      falsifyImpl: (async (req, pool, opts) => { seen.push(opts.seedDb as object); return falsify(req, pool, opts); }) as typeof falsify,
    });
    await h.run('test', '--budget', '4');
    expect(seen).toHaveLength(3);
    for (const db of seen) {
      expect(Object.keys(db)).toEqual(['read']);
    }
  });
});
