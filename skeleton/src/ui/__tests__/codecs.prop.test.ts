import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { counterexampleSummary, lineStatusOf, marginText, statusOfVerdict } from '../run/status.js';
import { seedFromJson, seedToJson } from '../run/seed-json.js';
import { PinnedSeedStore, pinKey, sameCounterexample } from '../run/pins.js';
import { decodeShare, encodeShare, fitShare, shareFragment } from '../run/share-hash.js';
import { verdictRows } from '../verdict/verdict-rows.js';
import { formatSig } from '../core/format.js';
import { siToDisplayByKind } from '../core/units-ui.js';
import { FakeStorage } from './fakes.js';
import { arbCounterexample, arbDimension, arbShareState, arbVerdict } from './generators/verdict.js';
import type { Counterexample } from '../types.js';

const R = { numRuns: 100 };
const nz = (o: Counterexample): Counterexample => ({
  ...o, seed: o.seed === 0 ? 0 : o.seed, robustness: o.robustness === 0 ? 0 : o.robustness,
  scenario: Object.fromEntries(Object.entries(o.scenario).map(([k, v]) => [k, v === 0 ? 0 : v])),
});

describe('status, codec and verdict properties', () => {
  // Feature: golem-studio-ui, Property 36: Status is broken if and only if the verdict is broken
  it('maps each verdict status to the same line status and orders compile error, running, verdict', () => {
    fc.assert(fc.property(arbVerdict, fc.boolean(), fc.boolean(), fc.boolean(), (v, err, run, has) => {
      const s = statusOfVerdict(v);
      expect(s === 'broken').toBe(v.status === 'broken');
      expect(s === 'held').toBe(v.status === 'held');
      expect(s === 'error').toBe(v.status === 'error');
      const l = lineStatusOf({ hasCompileError: err, running: run, ...(has ? { verdict: v } : {}) });
      expect(l).toBe(err ? 'error' : run ? 'running' : has ? s : 'untested');
    }), R);
  });

  // Feature: golem-studio-ui, Property 37: Margin text
  it('writes the unit and the robustness at three significant figures without an exponent', () => {
    fc.assert(fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), fc.constantFrom('m', 'rad', 'N', 'm/s', 's'), (r, u) => {
      const t = marginText(r, u);
      expect(t.endsWith(` ${u}`)).toBe(true);
      const num = t.slice(0, -u.length - 1);
      expect(num).not.toMatch(/e/i);
      expect(Number(num)).toBe(Number(r.toPrecision(3)) === 0 ? 0 : Number(r.toPrecision(3)));
    }), R);
  });

  // Feature: golem-studio-ui, Property 38: Counterexample summary units
  it('has one phrase per severe or wrapping dimension, in order, in display units', () => {
    fc.assert(fc.property(fc.uniqueArray(arbDimension, { selector: (d) => d.name, maxLength: 6 }), fc.boolean(), fc.double({ min: 0, max: 7, noNaN: true }), (dims, ss, base) => {
      const scenario = Object.fromEntries(dims.map((d, i) => [d.name, base + i * 0.37]));
      const s = counterexampleSummary({ dims }, scenario, ss ? 'seed-sensitive' : 'robust');
      let pos = 0;
      let phrases = 0;
      dims.forEach((d, i) => {
        const v = formatSig(siToDisplayByKind(d.kind, base + i * 0.37), 3);
        if (d.severity === 'none' && !d.wrap) return;
        phrases++;
        const at = s.indexOf(v, pos);
        expect(at).toBeGreaterThanOrEqual(0);
        pos = at + v.length;
      });
      expect(s.split(/,? (?:from|at|for|carrying) |, |\d% /).length).toBeGreaterThanOrEqual(phrases > 0 ? 1 : 0);
      expect(s.includes('depends on the seed')).toBe(ss);
      if (phrases === 0) expect(s).toBe(ss ? 'fails, depends on the seed' : 'fails');
    }), R);
  });

  // Feature: golem-studio-ui, Property 39: Share hash round trip and limit
  it('round trips share states, fits 4000 characters and survives corruption', () => {
    fc.assert(fc.property(arbShareState, fc.string({ maxLength: 30 }), fc.nat({ max: 4000 }), (s, junk, cut) => {
      const ids = new Set([...Object.keys(s.lines), ...(s.pick ? [s.pick.reqId] : [])]);
      const d = decodeShare(shareFragment(s), ids);
      expect(d.ignored).toEqual([]);
      expect(d.state).toEqual(s);
      const original = Object.fromEntries([...ids].map((id) => [id, 'orig']));
      const big = { ...s, lines: Object.fromEntries(Object.entries(s.lines).map(([k, v]) => [k, v.repeat(80)])) };
      const f = fitShare(big, original, 4000);
      expect(f.hash.length).toBeLessThanOrEqual(4000);
      if (f.omittedIds.length > 0) expect(f.tooLong).toBe(true);
      const unchanged = fitShare({ lines: { ...original } }, original, 4000);
      expect(unchanged.hash).toBe(shareFragment({ lines: {} }));
      const corrupt = '#g=' + encodeShare(s).slice(0, cut % 50) + junk;
      expect(() => decodeShare(corrupt, ids)).not.toThrow();
      const drop = [...ids][0];
      if (drop !== undefined && drop in s.lines) {
        const fewer = new Set([...ids].filter((x) => x !== drop));
        const p = decodeShare(shareFragment(s), fewer);
        expect(p.state.lines[drop]).toBeUndefined();
        expect(p.ignored.length).toBeGreaterThan(0);
        for (const k of fewer) if (k in s.lines) expect(p.state.lines[k]).toBe(s.lines[k]);
      }
    }), R);
  });

  // Feature: golem-studio-ui, Property 40: Seed JSON round trip
  it('round trips counterexamples through the Copy seed JSON', () => {
    fc.assert(fc.property(arbCounterexample, (ce) => {
      const j = seedToJson(ce);
      const r = seedFromJson(j);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toEqual(nz(ce));
      expect(Object.keys(JSON.parse(j))).toEqual(['reqId', 'scenario', 'seed', 'robustness', 'shrunk', 'foundAfter']);
      expect(j.split('\n')[1]!.startsWith('  "reqId"')).toBe(true);
      expect(Object.is(r.ok && r.value.robustness, -0)).toBe(false);
    }), R);
  });

  // Feature: golem-studio-ui, Property 41: Pinned seeds are stored once and invalid entries are skipped
  it('stores each distinct counterexample once and skips invalid entries with one warning', () => {
    const arbSame = arbCounterexample.map((c) => ({ ...c, reqId: '2.1' }));
    fc.assert(fc.property(fc.array(fc.oneof(arbSame, arbSame.map((c) => ({ ...c, seed: 1, scenario: { f: 1 } }))), { maxLength: 12 }), fc.nat({ max: 4 }), (ops, nBad) => {
      const st = new FakeStorage();
      const p = new PinnedSeedStore(st, () => {});
      for (const c of ops) p.pin('a', c);
      const stored = p.read('a', '2.1');
      for (let i = 0; i < stored.length; i++) for (let j = i + 1; j < stored.length; j++) expect(sameCounterexample(stored[i]!, stored[j]!)).toBe(false);
      for (const c of ops) expect(stored.some((s) => sameCounterexample(s, nz(c)))).toBe(true);
      const raw = JSON.parse(st.getItem(pinKey('a', '2.1')) ?? '[]') as unknown[];
      for (let k = 0; k < nBad; k++) raw.splice(k % (raw.length + 1), 0, { reqId: 5 });
      st.setItem(pinKey('a', '2.1'), JSON.stringify(raw));
      const warns: string[] = [];
      const again = new PinnedSeedStore(st, (m) => warns.push(m)).read('a', '2.1');
      expect(again).toEqual(stored);
      expect(warns).toEqual(nBad > 0 ? [`Ignored ${nBad} invalid pinned seed${nBad === 1 ? '' : 's'} for 2.1`] : []);
    }), R);
  });

  // Feature: golem-studio-ui, Property 42: Verdict display
  it('shows the verdict values after formatting and never claims a proof', () => {
    fc.assert(fc.property(arbVerdict, fc.integer({ min: 1, max: 64 }), (v, size) => {
      const { rows, sentence } = verdictRows(v, size, 'm', { maxTrials: 240, maxMs: 30000 });
      const get = (l: string) => rows.find((r) => r.label === l)!.value;
      expect(get('Trials')).toBe(String(v.trials));
      expect(get('Random trials')).toBe(String(v.randomTrials));
      expect(get('Guided trials')).toBe(String(v.guidedTrials));
      expect(get('Wall time')).toBe(`${(v.ms / 1000).toFixed(1)} s`);
      expect(get('Closest call')).toBe(marginText(v.closest.robustness, 'm'));
      expect(get('Failure-rate bound (95%)')).toBe(v.failureRateUpper95 === undefined ? 'not available' : `${formatSig(v.failureRateUpper95 * 100, 2)}%`);
      expect(get('Pool size')).toBe(String(size));
      if (v.status === 'held') expect(sentence).toContain(`No counterexample found in ${v.trials} trials`);
      expect(sentence).not.toMatch(/proved|verified/i);
    }), R);
  });
});
