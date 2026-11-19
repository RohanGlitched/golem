import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { testExitCode } from '../exit.js';
import { propConfig } from '../../../test/support/prop.js';

describe('Property 17: test exit code', () => {
  // Feature: golem-kit, Property 17: Test exit code
  it('is 2 if any broken, else 1 if any error, else 0', () => {
    fc.assert(fc.property(
      fc.array(fc.constantFrom('held' as const, 'broken' as const, 'error' as const).map((status) => ({ status })), { maxLength: 10 }),
      (v) => {
        const expected = v.some((x) => x.status === 'broken') ? 2 : v.some((x) => x.status === 'error') ? 1 : 0;
        expect(testExitCode(v)).toBe(expected);
      },
    ), propConfig);
  });
});
