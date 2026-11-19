import { describe, expect, it } from 'vitest';
import { PoseRecorder } from './pose-recorder.js';

const xpos = (n: number, base: number): Float64Array => Float64Array.from({ length: 3 * n }, (_, i) => base + i);
const xquat = (n: number, base: number): Float64Array => Float64Array.from({ length: 4 * n }, (_, i) => base + i / 10);

describe('PoseRecorder', () => {
  it('lays out each body as x, y, z, qw, qx, qy, qz', () => {
    const r = new PoseRecorder(2, 1);
    r.maybeRecord(0, xpos(2, 1), xquat(2, 100));
    const { frames, nbody, fps } = r.finish();
    expect(fps).toBe(30);
    expect(nbody).toBe(2);
    expect(Array.from(frames)).toEqual(
      [1, 2, 3, 100, 100.1, 100.2, 100.3, 4, 5, 6, 100.4, 100.5, 100.6, 100.7].map(Math.fround),
    );
  });
  it('only converts to float32, and stores non-finite values unchanged', () => {
    const r = new PoseRecorder(1, 1);
    r.maybeRecord(0, Float64Array.of(Math.PI, NaN, Infinity), Float64Array.of(-Infinity, 0, 0, 0));
    const f = r.finish().frames;
    expect(f[0]).toBe(Math.fround(Math.PI));
    expect(Number.isNaN(f[1])).toBe(true);
    expect(f[2]).toBe(Infinity);
    expect(f[3]).toBe(-Infinity);
  });
  it('records the first frame, then frames at least 1/30 s apart', () => {
    const r = new PoseRecorder(1, 1);
    const p = xpos(1, 0), q = xquat(1, 0);
    const times: number[] = [];
    for (let k = 0; k <= 50; k++) { const before = r.frameCount; r.maybeRecord(0.02 * k, p, q); if (r.frameCount > before) times.push(0.02 * k); }
    expect(times[0]).toBe(0);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(1 / 30 - 1e-9);
    expect(times.slice(0, 4)).toEqual([0, 0.04, 0.08, 0.12]);
  });
  it('finish length equals nbody*7*frameCount', () => {
    const r = new PoseRecorder(3, 1);
    for (let k = 0; k < 10; k++) r.maybeRecord(k * 0.04, xpos(3, 0), xquat(3, 0));
    expect(r.finish().frames.length).toBe(3 * 7 * r.frameCount);
  });
  it('never records beyond its capacity and never grows', () => {
    const r = new PoseRecorder(1, 0.1); // capacity floor(3)+2 = 5
    for (let k = 0; k < 100; k++) r.maybeRecord(k, xpos(1, 0), xquat(1, 0));
    expect(r.frameCount).toBe(5);
    expect(r.finish().frames.buffer.byteLength).toBe(5 * 7 * 4);
  });
});
