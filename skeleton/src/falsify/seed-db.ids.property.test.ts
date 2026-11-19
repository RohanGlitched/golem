import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { memoryFileSystem } from './fs.js';
import { canonicalJson, createSeedDatabase } from './seed-db.js';
import type { PinnedSeedEntry } from './types.js';
import { arbEntry } from './seed-db.arb.js';

describe('seed database id validation', () => {
  // Feature: golem-falsify, Property 30: Seed database id validation
  it('rejects empty ids and ids with separators, .. or NUL, naming the id, with zero file-system calls', async () => {
    const bad = fc.oneof(
      fc.constant(''),
      fc.tuple(fc.string({ maxLength: 4 }), fc.constantFrom('/', '\\', '..', '\0'), fc.string({ maxLength: 4 })).map(([a, s, b]) => a + s + b),
    );
    const good = fc.constantFrom('stagger', 'candy', 'R2', '2.1');
    await fc.assert(
      fc.asyncProperty(bad, good, fc.boolean(), async (id, ok, appBad) => {
        const fs = memoryFileSystem();
        const db = createSeedDatabase(fs);
        const [app, req] = appBad ? [id, ok] : [ok, id];
        const entry: PinnedSeedEntry = { reqId: req, scenario: { a: 1 }, seed: 1, robustness: -1, shrunk: false, foundAfter: 1 };
        const what = appBad ? /app id/ : /requirement id/;
        await expect(db.read(app, req)).rejects.toThrow(what);
        await expect(db.write(app, req, [])).rejects.toThrow(what);
        await expect(db.add(app, entry)).rejects.toThrow(what);
        expect(() => db.pathFor(app, req)).toThrow(what);
        expect(fs.log).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });
});