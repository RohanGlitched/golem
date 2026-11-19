import { describe, expect, it } from 'vitest';
import {
  FADE_S, OPACITY_RUNNING, OPACITY_SURVIVOR, SUMMON_S, breakTime, evalGhost, newGhostEval,
} from '../ghosts/ghost-state.js';
import type { GhostRecord } from '../ghosts/ghost-state.js';
import { arrowLength, resolveArrow } from '../ghosts/push-arrow.js';
import type { PerturbationTemplate } from '../types.js';

const rec = (over: Partial<GhostRecord> = {}): GhostRecord => ({
  robustness: 0.2, worstAt: 1.2, warmup: 0.2, fps: 30, frameCount: 61, validFrames: 61, ...over,
});

describe('evalGhost', () => {
  it('keeps a survivor below the running opacity', () => {
    expect(OPACITY_SURVIVOR).toBeLessThan(OPACITY_RUNNING);
    const e = evalGhost(rec(), 1.5, false, newGhostEval());
    expect(e.breakMix).toBe(0);
    expect(e.opacity).toBe(OPACITY_SURVIVOR);
  });

  it('turns a broken ghost to the break colour at the worst moment and fades it over 0.6 s', () => {
    const g = rec({ robustness: -0.1 });
    expect(breakTime(g)).toBeCloseTo(1, 12);
    expect(evalGhost(g, 0.99, false, newGhostEval()).breakMix).toBe(0);
    const at = evalGhost(g, 1.0, false, newGhostEval());
    expect(at.breakMix).toBe(1);
    expect(at.opacity).toBeCloseTo(OPACITY_RUNNING, 12);
    expect(evalGhost(g, 1 + FADE_S / 2, false, newGhostEval()).opacity).toBeCloseTo(OPACITY_RUNNING / 2, 12);
    const end = evalGhost(g, 1 + FADE_S, false, newGhostEval());
    expect(end.opacity).toBe(0);
    expect(end.hidden).toBe(true);
  });

  it('rises from the floor over 400 ms', () => {
    expect(evalGhost(rec(), 0, false, newGhostEval()).rise).toBe(1);
    expect(evalGhost(rec(), 0, false, newGhostEval()).opacity).toBe(0);
    expect(evalGhost(rec(), SUMMON_S, false, newGhostEval()).rise).toBe(0);
  });

  it('has zero rise and a step fade under reduced motion', () => {
    const g = rec({ robustness: -1 });
    const e0 = evalGhost(g, 0, true, newGhostEval());
    expect(e0.rise).toBe(0);
    expect(e0.opacity).toBe(OPACITY_RUNNING);
    const e1 = evalGhost(g, 1.0, true, newGhostEval());
    expect(e1.opacity).toBe(0);
    expect(e1.hidden).toBe(true);
    expect(evalGhost(g, 0.5, true, newGhostEval()).alpha).toBe(0);
  });

  it('breaks at the recorded worstAt for a diverged trial', () => {
    const g = rec({ robustness: -Infinity, worstAt: 0.7 });
    expect(evalGhost(g, 0.49, false, newGhostEval()).breakMix).toBe(0);
    expect(evalGhost(g, 0.5, false, newGhostEval()).breakMix).toBe(1);
  });

  it('holds the last frame at tau = T even when T * fps rounds below N - 1', () => {
    const g = rec({ fps: 49, frameCount: 2, validFrames: 2 });
    expect(evalGhost(g, 1 / 49, false, newGhostEval()).frame).toBe(1);
    expect(evalGhost(g, 0.020408163265306124, false, newGhostEval()).frame).toBe(1);
  });

  it('holds the last frame after the recording ends and the last finite frame', () => {
    expect(evalGhost(rec(), 10, false, newGhostEval()).frame).toBe(60);
    const e = evalGhost(rec({ validFrames: 20 }), 1.5, false, newGhostEval());
    expect(e.frame).toBe(19);
    expect(e.alpha).toBe(0);
  });
});

const tpl = (visual?: PerturbationTemplate['visual']): PerturbationTemplate => ({
  phrase: 'push', dims: () => [], apply: () => {}, ...(visual ? { visual } : {}),
});
const call = { template: 'push', params: { force: 'push.force', duration: 0.3 } };
const bodies = (n: string) => (n === 'bob' ? 2 : -1);

describe('resolveArrow', () => {
  it('draws no arrow for a template without visual', () => {
    expect(resolveArrow(call, tpl(), { 'push.force': 100 }, bodies)).toBeUndefined();
  });
  it('draws no arrow for a zero force', () => {
    expect(resolveArrow(call, tpl((v) => ({ force: [v['force']!, 0, 0], at: 'bob' })), { 'push.force': 0 }, bodies)).toBeUndefined();
  });
  it('draws a 0.3 m arrow for a 100 N force at the named body until the push ends', () => {
    const a = resolveArrow(call, tpl((v) => ({ force: [0, v['force']!, 0], at: 'bob' })), { 'push.force': 100 }, bodies)!;
    expect(a.length).toBeCloseTo(0.3, 12);
    expect(a.dir).toEqual([0, 1, 0]);
    expect(a.body).toBe(2);
    expect(a.tEnd).toBe(0.3);
  });
  it('clamps the length to [0.05, 0.9] m', () => {
    expect(arrowLength(1)).toBe(0.05);
    expect(arrowLength(1000)).toBe(0.9);
  });
});
