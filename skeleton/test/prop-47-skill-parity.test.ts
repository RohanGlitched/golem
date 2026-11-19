import fc from 'fast-check';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffTrees, runSync, type Tree } from '../scripts/sync-power.js';
import { propConfig } from './support/prop.js';

const name = fc.stringMatching(/^[a-z]{1,5}$/);
const arbTree = fc.dictionary(fc.tuple(name, name).map(([a, b]) => `${a}/${b}/SKILL.md`), fc.uint8Array({ minLength: 1, maxLength: 20 }), { minKeys: 1, maxKeys: 4 });

const toTree = (o: Record<string, Uint8Array>): Tree => new Map(Object.entries(o));
function write(dir: string, o: Record<string, Uint8Array>): void {
  for (const [p, b] of Object.entries(o)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), b); }
}

describe('Property 47: skill parity between pack and Power', () => {
  // Feature: golem-kit, Property 47: Skill parity between pack and Power
  it('has equal path sets and bytes exactly when the diff is empty', () => {
    fc.assert(fc.property(arbTree, fc.option(fc.record({ pick: fc.nat(), flip: fc.integer({ min: 1, max: 255 }), extra: fc.boolean(), drop: fc.boolean() }), { nil: undefined }), (a, mut) => {
      const b: Record<string, Uint8Array> = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.slice()]));
      let expected = 0;
      if (mut !== undefined) {
        const keys = Object.keys(b);
        const key = keys[mut.pick % keys.length] as string;
        if (mut.drop && keys.length > 1) { delete b[key]; expected++; }
        else { (b[key] as Uint8Array)[0] = ((b[key] as Uint8Array)[0] as number) ^ mut.flip; expected++; }
        if (mut.extra) { b['zz/zz/SKILL.md'] = Uint8Array.from([1]); expected++; }
      }
      const diff = diffTrees(toTree(a), toTree(b));
      expect(diff.length === 0).toBe(expected === 0);
      expect(diff.length).toBeGreaterThanOrEqual(expected === 0 ? 0 : 1);
    }), propConfig);
  });

  it('--check exits 1 and lists each one-byte difference, and 0 for equal trees', () => {
    fc.assert(fc.property(arbTree, fc.nat(), fc.integer({ min: 1, max: 255 }), (a, pick, flip) => {
      const root = mkdtempSync(join(tmpdir(), 'golem-parity-'));
      try {
        const dirs = { pack: join(root, 'pack'), power: join(root, 'power'), crew: join(root, 'crew'), rootLicense: join(root, 'LICENSE') };
        write(join(dirs.pack, 'skills'), a);
        writeFileSync(dirs.rootLicense, 'license');
        mkdirSync(dirs.power, { recursive: true });
        writeFileSync(join(dirs.power, 'LICENSE'), 'license');
        const out: string[] = [];
        runSync([], dirs, () => undefined);
        expect(runSync(['--check'], dirs, (s) => out.push(s))).toBe(0);
        const keys = Object.keys(a);
        const key = keys[pick % keys.length] as string;
        const bytes = Buffer.from(a[key] as Uint8Array);
        bytes[0] = (bytes[0] as number) ^ flip;
        writeFileSync(join(dirs.power, 'skills', key), bytes);
        const lines: string[] = [];
        expect(runSync(['--check'], dirs, (s) => lines.push(s))).toBe(1);
        expect(lines.some((l) => l.includes(`power/skills/${key} (differs)`))).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }), { ...propConfig, numRuns: 100 });
  });
});
