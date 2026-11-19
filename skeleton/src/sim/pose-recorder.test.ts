import { describe, expect, it } from 'vitest';
import { PoseRecorder } from './pose-recorder.js';

const xpos = (n: number, base: number): Float64Array => Float64Array.from({ length: 3 * n }, (_, i) => base + i);
const xquat = (n: number, base: number): Float64Array => Float64Array.from({ length: 4 * n }, (_, i) => base + i / 10);

describe('PoseRecorder', () => {
  it('lays out each body as x, y, z, qw, qx, qy, qz', () => {
    const r = new PoseRecorder(2, 1, 0.002);
    r.recordStep(0, xpos(2, 1), xquat(2, 100));
    const { frames, nbody, fps } = r.finish();
    expect(fps).toBe(30);
    expect(nbody).toBe(2);
    expect(Array.from(frames)).toEqual(
      [1, 2, 3, 100, 100.1, 100.2, 100.3, 4, 5, 6, 100.4, 100.5, 100.6, 100.7].map(Math.fround),
    );
  });
  it('only converts to float32, and stores non-finite values unchanged', () => {
    const r = new PoseRecorder(1, 1, 0.002);
    r.recordStep(0, Float64Array.of(Math.PI, NaN, Infinity), Float64Array.of(-Infinity, 0, 0, 0));
    const f = r.finish().frames;
    expect(f[0]).toBe(Math.fround(Math.PI));
    expect(Number.isNaN(f[1])).toBe(true);
    expect(f[2]).toBe(Infinity);
    expect(f[3]).toBe(-Infinity);
  });
  it('records frame f at the first sim step at or after f/30 s, so frames are within one simDt of nominal', () => {
    const r = new PoseRecorder(1, 1, 0.002);
    const p = xpos(1, 0), q = xquat(1, 0);
    const steps: number[] = [];
    for (let s = 0; s <= 500; s++) { const before = r.frameCount; r.recordStep(s, p, q); if (r.frameCount > before) steps.push(s); }
    expect(steps.slice(0, 5)).toEqual([0, 17, 34, 50, 67]);
    expect(steps).toHaveLength(31);
    steps.forEach((s, f) => {
      expect(s * 0.002).toBeGreaterThanOrEqual(f / 30 - 1e-12);
      expect(s * 0.002 - f / 30).toBeLessThan(0.002);
    });
  });
  it('falls back to one frame per sim step, and reports that rate, when simDt is coarser than 1/30 s', () => {
    const r = new PoseRecorder(1, 1, 0.05);
    for (let s = 0; s <= 20; s++) r.recordStep(s, xpos(1, 0), xquat(1, 0));
    expect(r.finish().fps).toBe(20);
    expect(r.frameCount).toBe(21);
  });
  it('finish length equals nbody*7*frameCount', () => {
    const r = new PoseRecorder(3, 1, 0.002);
    for (let s = 0; s < 100; s++) r.recordStep(s, xpos(3, 0), xquat(3, 0));
    expect(r.finish().frames.length).toBe(3 * 7 * r.frameCount);
  });
  it('never records beyond its capacity and never grows', () => {
    const r = new PoseRecorder(1, 0.1, 0.002); // capacity floor(3)+2 = 5
    for (let s = 0; s < 10000; s++) r.recordStep(s, xpos(1, 0), xquat(1, 0));
    expect(r.frameCount).toBe(5);
    expect(r.finish().frames.buffer.byteLength).toBe(5 * 7 * 4);
  });
});
