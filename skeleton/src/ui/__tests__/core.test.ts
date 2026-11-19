import { describe, expect, it } from 'vitest';
import { deriveStream, mulberry32 } from '../core/prng.js';
import { decimalsOf, formatSig, roundTo } from '../core/format.js';
import { TOKENS, contrastRatio } from '../core/theme-tokens.js';
import { effectiveStep, rangeOf, toDisplay, fromDisplay } from '../core/units-ui.js';
import { frameToTRS, nlerp, quatRotateWXYZ, writeMatrixTRS } from '../core/pose-math.js';
import { FixedStepAccumulator } from '../core/accumulator.js';
import { keyPushDirection, rayPlane, shovePlaneNormal, springForce } from '../core/spring.js';
import { RenderScheduler } from '../core/scheduler.js';
import { TweenLoop, tweenValue } from '../core/tween.js';
import { Announcer } from '../core/announcer.js';
import { StudioStore } from '../core/store.js';
import { FakeRaf } from './fakes.js';

describe('prng and format', () => {
  it('gives the same sequence for the same seed', () => {
    const a = mulberry32(5), b = mulberry32(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('prints no exponent for small numbers', () => {
    expect(formatSig(0.000123, 3)).toBe('0.000123');
    expect(formatSig(1.2345e-9, 3)).not.toMatch(/e/i);
  });
  it('removes binary noise when rounding', () => {
    expect(roundTo(0.30000000000000004, 2)).toBe(0.3);
    expect(decimalsOf(0.25)).toBe(2);
    expect(deriveStream(1, 'a')()).not.toBe(deriveStream(1, 'b')());
  });
});

describe('theme tokens', () => {
  it('has the dark and light token values of design-language.md', () => {
    expect(TOKENS.dark.ground).toBe('#2A211C');
    expect(TOKENS.light.hold).toBe('#2F7560');
    expect(TOKENS.dark.breakText).toBe('#DA7D6C');
    expect(TOKENS.light.holdText).toBe('#2C6352');
  });
  it('gives white on black a contrast of 21', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  });
});

describe('units-ui', () => {
  it('uses the step table with modifiers', () => {
    expect(effectiveStep('N', 'none')).toBe(1);
    expect(effectiveStep('N', 'shift')).toBe(10);
    expect(effectiveStep('N', 'alt')).toBeCloseTo(0.1);
    expect(rangeOf('ratio', '%')).toEqual({ min: 0, max: 100 });
    expect(rangeOf('angle', 'deg').max).toBe(360);
  });
  it('converts force, duration, angle and percent to display units', () => {
    expect(toDisplay(200, 'N')).toBe(200);
    expect(toDisplay(0.2, 's')).toBeCloseTo(0.2);
    expect(toDisplay(Math.PI, 'deg')).toBeCloseTo(180);
    expect(toDisplay(0.25, '%')).toBeCloseTo(25);
    expect(fromDisplay(180, 'deg')).toBeCloseTo(Math.PI);
  });
});

describe('pose-math', () => {
  it('maps identity quaternion to the identity matrix', () => {
    const m = new Float64Array(16);
    writeMatrixTRS(m, 0, 0, 0, 0, 0, 0, 0, 1);
    expect([...m]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });
  it('rotates +x to +y for a 90 degree turn about z', () => {
    const s = Math.SQRT1_2;
    const m = new Float64Array(16);
    writeMatrixTRS(m, 0, 0, 0, 0, 0, 0, s, s);
    expect(m[0]).toBeCloseTo(0); expect(m[1]).toBeCloseTo(1);
    const out = new Float64Array(3);
    quatRotateWXYZ(s, 0, 0, s, 1, 0, 0, out);
    expect(out[1]).toBeCloseTo(1);
  });
  it('reads wxyz frames as xyzw', () => {
    const f = new Float32Array([1, 2, 3, 0.5, 0.1, 0.2, 0.3]);
    const o = new Float64Array(7);
    frameToTRS(f, 1, 0, 0, o);
    expect(o[3]).toBeCloseTo(0.1); expect(o[6]).toBeCloseTo(0.5);
  });
  it('takes the shortest arc in nlerp', () => {
    const f = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0]);
    const o = new Float64Array(7);
    nlerp(f, 1, 0, 1, 0, 0.5, o);
    expect(Math.abs(o[6]!)).toBeCloseTo(1);
  });
});

describe('accumulator', () => {
  it('caps steps and discards the excess', () => {
    const a = new FixedStepAccumulator(0.01, 5);
    expect(a.add(1)).toBe(5);
    expect(a.acc).toBeGreaterThanOrEqual(0);
    expect(a.acc).toBeLessThan(0.01);
  });
  it('runs zero steps for a zero-duration frame after resume', () => {
    const a = new FixedStepAccumulator(0.01, 5);
    a.add(0.005);
    a.resumeAfterHidden();
    expect(a.add(0)).toBe(0);
  });
});

describe('spring', () => {
  it('has no shove plane with the camera straight down', () => {
    expect(shovePlaneNormal([0, 0, -1])).toBeNull();
  });
  it('has no target for a ray parallel to the plane', () => {
    expect(rayPlane([0, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0])).toBeNull();
  });
  it('caps the force at 400 N', () => {
    const f = springForce([0, 0, 0], [100, 0, 0], 600);
    expect(Math.hypot(...f)).toBeCloseTo(400);
  });
  it('maps ArrowUp to the camera forward direction', () => {
    expect(keyPushDirection('ArrowUp', [0, 1, -0.3])).toEqual([0, 1, 0]);
  });
});

describe('scheduler', () => {
  it('has no pending frame with no render reason', () => {
    const raf = new FakeRaf();
    const s = new RenderScheduler(raf, () => {});
    expect(raf.pending).toBe(0);
    expect(s.pendingFrames()).toBe(0);
  });
  it('draws a final frame after the last reason is released', () => {
    const raf = new FakeRaf();
    let drawn = 0;
    const s = new RenderScheduler(raf, () => { drawn++; });
    s.acquire('simulating');
    raf.runNext();
    s.release('simulating');
    raf.runNext();
    expect(drawn).toBe(2);
    expect(raf.pending).toBe(0);
  });
});

describe('tween, announcer, store', () => {
  it('sets the value at once under reduced motion', () => {
    const raf = new FakeRaf();
    const seen: number[] = [];
    const t = new TweenLoop({ ...raf, raf: raf.raf, caf: raf.caf, now: () => raf.time, reduced: () => true }, (_k, v) => seen.push(v));
    t.to('a', 10);
    expect(seen).toEqual([10]);
    expect(t.running).toBe(false);
  });
  it('stops its loop when idle', () => {
    const raf = new FakeRaf();
    const t = new TweenLoop({ raf: raf.raf, caf: raf.caf, now: () => raf.time, reduced: () => false }, () => {});
    t.to('a', 0); t.to('a', 5, 100);
    for (let i = 0; i < 20; i++) raf.runNext(16);
    expect(raf.pending).toBe(0);
    expect(tweenValue(0, 5, 1)).toBe(5);
  });
  it('sends errors to the alert region', () => {
    const els = { polite: { textContent: '' as string | null }, alert: { textContent: '' as string | null } };
    new Announcer(els).announceError('boom');
    expect(els.alert.textContent).toContain('boom');
    expect(els.polite.textContent).toBe('');
  });
  it('notifies once for several updates in one frame and stops after unsubscribe', () => {
    const raf = new FakeRaf();
    const st = new StudioStore({ lines: [], aura: { total: 0, ignored: 0, summary: '' }, theme: 'dark', reducedMotion: false, hero: 'loading', messages: [], stageFrames: 0, poolConfigured: true },
      { raf: (cb) => raf.raf(cb), caf: raf.caf });
    let n = 0;
    const un = st.subscribe(() => n++);
    st.update({ hero: 'running' }); st.update({ hero: 'sleeping' }); st.update({ theme: 'light' });
    raf.runNext();
    expect(n).toBe(1);
    un();
    st.update({ hero: 'failed' }); raf.runNext();
    expect(n).toBe(1);
  });
});
