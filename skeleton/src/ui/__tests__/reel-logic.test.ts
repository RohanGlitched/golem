import { describe, expect, it } from 'vitest';
import { filmstripFrames } from '../reel/filmstrip.js';
import { ReplayController } from '../reel/replay.js';
import { synthPoses } from './fakes.js';

describe('filmstripFrames', () => {
  it('spaces eight frames over the worst moment plus and minus 0.35 s', () => {
    const f = filmstripFrames(1, 61, 30);
    expect(f).toHaveLength(8);
    expect(f[0]!.tau).toBeCloseTo(0.65, 12);
    expect(f[7]!.tau).toBeCloseTo(1.35, 12);
    expect(f.filter((e) => e.isWorst)).toHaveLength(1);
  });
  it('clamps tau to 0 for a worst moment near the start', () => {
    const f = filmstripFrames(0.1, 61, 30);
    expect(f[0]!.tau).toBe(0);
    expect(f[0]!.frame).toBe(0);
    expect(f[7]!.tau).toBeCloseTo(0.45, 12);
  });
  it('returns eight entries at frame 0 for a single-frame recording', () => {
    const f = filmstripFrames(2, 1, 30);
    expect(f.map((e) => e.frame)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(f[0]!.isWorst).toBe(true);
  });
});

function makeReplay(reduced = false) {
  const log: string[] = [];
  const r = new ReplayController({
    hero: { snapshot: () => log.push('snapshot'), restore: () => log.push('restore'), pause: () => log.push('pause'), resume: () => log.push('resume') },
    scheduler: { acquire: (x) => log.push(`acquire:${x}`), release: (x) => log.push(`release:${x}`) },
    reduced: () => reduced,
  });
  r.load(synthPoses(2, 31, 30), 0.5);
  return { r, log };
}

describe('ReplayController', () => {
  it('applies the replay pose to the hero body groups with the ghost pose conversion', async () => {
    const { applyReplayPose } = await import('../reel/replay.js');
    const p = synthPoses(2, 31, 30);
    const got: number[][] = [];
    const g = () => ({ position: { set: (...a: number[]) => { got.push(a); } }, quaternion: { set: (...a: number[]) => { got.push(a); } } });
    applyReplayPose([g(), g()], p, 10 / 30, true, new Float64Array(7));
    const o = (10 * 2 + 1) * 7;
    expect(got[2]).toEqual([p.frames[o], p.frames[o + 1], p.frames[o + 2]].map((x) => Math.fround(x!)));
    expect(got[3]).toEqual([p.frames[o + 4], p.frames[o + 5], p.frames[o + 6], p.frames[o + 3]]);
  });
  it('calls the enter and exit hooks once each', () => {
    const { r, log } = makeReplay();
    r.enter(); r.enter();
    r.exit(); r.exit();
    expect(log).toEqual(['snapshot', 'pause', 'acquire:replaying', 'restore', 'resume', 'release:replaying']);
  });
  it('plays at 0.25 times real time and stops at the last frame', () => {
    const { r } = makeReplay();
    r.enter();
    r.advance(1);
    expect(r.t).toBeCloseTo(0.25, 12);
    r.advance(100);
    expect(r.t).toBe(1);
    expect(r.playing).toBe(false);
    r.play();
    expect(r.t).toBe(0);
  });
  it('restores the snapshot on Back to live', () => {
    const { r, log } = makeReplay();
    r.enter();
    r.seekFrame(10);
    r.exit();
    expect(log).toContain('restore');
    expect(r.active).toBe(false);
  });
  it('does not advance by itself under reduced motion and steps one frame', () => {
    const { r } = makeReplay(true);
    r.enter();
    expect(r.playing).toBe(false);
    r.advance(1);
    expect(r.t).toBe(0);
    r.stepFrame(1);
    expect(r.t).toBeCloseTo(1 / 30, 12);
  });
});
