import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { loadGuard } from './support/guard.js';
import { propConfig } from './support/prop.js';

const guard = await loadGuard();

const seg = fc.oneof(fc.constantFrom('a', 'specs', '.kiro', 'my-requirements.md', 'requirements.md.bak', 'controller', 'x y'), fc.stringMatching(/^[a-z0-9_-]{1,6}$/));
const dots = fc.constantFrom('', '.', '..');
const sep = fc.constantFrom('/', '\\');
const caseFold = (s: string, mode: number): string => (mode === 0 ? s : mode === 1 ? s.toUpperCase() : s.replace(/^./, (c) => c.toUpperCase()));

/** A path and the expectation computed from an independent normalisation. */
const arbPath = fc.record({
  segs: fc.array(fc.tuple(fc.oneof(seg, dots), sep), { maxLength: 5 }),
  last: fc.oneof(fc.constant('requirements.md'), seg, fc.constant('Requirements.MD')),
  mode: fc.integer({ min: 0, max: 2 }),
}).map(({ segs, last, mode }) => {
  const raw = segs.map(([s, sp]) => s + sp).join('') + caseFold(last, mode);
  const stack: string[] = [];
  for (const s of raw.replace(/\\/g, '/').split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') { stack.pop(); continue; }
    stack.push(s.toLowerCase());
  }
  return { raw, expected: stack[stack.length - 1] === 'requirements.md' };
});

const field = fc.constantFrom('path', 'file_path', 'paths');
const place = fc.constantFrom('tool_input', 'top');

describe('Property 9: guard exits 2 if and only if a target is requirements.md', () => {
  // Feature: golem-kit, Property 9: Guard exits 2 if and only if a target is requirements.md
  it('exits 2 exactly when some normalised target has the final segment requirements.md', () => {
    fc.assert(fc.property(fc.array(fc.record({ p: arbPath, f: field, where: place }), { minLength: 1, maxLength: 4 }), (items) => {
      const payload: Record<string, unknown> = { hook_event_name: 'PreToolUse', tool_name: 'write' };
      const ti: Record<string, unknown> = {};
      const paths: string[] = [];
      for (const { p, f, where } of items) {
        const target = where === 'top' ? payload : ti;
        if (f === 'paths') (target['paths'] = (target['paths'] as string[] | undefined) ?? []).push(p.raw);
        else target[f] = p.raw;
        void paths;
      }
      payload['tool_input'] = { ...(payload['tool_input'] as object | undefined), ...ti };
      const seen = guard.targetsOf(payload);
      const expected = items.some(({ p }) => p.expected) && seen.length > 0
        ? seen.some((s) => items.find((i) => i.p.raw === s)?.p.expected === true)
        : false;
      expect(guard.decide(JSON.stringify(payload)).code).toBe(expected ? 2 : 0);
    }), propConfig);
  });

  it('exits 2 for one target exactly when its normalised final segment is requirements.md', () => {
    fc.assert(fc.property(arbPath, field, (p, f) => {
      const input = f === 'paths' ? { paths: [p.raw] } : { [f]: p.raw };
      expect(guard.decide(JSON.stringify({ tool_input: input })).code).toBe(p.expected ? 2 : 0);
    }), propConfig);
  });
});
