import { describe, expect, it } from 'vitest';
import { HandleRegistry, TrialScope, liveHandleCount, registry } from './handles.js';
import { FakeHandle } from './test-fixtures.js';

describe('HandleRegistry', () => {
  it('counts tracked handles and releases each once', () => {
    const r = new HandleRegistry();
    const h = r.track(new FakeHandle());
    expect(r.live).toBe(1);
    expect(r.release(h)).toBe(true);
    expect(r.release(h)).toBe(false);
    expect(h.deleteCalls).toBe(1);
    expect(r.live).toBe(0);
  });
  it('ignores a handle it never tracked', () => {
    const r = new HandleRegistry();
    const h = new FakeHandle();
    expect(r.release(h)).toBe(false);
    expect(h.deleteCalls).toBe(0);
  });
  it('liveHandleCount reads the module registry', () => {
    const before = liveHandleCount();
    const h = registry.track(new FakeHandle());
    expect(liveHandleCount()).toBe(before + 1);
    registry.release(h);
    expect(liveHandleCount()).toBe(before);
  });
});

describe('TrialScope', () => {
  it('deletes in LIFO order', () => {
    const r = new HandleRegistry();
    const order: number[] = [];
    const scope = new TrialScope(r);
    for (let i = 0; i < 3; i++) {
      const h = new FakeHandle();
      h.delete = () => { order.push(i); };
      scope.track(h);
    }
    scope.disposeAll();
    expect(order).toEqual([2, 1, 0]);
    expect(r.live).toBe(0);
  });
  it('keeps deleting after a throwing delete and rethrows the first error', () => {
    const r = new HandleRegistry();
    const scope = new TrialScope(r);
    const a = scope.track(new FakeHandle());
    const b = scope.track(new FakeHandle());
    const c = scope.track(new FakeHandle());
    b.throwOnDelete = true;
    expect(() => scope.disposeAll()).toThrow('delete failed');
    expect([a, b, c].map((h) => h.deleteCalls)).toEqual([1, 1, 1]);
    expect(r.live).toBe(0);
  });
  it('does not rethrow when another error is already propagating', () => {
    const r = new HandleRegistry();
    const scope = new TrialScope(r);
    scope.track(new FakeHandle()).throwOnDelete = true;
    expect(() => scope.disposeAll(true)).not.toThrow();
  });
  it('a second disposeAll deletes nothing more', () => {
    const r = new HandleRegistry();
    const scope = new TrialScope(r);
    const h = scope.track(new FakeHandle());
    scope.disposeAll();
    scope.disposeAll();
    expect(h.deleteCalls).toBe(1);
  });
});
