import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { memoryFileSystem } from './fs.js';
import { canonicalJson, createSeedDatabase } from './seed-db.js';
import type { PinnedSeedEntry } from './types.js';
import { arbEntry } from './seed-db.arb.js';

describe('seed database atomic writes', () => {
  // Feature: golem-falsify, Property 31: Atomic writes
  it('a failure at writeFile or rename keeps the old file, leaves no temp file, and names the path', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbEntry.map((e) => ({ ...e, reqId: 'R1' })), { maxLength: 4 }),
        fc.array(arbEntry.map((e) => ({ ...e, reqId: 'R1' })), { minLength: 1, maxLength: 4 }),
        fc.constantFrom('writeFile' as const, 'rename' as const, 'mkdir' as const),
        async (first, second, method) => {
          const fs = memoryFileSystem();
          const db = createSeedDatabase(fs);
          await db.write('app', 'R1', first);
          const path = '.golem/seeds/app/R1.json';
          const before = fs.files.get(path);
          fs.failOn(method, 1);
          await expect(db.write('app', 'R1', second)).rejects.toThrow(/\.golem\/seeds\/app\/R1\.json/);
          expect(fs.files.get(path)).toBe(before);
          expect([...fs.files.keys()]).toEqual([path]);
        },
      ),
      { numRuns: 200 },
    );
  });
});