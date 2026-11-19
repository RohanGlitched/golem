import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { matcherAccepts } from '../scripts/pack-checks/hooks.js';
import { hookFile } from './support/pack.js';
import { propConfig } from './support/prop.js';

const seg = fc.oneof(
  fc.constantFrom('a', 'specs', 'apps', 'x', 'controller', 'my-controller', 'controller.ts', 'requirements.md', 'my-requirements.md', 'requirements.md.bak', 'Controller'),
  fc.stringMatching(/^[a-z0-9_-]{1,6}$/),
);
const arbPath = fc.record({ segs: fc.array(seg, { minLength: 1, maxLength: 6 }), seps: fc.array(fc.constantFrom('/', '\\'), { minLength: 6, maxLength: 6 }) })
  .map(({ segs, seps }) => ({ segs, path: segs.map((s, i) => (i === 0 ? s : `${seps[i] as string}${s}`)).join('') }));

const [reqMatcher, ctlMatcher] = [hookFile().hooks[0]?.['matcher'] as string, hookFile().hooks[1]?.['matcher'] as string];

describe('Property 41: hook matchers select exactly the intended paths', () => {
  // Feature: golem-kit, Property 41: Hook matchers select exactly the intended paths
  it('the requirements matcher accepts a path if and only if its final segment is requirements.md', () => {
    fc.assert(fc.property(arbPath, ({ segs, path }) => {
      expect(matcherAccepts(reqMatcher, path)).toBe(segs[segs.length - 1] === 'requirements.md');
    }), propConfig);
  });

  it('the controller matcher accepts a path if and only if it has a controller directory segment', () => {
    fc.assert(fc.property(arbPath, ({ segs, path }) => {
      expect(matcherAccepts(ctlMatcher, path)).toBe(segs.slice(0, -1).includes('controller'));
    }), propConfig);
  });
});
