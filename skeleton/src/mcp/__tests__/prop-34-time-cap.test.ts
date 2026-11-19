import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AbortError } from '../../falsify/index.js';
import type { KitDeps } from '../../cli/deps.js';
import { createMcpHarness } from '../../../test/support/mcp-harness.js';
import { propConfig } from '../../../test/support/prop.js';

/** A falsifier that reports `n` trials and then waits for the abort signal. */
const slowFalsify = (n: number): KitDeps['falsify'] => (async (req, _pool, opts) => {
  for (let i = 0; i < n; i++) {
    opts.onResult?.({ spec: { app: 'tiny', reqId: req.id, scenario: { 'push.force': 10 + i }, seed: i + 1 }, robustness: 0.5 - 0.1 * i, worstAt: 0, unit: 'm', wallMs: 0 });
  }
  await new Promise<never>((_, reject) => {
    const abort = (): void => reject(new AbortError());
    if (opts.signal?.aborted === true) abort(); else opts.signal?.addEventListener('abort', abort, { once: true });
  });
  throw new Error('unreachable');
}) as KitDeps['falsify'];

describe('Property 34: time cap gives a result for run and falsify and an error for the rest', () => {
  // Feature: golem-kit, Property 34: Time cap gives a result for run and falsify and an error for the rest
  it('returns a non-error partial result with the trial count for run_requirement and falsify', async () => {
    await fc.assert(fc.asyncProperty(fc.constantFrom('run_requirement', 'falsify'), fc.integer({ min: 0, max: 6 }), async (tool, n) => {
      const m = await createMcpHarness({ falsifyImpl: slowFalsify(n), mcpApp: { toolTimeCapS: 0.01 } });
      const t0 = performance.now();
      const r = await m.call(tool, { reqId: '1.2', budget: 8 });
      expect(performance.now() - t0).toBeLessThan(1000);
      expect(r.isError).toBe(false);
      expect(r.json).toMatchObject({ reqId: '1.2', partial: true, trials: n });
      expect(r.summary).toContain('time cap');
      expect(r.summary).toContain(`after ${n} trials`);
      expect(m.fs.files.has(m.path('.golem/report.json'))).toBe(false);
      expect([...m.fs.files.keys()].some((p) => p.includes('/seeds/'))).toBe(false);
      await m.close();
    }), { ...propConfig, numRuns: 40 });
  });

  it('returns an error result that says the cap ended the call for every other slow tool', async () => {
    await fc.assert(fc.asyncProperty(fc.constantFrom('replay', 'explain_margin', 'list_requirements', 'get_counterexample', 'propose_requirement'), async (tool) => {
      const m = await createMcpHarness({ predicates: true, mcpApp: { toolTimeCapS: 0.01 } });
      m.fs.put(m.path('.golem/seeds/tiny/1.2.json'), `${JSON.stringify([{ reqId: '1.2', scenario: { 'push.force': 150 }, seed: 5, robustness: -0.1, shrunk: true, foundAfter: 1 }])}\n`);
      const slow = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 60));
      const realRead = m.fs.readFile.bind(m.fs);
      m.deps.fs.readFile = async (p) => { await slow(0); return realRead(p); };
      m.deps.runTraced = async (a, req, spec) => { await slow(0); return (await import('../../../test/support/tiny-app.js')).tinyTrial(req, spec); };
      const args: Record<string, unknown> = tool === 'propose_requirement' ? { text: 'WHEN the base is pushed with up to 250 N THE robot SHALL keep its height above 0.4 m for 1 s' } : tool === 'list_requirements' ? {} : { reqId: '1.2' };
      const r = await m.call(tool, args);
      expect(r.isError).toBe(true);
      expect(r.summary).toMatch(/time cap/);
      await m.close();
    }), { ...propConfig, numRuns: 25 });
  });
});
