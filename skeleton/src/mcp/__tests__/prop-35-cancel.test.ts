import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AbortError } from '../../falsify/index.js';
import type { KitDeps } from '../../cli/deps.js';
import { createMcpHarness } from '../../../test/support/mcp-harness.js';
import { propConfig } from '../../../test/support/prop.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs trials until the signal fires, like a real search that is still going. */
const endless: KitDeps['falsify'] = (async (req, _pool, opts) => {
  for (let i = 0; ; i++) {
    if (opts.signal?.aborted === true) throw new AbortError();
    opts.onResult?.({ spec: { app: 'tiny', reqId: req.id, scenario: { 'push.force': 1 }, seed: i }, robustness: 0.3, worstAt: 0, unit: 'm', wallMs: 0 });
    await sleep(1);
  }
}) as KitDeps['falsify'];

const snapshot = (m: { fs: { files: Map<string, Uint8Array> } }): string =>
  JSON.stringify([...m.fs.files.entries()].map(([k, v]) => [k, Buffer.from(v).toString('base64')]).sort());

describe('Property 35: cancellation leaves disk state unchanged', () => {
  // Feature: golem-kit, Property 35: Cancellation leaves disk state unchanged
  it('aborts run_requirement and falsify within 1 s, changes no file, and the pool serves the next call', async () => {
    await fc.assert(fc.asyncProperty(fc.constantFrom('run_requirement', 'falsify'), fc.integer({ min: 0, max: 15 }), fc.boolean(), async (tool, afterMs, withExisting) => {
      const m = await createMcpHarness({ falsifyImpl: endless });
      if (withExisting) {
        m.fs.put(m.path('.golem/seeds/tiny/1.2.json'), `${JSON.stringify([{ reqId: '1.2', scenario: { 'push.force': 150 }, seed: 5, robustness: -0.1, shrunk: true, foundAfter: 1 }])}\n`);
        m.fs.put(m.path('.golem/report.json'), '{"schema":1,"verdicts":[],"meta":{"budget":{},"durationS":0,"searchSeed":1},"gateOverrides":[]}\n');
      }
      const before = snapshot(m);
      const ctl = new AbortController();
      const p = m.client.callTool({ name: tool, arguments: { reqId: '1.2', budget: 50 } }, undefined, { signal: ctl.signal });
      const settled = p.then(() => 'result', () => 'cancelled');
      await sleep(afterMs);
      const t0 = performance.now();
      ctl.abort();
      expect(await settled).toBe('cancelled');
      expect(performance.now() - t0).toBeLessThan(1000);
      expect(snapshot(m)).toBe(before);
      // the same pool serves the next call
      m.deps.falsify = (m.deps as { falsify: KitDeps['falsify'] }).falsify;
      const next = await m.call('check_requirement', { text: 'WHEN the base is pushed with up to 100 N THE robot SHALL keep its height above 0.4 m for 1 s' });
      expect(next.isError).toBe(false);
      expect(m.spies.poolClose).toBe(0);
      await m.close();
    }), { ...propConfig, numRuns: 40 });
  });
});
