import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { gateExitCode } from '../exit.js';
import { propConfig } from '../../../test/support/prop.js';

const statuses = fc.array(fc.constantFrom('held' as const, 'broken' as const, 'error' as const).map((status) => ({ status })), { maxLength: 8 });

describe('Property 16: gate exit code', () => {
  // Feature: golem-kit, Property 16: Gate exit code
  it('without --kiro is 0 iff the list is non-empty and all held, otherwise 2; a start error is 1', () => {
    fc.assert(fc.property(statuses, (v) => {
      const green = v.length > 0 && v.every((x) => x.status === 'held');
      expect(gateExitCode(v, false)).toBe(green ? 0 : 2);
      expect(gateExitCode(v, false, true)).toBe(1);
    }), propConfig);
  });

  it('with --kiro is 0 for every list and 1 only for a start error', () => {
    fc.assert(fc.property(statuses, fc.boolean(), (v, start) => {
      expect(gateExitCode(v, true, start)).toBe(start ? 1 : 0);
    }), propConfig);
  });
});
