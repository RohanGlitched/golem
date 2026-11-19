import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createHarness } from '../../../test/support/harness.js';
import { FIXTURE_FILES, installPack } from '../../../test/support/pack-fixture.js';
import { propConfig } from '../../../test/support/prop.js';

const rels = Object.keys(FIXTURE_FILES).filter((r) => r !== 'settings/mcp.json');

describe('Property 27: force replaces with template bytes', () => {
  // Feature: golem-kit, Property 27: Force replaces with template bytes
  it('leaves every pack file byte-identical to its template, whatever the existing content was', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.option(fc.uint8Array({ maxLength: 40 }), { nil: undefined }), { minLength: rels.length, maxLength: rels.length }), async (olds) => {
      const h = createHarness({ seed: false });
      const pack: Record<string, Uint8Array | string> = {};
      rels.forEach((r, i) => { pack[r] = Uint8Array.from([i, 255, 0, 10, 13, 200, ...new TextEncoder().encode(r)]); });
      installPack(h.fs, '/pack', pack);
      rels.forEach((r, i) => { const o = olds[i]; if (o !== undefined) h.fs.put(h.path(`.kiro/${r}`), o); });
      h.fs.put(h.path('golem.config.json'), 'old config');
      expect(await h.run('init', '--force')).toBe(0);
      for (const r of rels) expect([...(h.fs.files.get(h.path(`.kiro/${r}`)) as Uint8Array)]).toEqual([...(pack[r] as Uint8Array)]);
      expect(h.fs.text(h.path('golem.config.json'))).not.toBe('old config');
      expect(h.io.stdoutText().trim().split('\n').every((l) => l.startsWith('wrote '))).toBe(true);
    }), propConfig);
  });
});
