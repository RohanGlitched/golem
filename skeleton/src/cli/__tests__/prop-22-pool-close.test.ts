import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createHarness, stopPayload } from '../../../test/support/harness.js';
import { scriptedFalsify, type Scripted } from '../../../test/support/scripted.js';
import { propConfig } from '../../../test/support/prop.js';

const outcome = fc.constantFrom<Scripted>('held', 'broken', 'error', 'throw', 'abort');
const command = fc.constantFrom(['test'], ['falsify', '1.2'], ['gate'], ['gate', '--kiro']);

describe('Property 22: the pool is closed exactly once on every path', () => {
  // Feature: golem-kit, Property 22: The pool is closed exactly once on every path
  it('closes the pool exactly once for test, falsify and gate whatever the outcomes', async () => {
    await fc.assert(fc.asyncProperty(command, fc.array(outcome, { minLength: 3, maxLength: 3 }), async (args, outs) => {
      const h = createHarness({ falsifyImpl: scriptedFalsify({ '1.1': outs[0] as Scripted, '1.2': outs[1] as Scripted, '1.3': outs[2] as Scripted }) });
      h.io.setStdin(stopPayload('s'));
      await h.run(...args);
      expect(h.spies.createPool).toBe(1);
      expect(h.spies.poolClose).toBe(1);
    }), propConfig);
  });

  it('creates no pool when the command fails before it needs one', async () => {
    await fc.assert(fc.asyncProperty(command, fc.constantFrom('compile', 'unknown-id', 'argument'), async (args, failure) => {
      const h = createHarness({ requirements: failure === 'compile' ? '### Requirement 1: X\n\n#### Acceptance Criteria\n\n1. WHEN the base is pushed with up to 100 N THE robot SHALL keep its heigth above 0.4 m for 1 s\n' : undefined });
      h.io.setStdin(stopPayload('s'));
      const a = failure === 'argument' ? [...args, '--budget', '0'] : failure === 'unknown-id' && args[0] === 'falsify' ? ['falsify', 'zz'] : args;
      fc.pre(failure !== 'unknown-id' || args[0] === 'falsify');
      await h.run(...a);
      if (failure === 'argument' || failure === 'unknown-id' || args[0] !== 'gate' || !args.includes('--kiro')) {
        expect(h.spies.createPool).toBe(0);
        expect(h.spies.poolClose).toBe(0);
      }
    }), propConfig);
  });
});
