import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mergeReport, stableJson } from '../store.js';
import type { ReportFile, ReportVerdict } from '../types.js';
import { propConfig } from '../../../test/support/prop.js';

const arbVerdict = (ids: fc.Arbitrary<string>): fc.Arbitrary<ReportVerdict> => fc.record({
  reqId: ids,
  status: fc.constantFrom('held' as const, 'broken' as const, 'error' as const),
  trials: fc.nat(100), randomTrials: fc.nat(50), guidedTrials: fc.nat(50),
  closest: fc.record({ robustness: fc.double({ noNaN: true, noDefaultInfinity: true }), scenario: fc.dictionary(fc.constantFrom('a', 'b'), fc.double({ noNaN: true, noDefaultInfinity: true })), seed: fc.nat() }),
  ms: fc.nat(1000),
});
const ids = fc.constantFrom('1.1', '1.2', '2.1', 'R3', 'R4');
const arbReport: fc.Arbitrary<ReportFile> = fc.record({
  schema: fc.constant(1 as const),
  verdicts: fc.uniqueArray(arbVerdict(ids), { selector: (v) => v.reqId, maxLength: 5 }),
  meta: fc.constant({ budget: { maxTrials: 24 }, durationS: 1, searchSeed: 1 }),
  gateOverrides: fc.array(fc.record({ sessionId: fc.string(), timestamp: fc.string(), count: fc.constant(5), brokenReqIds: fc.array(fc.string(), { maxLength: 2 }) }), { maxLength: 3 }),
});

describe('Property 21: report merge keeps unrelated entries', () => {
  // Feature: golem-kit, Property 21: Report merge keeps unrelated entries
  it('changes only the merged entry, keeps the others byte-identical and always keeps gateOverrides', () => {
    fc.assert(fc.property(fc.option(arbReport, { nil: undefined }), arbVerdict(ids), (prev, nv) => {
      const m = mergeReport(prev, [nv], { budget: { maxTrials: 9 }, durationS: 2, searchSeed: 3 }, { reqId: nv.reqId });
      const old = prev?.verdicts ?? [];
      const byId = (r: ReportFile, id: string) => r.verdicts.find((x) => x.reqId === id);
      expect(stableJson(byId(m, nv.reqId))).toBe(stableJson(nv));
      for (const o of old) if (o.reqId !== nv.reqId) expect(stableJson(byId(m, o.reqId))).toBe(stableJson(o));
      expect(m.verdicts.length).toBe(old.some((o) => o.reqId === nv.reqId) ? old.length : old.length + 1);
      expect(m.gateOverrides).toEqual(prev?.gateOverrides ?? []);
    }), propConfig);
  });

  it('scope all replaces the verdicts and still keeps gateOverrides', () => {
    fc.assert(fc.property(arbReport, fc.array(arbVerdict(ids), { maxLength: 3 }), (prev, next) => {
      const m = mergeReport(prev, next, prev.meta, 'all');
      expect(m.verdicts).toEqual(next);
      expect(m.gateOverrides).toEqual(prev.gateOverrides);
    }), propConfig);
  });
});
