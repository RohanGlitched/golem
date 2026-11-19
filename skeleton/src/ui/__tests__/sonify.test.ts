import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DRONE_MAX_HZ, DRONE_MIN_HZ, GAINS, MASTER_GAIN, THUD_MIN_MS, ThudLimiter, droneHz, marginScale, panOf,
} from '../core/sonify-math.js';
import { Sonifier } from '../signature/sonifier.js';
import type { AudioContextLike } from '../signature/sonifier.js';

describe('sound mapping', () => {
  // Feature: golem-signature, Property 8: Sound mapping
  it('keeps the drone within an octave of 55 Hz and never lowers it as the margin grows', () => {
    fc.assert(fc.property(fc.double({ min: -1e3, max: 1e3, noNaN: true }), fc.double({ min: 0, max: 10, noNaN: true }),
      fc.constantFrom('m', 'deg', 'rad', 'm/s', 's', 'N', ''), (m, d, unit) => {
        const s = marginScale(unit);
        const a = droneHz(m, s), b = droneHz(m + d, s);
        expect(a).toBeGreaterThanOrEqual(DRONE_MIN_HZ);
        expect(a).toBeLessThanOrEqual(DRONE_MAX_HZ);
        expect(b).toBeGreaterThanOrEqual(a);
      }), { numRuns: 300 });
  });
  it('pans within [-1, 1] and spaces thuds at least 60 ms apart', () => {
    fc.assert(fc.property(fc.double({ noNaN: false }), (x) => { const p = panOf(x); expect(p).toBeGreaterThanOrEqual(-1); expect(p).toBeLessThanOrEqual(1); }), { numRuns: 300 });
    fc.assert(fc.property(fc.array(fc.double({ min: 0, max: 5000, noNaN: true }), { maxLength: 60 }), (ts) => {
      const l = new ThudLimiter();
      const allowed = [...ts].sort((a, b) => a - b).filter((t) => l.allow(t));
      for (let i = 1; i < allowed.length; i++) expect((allowed[i] as number) - (allowed[i - 1] as number)).toBeGreaterThanOrEqual(THUD_MIN_MS);
    }), { numRuns: 300 });
  });
  it('keeps every gain at or below 0.12', () => {
    for (const g of GAINS) expect(g).toBeLessThanOrEqual(MASTER_GAIN);
    expect(MASTER_GAIN).toBeLessThanOrEqual(0.12);
  });
  it('is 55 Hz for an unknown margin and lower for a negative one', () => {
    expect(droneHz(Number.NaN, 0.1)).toBe(55);
    expect(droneHz(-0.07, 0.1)).toBeLessThan(55);
    expect(droneHz(0.2, 0.1)).toBeGreaterThan(55);
  });
});

/** A recording AudioContext stand-in. */
function fakeAudio() {
  const log: string[] = [];
  const param = (name: string) => ({
    value: 0,
    setTargetAtTime(v: number) { log.push(`${name}->${v.toFixed(2)}`); this.value = v; },
    setValueAtTime(v: number) { this.value = v; }, exponentialRampToValueAtTime(v: number) { this.value = v; },
    cancelScheduledValues() {},
  });
  const node = (kind: string) => {
    log.push(`create ${kind}`);
    return {
      kind, gain: param(`${kind}.gain`), frequency: param(`${kind}.frequency`), detune: param('detune'), Q: param('Q'), pan: param('pan'),
      type: '', buffer: null as unknown, connect() {}, start() {}, stop() {},
    };
  };
  const ctx = {
    currentTime: 0, destination: {}, state: 'suspended', sampleRate: 8000,
    createGain: () => node('gain'), createOscillator: () => node('osc'), createBiquadFilter: () => node('filter'),
    createBufferSource: () => node('source'), createStereoPanner: () => node('panner'),
    createBuffer: (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) }),
    resume() { ctx.state = 'running'; return Promise.resolve(); }, suspend() { ctx.state = 'suspended'; return Promise.resolve(); },
    close() { ctx.state = 'closed'; return Promise.resolve(); },
  };
  return { ctx: ctx as unknown as AudioContextLike, log, raw: ctx };
}

describe('Sonifier', () => {
  it('creates no audio until enabled, then starts the drone at a quiet master gain', () => {
    const f = fakeAudio();
    let made = 0;
    const s = new Sonifier(() => { made++; return f.ctx; });
    s.setMargin(0.1, 'm');
    s.thud(0.5, 0);
    s.chord();
    expect(made).toBe(0);
    s.setEnabled(true);
    expect(made).toBe(1);
    expect(f.raw.state).toBe('running');
    expect(f.log).toContain(`gain.gain->${MASTER_GAIN.toFixed(2)}`);
    s.dispose();
  });
  it('moves the drone with the margin, and only when the pitch changes', () => {
    const f = fakeAudio();
    const s = new Sonifier(() => f.ctx);
    s.setEnabled(true);
    const n0 = f.log.length;
    s.setMargin(-0.05, 'm');
    expect(s.hz).toBeCloseTo(droneHz(-0.05, 0.1), 9);
    const n1 = f.log.length;
    expect(n1).toBe(n0 + 2);
    s.setMargin(-0.05, 'm');
    expect(f.log.length).toBe(n1);
    s.dispose();
  });
  it('plays a panned thud at most once per 60 ms and a chord of three sines', () => {
    const f = fakeAudio();
    const s = new Sonifier(() => f.ctx);
    s.setEnabled(true);
    s.thud(0.9, 1000);
    s.thud(0.1, 1030);
    s.thud(0.1, 1100);
    expect(s.thuds).toBe(2);
    const before = f.log.filter((l) => l === 'create osc').length;
    s.chord();
    expect(f.log.filter((l) => l === 'create osc').length - before).toBe(3);
    expect(s.chords).toBe(1);
    s.dispose();
  });
  it('stays off when the browser has no Web Audio', () => {
    const s = new Sonifier(() => undefined);
    s.setEnabled(true);
    expect(s.enabled).toBe(false);
  });
});
