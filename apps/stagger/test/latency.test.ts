import { describe, expect, it } from 'vitest';
import { LatencyBuffer, delaySteps } from '../controller/latency';

const row = (v: number): Float64Array => new Float64Array(47).fill(v);

describe('latency', () => {
  it('returns the current observation for a delay of 0', () => {
    const b = new LatencyBuffer();
    const out = new Float64Array(47);
    b.push(row(1)); b.push(row(2));
    b.delayed(0, out);
    expect(out[0]).toBe(2);
  });
  it('returns the observation d steps earlier', () => {
    const b = new LatencyBuffer();
    const out = new Float64Array(47);
    for (let i = 0; i < 40; i++) b.push(row(i));
    b.delayed(5, out); expect(out[46]).toBe(34);
    b.delayed(25, out); expect(out[0]).toBe(14);
  });
  it('falls back to the oldest stored row when fewer exist', () => {
    const b = new LatencyBuffer();
    const out = new Float64Array(47);
    b.push(row(7)); b.push(row(8));
    b.delayed(10, out);
    expect(out[0]).toBe(7);
  });
  it('clamps a delay above 25 steps to 25', () => {
    const b = new LatencyBuffer();
    const out = new Float64Array(47);
    for (let i = 0; i < 60; i++) b.push(row(i));
    b.delayed(40, out);
    expect(out[0]).toBe(59 - 25);
  });
  it('converts a duration to whole Control_Steps, clamped to [0, 25]', () => {
    expect(delaySteps(0)).toBe(0);
    expect(delaySteps(0.04)).toBe(2);
    expect(delaySteps(0.5)).toBe(25);
    expect(delaySteps(2)).toBe(25);
    expect(delaySteps(-1)).toBe(0);
  });
});