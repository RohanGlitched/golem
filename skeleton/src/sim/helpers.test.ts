import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SimError } from './errors.js';
import { liveHandleCount } from './handles.js';
import { forEachContact, geomDistance, withDoubleBuffer } from './helpers.js';
import { FakeBuffer, withFakeMj } from './test-fixtures.js';
import { PURE_RUNS, SEED } from './test-support.js';

describe('withDoubleBuffer', () => {
  it('rejects an invalid length naming it, before creating a buffer', () => {
    const f = withFakeMj();
    for (const n of [0, -1, 1.5, NaN]) {
      expect(() => withDoubleBuffer(f.mj, n, () => 1)).toThrow(new RegExp(`length ${String(n)}`));
    }
    expect(f.handles).toHaveLength(0);
  });
  it('deletes once on return and returns the result', () => {
    const f = withFakeMj();
    const before = liveHandleCount();
    expect(withDoubleBuffer(f.mj, 6, (b) => (b as unknown as FakeBuffer).view.length)).toBe(6);
    expect(f.handles.map((h) => h.deleteCalls)).toEqual([1]);
    expect(liveHandleCount()).toBe(before);
  });
  it('deletes once on throw and rethrows the same error', () => {
    const f = withFakeMj();
    const err = new Error('x');
    expect(() => withDoubleBuffer(f.mj, 3, () => { throw err; })).toThrowError(err);
    expect(f.handles.map((h) => h.deleteCalls)).toEqual([1]);
  });
});

describe('geomDistance', () => {
  it('returns the distance and uses a buffer of length 6', () => {
    const f = withFakeMj();
    f.geomDist = 0.25;
    expect(geomDistance(f.mj, {} as never, {} as never, 0, 1, 1)).toBe(0.25);
    expect((f.handles[0] as FakeBuffer).view.length).toBe(6);
  });
  it('returns a fromto copy that stays valid after the buffer is deleted', () => {
    const f = withFakeMj();
    f.fromto = [1, 2, 3, 4, 5, 6];
    const r = geomDistance(f.mj, {} as never, {} as never, 0, 1, 1, { nearestPoints: true });
    (f.handles[0] as FakeBuffer).view.fill(-1);
    expect(Array.from(r.fromto)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(f.handles[0]!.deleteCalls).toBe(1);
  });
});

const contactVecs = (f: ReturnType<typeof withFakeMj>) => f.handles.filter((h) => h.constructor.name === 'FakeContactVec');

describe('forEachContact', () => {
  it('visits contacts in ascending order and deletes the vector once', () => {
    const f = withFakeMj();
    f.ncon = 4;
    const data = new (f.mj as any).MjData({});
    const seen: number[] = [];
    forEachContact(f.mj, data, (_c, i) => seen.push(i));
    expect(seen).toEqual([0, 1, 2, 3]);
    expect(contactVecs(f).map((h) => h.deleteCalls)).toEqual([1]);
  });
  it('still deletes the vector when ncon is 0', () => {
    const f = withFakeMj();
    const data = new (f.mj as any).MjData({});
    forEachContact(f.mj, data, () => { throw new Error('never'); });
    expect(contactVecs(f)[0]!.deleteCalls).toBe(1);
  });
});

// Feature: golem-sim, Property 18: Helpers delete exactly once
describe('helper properties', () => {
  it('delete each created handle exactly once, whatever the outcome', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), fc.nat(10), fc.boolean(), fc.nat(5), (n, ncon, throws, throwAt) => {
        const f = withFakeMj();
        f.ncon = ncon;
        const err = new Error('boom');
        let caught: unknown;
        let result: unknown;
        try { result = withDoubleBuffer(f.mj, n, () => { if (throws) throw err; return 'ok'; }); } catch (e) { caught = e; }
        if (throws ? caught !== err : result !== 'ok') return false;
        try { geomDistance(f.mj, {} as never, {} as never, 0, 1, 1); } catch { return false; }
        const data = new (f.mj as any).MjData({});
        const seen: number[] = [];
        caught = undefined;
        try {
          forEachContact(f.mj, data, (_c, i) => { seen.push(i); if (throws && i === throwAt) throw err; });
        } catch (e) { caught = e; }
        const thrown = throws && throwAt < ncon;
        const expectedSeen = thrown ? throwAt + 1 : ncon;
        const ascending = seen.every((v, i) => v === i);
        const created = f.handles.filter((h) => h.constructor.name !== 'FakeData');
        return ascending && seen.length === expectedSeen && created.every((h) => h.deleteCalls === 1)
          && (caught === err) === thrown;
      }),
      { numRuns: PURE_RUNS, seed: SEED },
    );
  });
  it('rejects any invalid length before creating a buffer', () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer({ max: 0 }), fc.double({ noInteger: true }), fc.constant(NaN)), (n) => {
        const f = withFakeMj();
        let called = false;
        try { withDoubleBuffer(f.mj, n, () => { called = true; }); return false; } catch (e) {
          return e instanceof SimError && e.message.includes(String(n)) && !called && f.handles.length === 0;
        }
      }),
      { numRuns: PURE_RUNS, seed: SEED },
    );
  });
});
