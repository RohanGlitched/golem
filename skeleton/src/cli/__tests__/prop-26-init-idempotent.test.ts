import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createHarness } from '../../../test/support/harness.js';
import { installPack } from '../../../test/support/pack-fixture.js';
import { propConfig } from '../../../test/support/prop.js';

const rel = fc.stringMatching(/^[a-z]{1,5}(\/[a-z]{1,5}){0,2}\.(json|md|mjs)$/);
const arbPack = fc.uniqueArray(fc.tuple(rel, fc.string({ maxLength: 30 })), { selector: ([r]) => r, minLength: 1, maxLength: 6 })
  .filter((fs) => !fs.some(([r], i) => fs.some(([q], j) => i !== j && q.startsWith(`${r.replace(/\.[a-z]+$/, '')}/`))));

describe('Property 26: init is idempotent and writes exactly the missing files', () => {
  // Feature: golem-kit, Property 26: Init is idempotent and writes exactly the missing files
  it('writes exactly the missing files, keeps existing ones, and a second run writes nothing and skips every file', async () => {
    await fc.assert(fc.asyncProperty(arbPack, fc.infiniteStream(fc.boolean()), async (files, flags) => {
      const h = createHarness({ seed: false });
      const pack = Object.fromEntries(files.filter(([r]) => r !== 'settings/mcp.json'));
      const rels = Object.keys(pack);
      installPack(h.fs, '/pack', pack);
      const it = flags[Symbol.iterator]();
      const existing = new Map<string, string>();
      for (const r of rels) if (it.next().value === true) { existing.set(r, `mine ${r}`); h.fs.put(h.path(`.kiro/${r}`), `mine ${r}`); }
      const before = new Set(h.fs.list());
      expect(await h.run('init')).toBe(0);
      const written = h.fs.list().filter((p) => !before.has(p) && !p.includes('.tmp-'));
      const expected = [...rels.filter((r) => !existing.has(r)).map((r) => h.path(`.kiro/${r}`)), h.path('golem.config.json')].sort();
      expect(written.sort()).toEqual(expected);
      for (const [r, text] of existing) expect(h.fs.text(h.path(`.kiro/${r}`))).toBe(text);
      const renames = h.fs.log.length;
      h.clearOutput();
      expect(await h.run('init')).toBe(0);
      expect(h.fs.log.length).toBe(renames);
      const lines = h.io.stdoutText().trim().split('\n');
      expect(lines).toHaveLength(rels.length + 1);
      expect(lines.every((l) => /^skipped \S+ \(exists\)$/.test(l))).toBe(true);
    }), propConfig);
  });
});
