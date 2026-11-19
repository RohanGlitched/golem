import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { memoryFileSystem } from './fs.js';
import { canonicalJson, createSeedDatabase } from './seed-db.js';
import type { PinnedSeedEntry } from './types.js';
import { arbEntry } from './seed-db.arb.js';

describe('seed database round trip', () => {
  // Feature: golem-falsify, Property 28: Seed database round trip
  it('writing then reading returns a deep-equal list, and an unchanged rewrite keeps the content', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbEntry.map((e) => ({ ...e, reqId: 'R1' })), { maxLength: 6 }), async (entries) => {
        const fs = memoryFileSystem();
        const db = createSeedDatabase(fs);
        await db.write('app', 'R1', entries);
        const back = await db.read('app', 'R1');
        expect(back).toEqual(entries);
        const bytes = fs.files.get('.golem/seeds/app/R1.json');
        await db.write('app', 'R1', back);
        expect(fs.files.get('.golem/seeds/app/R1.json')).toBe(bytes);
        expect(JSON.parse(canonicalJson(entries))).toEqual(entries);
      }),
      { numRuns: 200 },
    );
  });
});