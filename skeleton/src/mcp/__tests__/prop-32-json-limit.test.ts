import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { limitJson } from '../result.js';
import { propConfig } from '../../../test/support/prop.js';

const key = fc.stringMatching(/^[a-z]{1,5}$/).filter((k) => k !== 'truncated');
const leaf = fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.string({ maxLength: 40 }), fc.string({ minLength: 200, maxLength: 3000, unit: 'binary' }));
const tree: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  node: fc.oneof({ depthSize: 'small', maxDepth: 3 }, leaf,
    fc.array(tie('node'), { maxLength: 12 }),
    fc.array(fc.oneof(fc.integer(), fc.string({ maxLength: 20 })), { minLength: 100, maxLength: 900 }),
    fc.dictionary(key, tie('node'), { maxKeys: 4 })),
})).node;

const bytes = (s: string): number => new TextEncoder().encode(s).length;

function arrays(v: unknown, path: string[], out: Map<string, unknown[]>): void {
  if (Array.isArray(v)) { out.set(path.join('.') || '$', v); v.forEach((x, i) => arrays(x, [...path, String(i)], out)); }
  else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) arrays(x, [...path, k], out);
}

describe('Property 32: JSON limiter stays valid and bounded', () => {
  // Feature: golem-kit, Property 32: JSON limiter stays valid and bounded
  it('gives valid JSON within the byte limit and names each cut array with original and kept counts', () => {
    fc.assert(fc.property(tree, fc.integer({ min: 300, max: 6000 }), (value, max) => {
      const r = limitJson(value, max);
      const parsed = JSON.parse(r.text) as unknown;
      expect(bytes(r.text)).toBeLessThanOrEqual(Math.max(max, bytes('{"error":"result too large","truncated":true}')));
      if (r.truncated === undefined) { expect(r.text).toBe(JSON.stringify(value) ?? 'null'); return; }
      const before = new Map<string, unknown[]>();
      arrays(JSON.parse(JSON.stringify(value)) as unknown, [], before);
      const root = (typeof value === 'object' && value !== null && !Array.isArray(value)) ? parsed : (parsed as { value: unknown }).value;
      const after = new Map<string, unknown[]>();
      arrays(root, [], after);
      for (const [path, info] of Object.entries(r.truncated)) {
        const was = before.get(path);
        const now = after.get(path);
        if (was === undefined || now === undefined || 'error' in (parsed as object)) continue; // a string cut, or a nested array that vanished
        expect(info.original).toBeLessThanOrEqual(was.length);
        expect(now.length).toBe(info.kept);
        expect(now.length).toBeLessThanOrEqual(info.original);
        if (now.length > 0 && now.every((x) => typeof x !== 'object' || x === null)) {
          expect(now).toEqual(was.slice(0, now.length));
        }
      }
    }), propConfig);
  });
});
