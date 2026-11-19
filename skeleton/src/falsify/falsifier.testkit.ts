// Shared generators and a logging pool for the falsifier property tests.
import fc from 'fast-check';
import type { ScenarioSpace, TrialSpec } from './contract.js';
import type { FalsifyOptions, PinnedSeedEntry } from './types.js';
import { memoryFileSystem, type MemoryFileSystem } from './fs.js';
import { createSeedDatabase, type SeedDatabase } from './seed-db.js';
import { arbSpace, arbSynthetic, directPool, makeSynthetic, scenarioFromFractions, syntheticTrialFn, type DirectPool, type DirectPoolOptions, type SynthSpec } from './testing.js';

export interface LoggedTrial { spec: TrialSpec; robustness: number }

export function loggingPool(spec: SynthSpec, o?: DirectPoolOptions): { pool: DirectPool; log: LoggedTrial[] } {
  const fn = syntheticTrialFn(makeSynthetic(spec));
  const log: LoggedTrial[] = [];
  const pool = directPool((s) => {
    const r = fn(s);
    log.push({ spec: s, robustness: r.robustness });
    return r;
  }, o);
  return { pool, log };
}

export interface RunCase {
  space: ScenarioSpace;
  synth: SynthSpec;
  maxTrials: number;
  searchSeed: number;
  g1: number;
  mode: 'full' | 'random-only';
}

export const arbRunCase: fc.Arbitrary<RunCase> = arbSpace
  .chain((space) => fc.record({
    space: fc.constant(space),
    synth: arbSynthetic(space),
    maxTrials: fc.integer({ min: 1, max: 120 }),
    searchSeed: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
    g1: fc.integer({ min: 1, max: 40 }),
    mode: fc.constantFrom('full' as const, 'random-only' as const),
  }));

export const optionsOf = (c: RunCase, extra: Partial<FalsifyOptions> = {}): FalsifyOptions => ({
  appId: 'app', budget: { maxTrials: c.maxTrials }, searchSeed: c.searchSeed, phase1GenerationSize: c.g1, mode: c.mode, ...extra,
});

export const sameVerdict = (a: { ms: number }, b: { ms: number }): [unknown, unknown] => [{ ...a, ms: 0 }, { ...b, ms: 0 }];

export function pinnedEntries(space: ScenarioSpace, rows: { fracs: number[]; robustness: number; seed: number }[]): PinnedSeedEntry[] {
  return rows.map((row) => ({
    reqId: 'R1',
    scenario: scenarioFromFractions(space, row.fracs),
    seed: row.seed,
    robustness: row.robustness,
    shrunk: false,
    foundAfter: 1,
  }));
}

export const arbPinnedRows = fc.array(
  fc.record({
    fracs: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 6 }),
    robustness: fc.integer({ min: -5, max: 5 }),
    seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
  }),
  { maxLength: 5 },
);

export function seedDbOf(entries: unknown[]): { db: SeedDatabase; fs: MemoryFileSystem } {
  const fs = memoryFileSystem({ '.golem/seeds/app/R1.json': JSON.stringify(entries) });
  return { db: createSeedDatabase(fs), fs };
}