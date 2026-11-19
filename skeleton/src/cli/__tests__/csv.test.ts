import { describe, expect, it } from 'vitest';
import { formatNumber, traceToCsv } from '../csv.js';

const trace = {
  t: Float64Array.from([0.2, 0.22, 0.24]),
  signals: { height: Float64Array.from([1, 0.9, -0]), tilt: Float64Array.from([0, 1e-7, NaN]) },
  events: [],
};

describe('traceToCsv', () => {
  it('writes the header t then the signals in key order and one row per sample', () => {
    const lines = traceToCsv(trace).split('\n');
    expect(lines[0]).toBe('t,height,tilt');
    expect(lines).toHaveLength(5);
    expect(lines[1]).toBe('0.2,1,0');
    expect(lines[3]).toBe('0.24,-0,NaN');
  });

  it('uses the shortest round-trip decimal and keeps -0', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(formatNumber(1e-7)).toBe('1e-7');
    expect(formatNumber(-0)).toBe('-0');
    expect(formatNumber(5)).toBe('5');
  });

  it('gives byte-identical text for equal traces and uses only \\n line ends', () => {
    const a = traceToCsv(trace);
    expect(traceToCsv({ ...trace })).toBe(a);
    expect(a.includes('\r')).toBe(false);
    expect(a.endsWith('\n')).toBe(true);
  });
});
