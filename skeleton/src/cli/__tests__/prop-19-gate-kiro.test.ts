import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createHarness, stopPayload } from '../../../test/support/harness.js';
import { scriptedFalsify, type Scripted } from '../../../test/support/scripted.js';
import { propConfig } from '../../../test/support/prop.js';

const BAD = '### Requirement 1: X\n\n#### Acceptance Criteria\n\n1. WHEN the base is pushed with up to 100 N THE robot SHALL keep its heigth above 0.4 m for 1 s\n';
const mode = fc.constantFrom('ran', 'ran', 'ran', 'compile', 'empty', 'poolfail');
const status = fc.constantFrom<Scripted>('held', 'broken', 'error');
const call = fc.record({ session: fc.constantFrom('a', 'b', undefined), statuses: fc.tuple(status, status, status), mode, gap: fc.constantFrom(3000, 10000) });

describe('Property 19: golem gate --kiro output protocol', () => {
  // Feature: golem-kit, Property 19: `golem gate --kiro` output protocol
  it('prints one block JSON line or 0 bytes, exits 0, and appends a Gate_Override only for an allow at count 5', async () => {
    await fc.assert(fc.asyncProperty(fc.array(call, { minLength: 1, maxLength: 16 }), async (calls) => {
      const h = createHarness({ falsifyImpl: scriptedFalsify({}), seed: false });
      const origPool = h.deps.createPool;
      const counts = new Map<string, number>();
      let overrides = 0;
      for (const c of calls) {
        const sess = c.session ?? 'default';
        // each call may use a different project state; the counter is what carries over
        const fs = h.fs;
        fs.put(h.path('golem.config.json'), c.mode === 'empty' ? '{"app":"./a.js","requirements":[]}' : '{"app":"./a.js","requirements":[".kiro/specs/tiny/requirements.md"]}');
        fs.put(h.path('.kiro/specs/tiny/requirements.md'), c.mode === 'compile' ? BAD : '### Requirement 1: X\n\n#### Acceptance Criteria\n\n1. WHEN the base is pushed with up to 100 N THE robot SHALL keep its height above 0.4 m for 1 s\n2. WHEN the base is pushed with up to 100 N THE robot SHALL keep its tilt below 0.5 rad for 1 s\n3. WHEN the base is pushed with up to 100 N THE robot SHALL keep its height above 0.3 m for 1 s\n');
        (h.deps as { falsify: unknown }).falsify = scriptedFalsify({ '1.1': c.statuses[0], '1.2': c.statuses[1], '1.3': c.statuses[2] } as never);
        (h.deps as { createPool: unknown }).createPool = c.mode === 'poolfail'
          ? async () => { throw new Error('no workers'); }
          : origPool;
        h.clock.advance(c.gap);
        h.clearOutput();
        h.io.setStdin(c.session === undefined ? undefined : stopPayload(c.session));
        const code = await h.run('gate', '--kiro');
        expect(code).toBe(0);
        const green = c.mode === 'ran' && c.statuses.every((s) => s === 'held');
        const n = counts.get(sess) ?? 0;
        const out = h.io.stdoutText();
        if (green) {
          counts.delete(sess);
          expect(out).toBe('');
        } else if (n < 5) {
          counts.set(sess, n + 1);
          const lines = out.split('\n');
          expect(lines).toHaveLength(2);
          expect(lines[1]).toBe('');
          const j = JSON.parse(lines[0] as string) as { decision: string; reason: string };
          expect(j.decision).toBe('block');
          expect(j.reason.length).toBeGreaterThan(0);
          expect(j.reason.length).toBeLessThanOrEqual(4000);
          expect(Object.keys(j).sort()).toEqual(['decision', 'reason']);
        } else {
          counts.set(sess, 0);
          overrides++;
          expect(out).toBe('');
          expect(h.io.stderrText()).toContain('RED');
        }
        const rep = h.report();
        expect(rep?.gateOverrides?.length ?? 0).toBe(overrides);
      }
    }), { ...propConfig, numRuns: 100 });
  });

  it('exits 1 with 0 bytes on stdout for usage and Config_File errors', async () => {
    await fc.assert(fc.asyncProperty(fc.constantFrom('--budget=0', '--bogus', '--time=NaN'), fc.boolean(), async (flag, hasConfig) => {
      const h = createHarness({ seed: hasConfig });
      h.io.setStdin(stopPayload('s'));
      const code = await h.run('gate', '--kiro', flag);
      expect(code).toBe(1);
      expect(h.io.stdoutText()).toBe('');
    }), propConfig);
  });
});
