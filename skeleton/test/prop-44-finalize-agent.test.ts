import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { finalizeAgent, type PermRule } from '../scripts/pack-checks/agents.js';
import { propConfig } from './support/prop.js';

const glob = fc.constantFrom('controller/**', 'tuning/**', '.kiro/specs/*/proposals.md', 'src/**', 'a/*.ts');
const rule: fc.Arbitrary<PermRule> = fc.record({
  capability: fc.constantFrom('fs_read', 'fs_write', 'shell', 'mcp', 'skill'),
  match: fc.option(fc.array(glob, { maxLength: 3 }), { nil: undefined }),
  effect: fc.constantFrom('allow' as const, 'deny' as const),
}, { requiredKeys: ['capability', 'effect'] });
const agent = fc.record({
  name: fc.string({ minLength: 1, maxLength: 8 }),
  tools: fc.array(fc.string({ maxLength: 5 }), { maxLength: 3 }),
  permissions: fc.record({ rules: fc.array(rule, { maxLength: 5 }) }),
  kiroUpgrade: fc.record({ revision: fc.nat() }),
});
const deepFreeze = <T>(o: T): T => { if (typeof o === 'object' && o !== null && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

describe('Property 44: finalizeAgent adds one Deny_Rule and changes nothing else', () => {
  // Feature: golem-kit, Property 44: finalizeAgent adds one Deny_Rule and changes nothing else
  it('appends exactly one rule for a non-empty set, changes nothing else, and does not mutate its input', () => {
    fc.assert(fc.property(agent, fc.uniqueArray(glob, { maxLength: 3 }), (a, allowed) => {
      const before = JSON.stringify(a);
      deepFreeze(a);
      const out = finalizeAgent(a, allowed) as typeof a;
      expect(JSON.stringify(a)).toBe(before);
      expect({ ...out, permissions: undefined }).toEqual({ ...a, permissions: undefined });
      if (allowed.length === 0) { expect(out).toEqual(a); return; }
      const added = { capability: 'fs_write', match: ['**'], exclude: allowed, effect: 'deny' };
      expect(out.permissions.rules.slice(0, a.permissions.rules.length)).toEqual(a.permissions.rules);
      expect(out.permissions.rules.slice(a.permissions.rules.length)).toEqual([added]);
    }), propConfig);
  });

  it('is idempotent', () => {
    fc.assert(fc.property(agent, fc.uniqueArray(glob, { minLength: 1, maxLength: 3 }), (a, allowed) => {
      const once = finalizeAgent(a, allowed);
      expect(finalizeAgent(once, allowed)).toEqual(once);
    }), propConfig);
  });
});
