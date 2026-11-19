import { describe, expect, it } from 'vitest';
import { DELAY_LENGTH } from '../constants';
import { HandDelay } from '../controller/hand-delay';

const read = (d: HandDelay, steps: number) => { const o = new Float64Array(4); d.read(steps, o); return Array.from(o); };

describe('HandDelay', () => {
  it('returns the newest sample for lag 0', () => {
    const d = new HandDelay();
    d.push(1, 2, 3, 4); d.push(5, 6, 7, 8);
    expect(read(d, HandDelay.steps(0))).toEqual([5, 6, 7, 8]);
  });
  it('returns the sample 15 steps older for a lag of 0.3 s', () => {
    const d = new HandDelay();
    for (let i = 0; i < 40; i++) d.push(i, 0, 0, 0);
    expect(HandDelay.steps(0.3)).toBe(15);
    expect(read(d, 15)[0]).toBe(39 - 15);
  });
  it('rounds the lag to whole control steps and clamps it to 15', () => {
    expect(HandDelay.steps(0.02)).toBe(1);
    expect(HandDelay.steps(0.029)).toBe(1);
    expect(HandDelay.steps(0.031)).toBe(2);
    expect(HandDelay.steps(5)).toBe(15);
    expect(HandDelay.steps(-1)).toBe(0);
    expect(HandDelay.steps(NaN)).toBe(0);
  });
  it('fills every slot with the first sample so early reads never return garbage', () => {
    const d = new HandDelay();
    d.push(9, 8, 7, 6);
    for (let k = 0; k < DELAY_LENGTH; k++) expect(read(d, k)).toEqual([9, 8, 7, 6]);
    d.push(1, 1, 1, 1);
    expect(read(d, 1)).toEqual([9, 8, 7, 6]);
    expect(read(d, 15)).toEqual([9, 8, 7, 6]);
  });
  it('keeps its buffer at 16 x 4 values', () => {
    const d = new HandDelay();
    for (let i = 0; i < 1000; i++) d.push(i, i, i, i);
    expect(d.buffer.length).toBe(64);
  });
  it('stores a non-finite sample as it is', () => {
    const d = new HandDelay();
    d.push(NaN, 0, 0, 0);
    expect(Number.isNaN(read(d, 0)[0]!)).toBe(true);
  });
});
