import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { memoryFileSystem } from './fs.js';
import { canonicalJson, createSeedDatabase } from './seed-db.js';
import type { PinnedSeedEntry } from './types.js';
import { arbEntry } from './seed-db.arb.js';

import { counterexampleEquals } from './seed-db.js';

describe('seed database dedupe', () => {
  // Feature: golem-falsify, Property 29: Seed database dedupe and canonical form
  it('stores no two equal counterexamples, keeps first-seen order, and writes canonical bytes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbEntry.map((e) => ({ ...e, reqId: 'R1' })), { minLength: 1, maxLength: 5 }),
        fc.array(fc.nat(4), { maxLength: 6 }),
        async (base, repeats) => {
          const stream: PinnedSeedEntry[] = [...base];
          for (const r of repeats) {
            const src = base[r % base.length] as PinnedSeedEntry;
            stream.push({ ...src, robustness: src.robustness - 1, shrunk: !src.shrunk, foundAfter: src.foundAfter + 1 });
          }
          const fs = memoryFileSystem();
          const db = createSeedDatabase(fs);
          for (const e of stream) await db.add('app', e);
          const stored = await db.read('app', 'R1');
          for (let i = 0; i < stored.length; i++) {
            for (let j = i + 1; j < stored.length; j++) expect(counterexampleEquals(stored[i]!, stored[j]!)).toBe(false);
          }
          const firstSeen: PinnedSeedEntry[] = [];
          for (const e of stream) if (!firstSeen.some((x) => counterexampleEquals(x, e))) firstSeen.push(e);
          expect(stored).toEqual(firstSeen);
          const a = canonicalJson(stored);
          expect(canonicalJson(stored)).toBe(a);
          expect(a.endsWith('\n') && !a.endsWith('\n\n')).toBe(true);
          expect(a.startsWith('[\n  {\n    "')).toBe(true);
          expect(a).not.toMatch(/\t/);
          for (const line of a.trimEnd().split('\n')) expect((line.length - line.trimStart().length) % 2).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});