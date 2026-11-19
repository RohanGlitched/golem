import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createHarness } from '../../../test/support/harness.js';
import { installPack } from '../../../test/support/pack-fixture.js';
import { propConfig } from '../../../test/support/prop.js';

const normalRel = fc.stringMatching(/^[a-z]{1,4}\/[a-z]{1,4}\.md$/);
const evilRel = fc.constantFrom('../x.md', '../../x.md', 'a/../../x.md', '../../../etc/x', '/abs/x.md', 'a/b/../../../../x.md');

/** Depth below the target directory: .kiro/ is one level down, every .. goes one up. */
function escapesTarget(rel: string): boolean {
  if (rel.startsWith('/')) return true;
  let depth = 1;
  for (const s of rel.split('/')) { if (s === '..') depth--; else if (s !== '' && s !== '.') depth++; if (depth < 0) return true; }
  return false;
}

/** The path init writes to is the lexically normalised one, so a symlink is only met after .. is resolved. */
function lexical(rel: string): string {
  const out: string[] = [];
  for (const s of rel.split('/')) { if (s === '..') out.pop(); else if (s !== '' && s !== '.') out.push(s); }
  return out.join('/');
}

describe('Property 28: init never writes outside the target', () => {
  // Feature: golem-kit, Property 28: Init never writes outside the target
  it('writes only below the real target directory, or exits 1 naming the path and writes nothing', async () => {
    await fc.assert(fc.asyncProperty(fc.uniqueArray(fc.oneof(normalRel, evilRel), { minLength: 1, maxLength: 4 }), fc.option(fc.constantFrom('hooks', 'steering', 'a', 'b'), { nil: undefined }), async (rels, linked) => {
      const h = createHarness({ seed: false });
      installPack(h.fs, '/pack', Object.fromEntries(rels.map((r) => [r.replace(/^\/+/, 'abs/'), 'data'])) as Record<string, string>);
      // the manifest keeps the original (possibly evil) relative paths
      const manifest = JSON.parse(h.fs.text('/pack/manifest.json') as string) as { files: { rel: string }[] };
      manifest.files.forEach((f, i) => { f.rel = rels[i] as string; });
      h.fs.put('/pack/manifest.json', JSON.stringify(manifest));
      for (const r of rels) h.fs.put(`/pack/${r.replace(/^\/+/, '')}`, 'data');
      if (linked !== undefined) h.fs.symlink(h.path(`.kiro/${linked}`), '/outside');
      h.fs.put('/outside/keep', 'x');
      const before = new Set(h.fs.list());
      const code = await h.run('init');
      const created = h.fs.list().filter((p) => !before.has(p));
      if (code === 0) {
        for (const p of created) expect(p.startsWith(`${h.path('')}`.replace(/\/$/, '') + '/')).toBe(true);
        expect(created.some((p) => p.startsWith('/outside/'))).toBe(false);
      } else {
        expect(code).toBe(1);
        expect(created).toEqual([]);
        expect(h.io.stderrText()).toMatch(/outside|cannot be read/);
      }
      const escapes = rels.some((r) => escapesTarget(r)) || (linked !== undefined && rels.some((r) => lexical(r).startsWith(linked + '/')));
      if (escapes) expect(code).toBe(1);
    }), propConfig);
  });
});
