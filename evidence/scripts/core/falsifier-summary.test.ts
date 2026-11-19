import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { expectedBreaks, latestAttempts, summarizeFalsifier, type FalsifierRecord } from './falsifier-summary.js';
import { parseJsonl, remaining, stableStringify } from './jsonl.js';
import { severity } from './severity.js';

const rec = (o: Partial<FalsifierRecord>): FalsifierRecord => ({
  app: 'stagger', reqId: '1.2', arm: 'guided', searchSeed: 1, attempt: 1, budget: 96, status: 'broken', found: true,
  trialsToFirst: 10, sevFound: 0.5, sevShrunk: null, robustness: -1, trials: 32, wallMs: 1, ...o,
});

describe('expectedBreaks', () => {
  it('lists the ids of Expected_Break rows only', () => {
    const md = '| Criterion | Topic | Expectation |\n|---|---|---|\n| 1.1 | Push | Expected_Hold |\n| 1.2 | Push | Expected_Break |\n| 4.2 | Payload | Expected_Break |\n';
    expect(expectedBreaks(md)).toEqual(['1.2', '4.2']);
  });
});

describe('severity', () => {
  const dims = [
    { name: 'f', min: 0, max: 200, severity: 'up' as const },
    { name: 'g', min: 1, max: 0, severity: 'down' as const },
    { name: 'a', min: 0, max: 6, severity: 'none' as const },
    { name: 'fixed', min: 3, max: 3, severity: 'up' as const },
  ];
  it('averages the directed, non-empty dimensions', () => {
    expect(severity([dims[0]!], { f: 50 })).toBe(0.25);
    expect(severity([dims[0]!, dims[2]!, dims[3]!], { f: 200, a: 1, fixed: 3 })).toBe(1);
  });
  it('is within [0, 1] and never decreases when an up dimension grows', () => {
    fc.assert(fc.property(fc.double({ min: -50, max: 400, noNaN: true }), fc.double({ min: -50, max: 400, noNaN: true }), (x, y) => {
      const [lo, hi] = x < y ? [x, y] : [y, x];
      const a = severity([dims[0]!], { f: lo }), b = severity([dims[0]!], { f: hi });
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(a);
    }));
  });
});

describe('jsonl', () => {
  it('writes sorted keys and ignores a torn final line', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(parseJsonl('{"a":1}\n{"a":2}\n{"a"')).toEqual([{ a: 1 }, { a: 2 }]);
  });
  it('rejects a bad line that is not the last', () => {
    expect(() => parseJsonl('{"a":1}\nnope\n{"a":2}\n')).toThrow(/line 2/);
  });
  it('appends nothing on a second pass over the same plan', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 50 })), (plan) => {
      const done = new Set<string>();
      for (const k of remaining(plan, String, done)) done.add(String(k));
      expect(remaining(plan, String, done)).toEqual([]);
    }));
  });
});

describe('summarizeFalsifier', () => {
  it('replaces an errored attempt by its rerun', () => {
    const rs = latestAttempts([rec({ found: null, status: 'error', attempt: 1 }), rec({ attempt: 2 })]);
    expect(rs).toHaveLength(1);
    expect(rs[0]!.attempt).toBe(2);
  });
  it('censors misses at budget + 1 and counts rates with an interval', () => {
    const rs: FalsifierRecord[] = [];
    for (let s = 1; s <= 20; s++) {
      rs.push(rec({ searchSeed: s, arm: 'guided', trialsToFirst: 5 }));
      rs.push(s <= 4
        ? rec({ searchSeed: s, arm: 'random', found: false, status: 'held', trialsToFirst: null, sevFound: null })
        : rec({ searchSeed: s, arm: 'random', trialsToFirst: 20 }));
    }
    const [r] = summarizeFalsifier(rs, 96);
    expect(r!.guided).toMatchObject({ n: 20, found: 20, rate: 1 });
    expect(r!.random).toMatchObject({ n: 20, found: 16, rate: 0.8 });
    expect(r!.random.ci95.lo).toBeLessThan(0.8);
    expect(r!.random.ci95.hi).toBeGreaterThan(0.8);
    expect(r!.pairs).toBe(20);
    // guided is always lower: 20 non-zero differences, all negative, p = 2 / 2^20
    expect(r!.trialsTest.n).toBe(20);
    expect(r!.trialsTest.p).toBeCloseTo(2 / 2 ** 20, 12);
    expect(r!.trialsTest.pBonferroni).toBeCloseTo(2 / 2 ** 20, 12);
  });
  it('excludes errored runs from the pairs and says how many', () => {
    const rs = [rec({ searchSeed: 1 }), rec({ searchSeed: 1, arm: 'random', found: null, status: 'error', trialsToFirst: null })];
    const [r] = summarizeFalsifier(rs, 96);
    expect(r).toMatchObject({ pairs: 0, excluded: 1 });
    expect(r!.trialsTest.p).toBe(1);
  });
});