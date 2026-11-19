import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkHookFile } from '../scripts/pack-checks/hooks.js';
import { hookFile } from './support/pack.js';
import { propConfig } from './support/prop.js';

type F = ReturnType<typeof hookFile>;
const MUTATIONS: Record<string, (f: F) => void> = {
  version: (f) => { f.version = 'v1.0'; },
  count: (f) => { f.hooks.push({ ...f.hooks[0] as object, name: 'Extra hook' }); },
  dupName: (f) => { (f.hooks[1] as Record<string, unknown>)['name'] = (f.hooks[0] as Record<string, string>)['name']?.toUpperCase(); },
  triggerCase: (f) => { (f.hooks[4] as Record<string, unknown>)['trigger'] = 'manual'; },
  emptyCommand: (f) => { (f.hooks[2] as Record<string, any>)['action'].command = ''; },
  noMatcher: (f) => { delete (f.hooks[1] as Record<string, unknown>)['matcher']; },
  badMatcher: (f) => { (f.hooks[0] as Record<string, unknown>)['matcher'] = '(unclosed'; },
  lowTimeout: (f) => { (f.hooks[3] as Record<string, unknown>)['timeout'] = 1; },
  preToolUse: (f) => { (f.hooks[3] as Record<string, unknown>)['trigger'] = 'PreToolUse'; },
  guardRef: (f) => { (f.hooks[2] as Record<string, unknown>)['description'] = 'see golem-guard-requirements.mjs'; },
};

describe('Property 42: hook file invariants', () => {
  // Feature: golem-kit, Property 42: Hook file invariants
  it('accepts the file if and only if no mutation is applied, and names a problem for each mutation', () => {
    fc.assert(fc.property(fc.subarray(Object.keys(MUTATIONS)), (names) => {
      const f = JSON.parse(JSON.stringify(hookFile())) as F;
      for (const n of names) (MUTATIONS[n] as (f: F) => void)(f);
      const v = checkHookFile(f, 5);
      expect(v.length === 0).toBe(names.length === 0);
    }), propConfig);
  });

  it('each single mutation is reported', () => {
    for (const [n, m] of Object.entries(MUTATIONS)) {
      const f = JSON.parse(JSON.stringify(hookFile())) as F;
      m(f);
      expect(checkHookFile(f, 5).length, n).toBeGreaterThan(0);
    }
  });
});
