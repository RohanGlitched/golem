import { describe, expect, it } from 'vitest';
import { ProgressEmitter, buildProgressEvent, safeInvoke, type ProgressInput } from './progress.js';

const input = (over: Partial<ProgressInput> = {}): ProgressInput => ({
  phase: 1, generation: 0, scenarios: [{ f: 1 }], seeds: [7], robustness: [0.5], lowestRobustness: 0.5,
  trialsUsed: 1, trialsRemaining: null, elapsedMs: 3, timeFraction: null, ...over,
});

describe('progress', () => {
  it('builds a frozen event', () => {
    const e = buildProgressEvent(input());
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(e.scenarios)).toBe(true);
    expect(Object.isFrozen(e.scenarios[0])).toBe(true);
    expect(Object.isFrozen(e.robustness)).toBe(true);
  });
  it('does not change when the source is mutated after delivery', () => {
    const src = input();
    const e = buildProgressEvent(src);
    (src.scenarios[0] as Record<string, number>)['f'] = 99;
    (src.robustness as number[])[0] = -1;
    expect(e.scenarios[0]).toEqual({ f: 1 });
    expect(e.robustness).toEqual([0.5]);
  });
  it('keeps trialsRemaining null without a trial limit', () => {
    expect(buildProgressEvent(input()).trialsRemaining).toBeNull();
    expect(buildProgressEvent(input({ trialsRemaining: 7 })).trialsRemaining).toBe(7);
  });
  it('swallows a callback that throws', () => {
    expect(() => safeInvoke(() => { throw new Error('x'); }, 1)).not.toThrow();
  });
  it('swallows a rejecting async callback without unhandled rejection and does not await it', async () => {
    let settled = false;
    safeInvoke(async () => { await new Promise((r) => setTimeout(r, 20)); settled = true; throw new Error('late'); }, 1);
    expect(settled).toBe(false);
    await new Promise((r) => setTimeout(r, 40));
    expect(settled).toBe(true);
  });
  it('emits nothing after stop()', () => {
    const got: number[] = [];
    const em = new ProgressEmitter((e) => { got.push(e.generation); });
    em.emit(input({ generation: 0 }));
    em.stop();
    em.emit(input({ generation: 1 }));
    expect(got).toEqual([0]);
  });
  it('does nothing without a callback', () => {
    expect(() => new ProgressEmitter(undefined).emit(input())).not.toThrow();
  });
});
