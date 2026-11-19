import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ALLOWED_WRITE, effectiveWriteAllow, isWriteAllowed, rulesOf, type PermRule } from '../scripts/pack-checks/agents.js';
import { agentFile } from './support/pack.js';
import { propConfig } from './support/prop.js';

/** An independent glob matcher: `**` takes any number of segments, `*` stays in one segment, plain patterns match children. */
function ref(pattern: string, path: string): boolean {
  const p = pattern.split('/');
  const s = path.split('/');
  const hasWild = pattern.includes('*');
  const go = (i: number, j: number): boolean => {
    if (i === p.length) return hasWild ? j === s.length : j <= s.length;
    const seg = p[i] as string;
    if (seg === '**') return [...Array(s.length - j + 1).keys()].some((k) => go(i + 1, j + k));
    if (j >= s.length) return false;
    const re = new RegExp(`^${seg.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
    return re.test(s[j] as string) && go(i + 1, j + 1);
  };
  return go(0, 0);
}

const glob = fc.constantFrom('controller/**', 'tuning/**', 'src/*.ts', '**', 'src/**', 'a/b', '.kiro/specs/*/proposals.md');
const path = fc.array(fc.constantFrom('controller', 'tuning', 'src', 'a', 'b', 'x.ts', 'y', '.kiro', 'specs', 'g1', 'proposals.md'), { minLength: 1, maxLength: 4 }).map((s) => s.join('/'));
const rule: fc.Arbitrary<PermRule> = fc.record({
  capability: fc.constantFrom('fs_write', 'fs_read'),
  match: fc.array(glob, { minLength: 1, maxLength: 2 }),
  exclude: fc.option(fc.array(glob, { maxLength: 2 }), { nil: undefined }),
  effect: fc.constantFrom('allow' as const, 'deny' as const),
}, { requiredKeys: ['capability', 'match', 'effect'] });

const covers = (r: PermRule, p: string): boolean => r.capability === 'fs_write' && r.match!.some((g) => ref(g, p)) && !(r.exclude ?? []).some((g) => ref(g, p));

describe('Property 45: agent write policy equals its allowed set', () => {
  // Feature: golem-kit, Property 45: Agent write policy equals its allowed set
  it('isWriteAllowed follows deny over allow with glob and exclude semantics', () => {
    fc.assert(fc.property(fc.array(rule, { maxLength: 5 }), path, (rules, p) => {
      const denied = rules.some((r) => r.effect === 'deny' && covers(r, p));
      const allowed = rules.some((r) => r.effect === 'allow' && covers(r, p));
      expect(isWriteAllowed(rules, p)).toBe(!denied && allowed);
    }), propConfig);
  });

  it('effectiveWriteAllow is the union of the match lists of write allow rules', () => {
    fc.assert(fc.property(fc.array(rule, { maxLength: 5 }), (rules) => {
      const want = [...new Set(rules.filter((r) => r.effect === 'allow' && r.capability === 'fs_write').flatMap((r) => r.match as string[]))];
      expect(effectiveWriteAllow(rules)).toEqual(want);
    }), propConfig);
  });

  it.each(['tuner', 'skeptic', 'scribe'] as const)('the finalized %s allows a path exactly when it matches its allowed set', (role) => {
    const rules = rulesOf(agentFile(role));
    fc.assert(fc.property(path, (p) => {
      expect(isWriteAllowed(rules, p)).toBe(ALLOWED_WRITE[role].some((g) => ref(g, p)));
    }), propConfig);
  });
});
