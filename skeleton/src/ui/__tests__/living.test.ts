import { describe, expect, it } from 'vitest';
import {
  LEAN_CAP_DEG, boundValues, forceFraction, fractureSignal, fractureWord, fuseFill, harshestScenario, leanDeg, livingSegments,
  signedMarginText,
} from '../tablet/living.js';

const G1 = 'WHEN the pelvis is pushed with up to 250 N for 0.2 s from behind at any point in its stride THE robot SHALL stay upright for 3 s';

describe('livingSegments', () => {
  const segs = livingSegments(G1);
  it('binds "upright" to the tilt, the response duration to the fuse and the force to the underline', () => {
    expect(segs.filter((s) => s.bind === 'tilt').map((s) => s.text)).toEqual(['upright']);
    expect(segs.filter((s) => s.bind === 'fuse').map((s) => s.text)).toEqual(['3 s']);
    expect(segs.filter((s) => s.bind === 'force').map((s) => s.text)).toEqual(['250 N']);
  });
  it('does not bind the trigger duration to the fuse', () => {
    expect(segs.find((s) => s.text === '0.2 s')?.bind).toBeUndefined();
  });
  it('marks only the words after SHALL as the response clause', () => {
    expect(segs.filter((s) => s.response).map((s) => s.text).join('')).toBe(' stay upright for 3 s');
  });
  it('gives the bound values in SI', () => {
    expect(boundValues(segs)).toEqual({ fuseS: 3, forceN: 250 });
    expect(boundValues(livingSegments('WHEN x THE robot SHALL stay upright for 300 ms')).fuseS).toBeCloseTo(0.3, 12);
  });
  it('binds the larger end of a force range', () => {
    const r = livingSegments('WHEN the pelvis is pushed with 150 to 250 N for 0.2 s THE robot SHALL stay upright for 3 s');
    expect(r.filter((s) => s.bind === 'force').map((s) => s.text)).toEqual(['250 N']);
  });
  it('accepts extra tilt words', () => {
    const r = livingSegments('THE robot SHALL keep its torso plumb', ['plumb']);
    expect(r.filter((s) => s.bind === 'tilt').map((s) => s.text)).toEqual(['plumb']);
  });
});

describe('leanDeg, fuseFill, forceFraction', () => {
  it('is 0 for an upright body and caps a large lean at 12 degrees', () => {
    expect(leanDeg(1, 0, 0, 0, 1, 0, 0)).toBe(0);
    // 30 degrees about -y tips the body z axis toward +x.
    const h = (-30 * Math.PI) / 360;
    expect(leanDeg(Math.cos(h), 0, Math.sin(-h), 0, 1, 0, 0)).toBe(LEAN_CAP_DEG);
    expect(leanDeg(Math.cos(h), 0, Math.sin(-h), 0, -1, 0, 0)).toBe(-LEAN_CAP_DEG);
  });
  it('reads a small lean exactly', () => {
    const a = 5, h = (a * Math.PI) / 360;
    expect(leanDeg(Math.cos(h), 0, Math.sin(h), 0, 1, 0, 0)).toBeCloseTo(a, 9);
  });
  it('burns the fuse over the window and clamps it', () => {
    expect(fuseFill(1.5, 3)).toBe(0.5);
    expect(fuseFill(-1, 3)).toBe(0);
    expect(fuseFill(9, 3)).toBe(1);
    expect(fuseFill(1, Number.NaN)).toBe(0);
  });
  it('gives the push force over the line force', () => {
    expect(forceFraction(125, 250)).toBe(0.5);
    expect(forceFraction(400, 250)).toBe(1);
    expect(forceFraction(0, 250)).toBe(0);
  });
});

describe('fractureSignal and fractureWord', () => {
  it('picks the negative signal whose lowest margin came first', () => {
    expect(fractureSignal({ pelvis_z: -0.07, tilt_deg: -0.01 }, { pelvis_z: 4.2, tilt_deg: 3.1 })).toBe('tilt_deg');
    expect(fractureSignal({ pelvis_z: -0.07, tilt_deg: 0.2 }, { pelvis_z: 4.2, tilt_deg: 3.1 })).toBe('pelvis_z');
    expect(fractureSignal({ a: 0.1 }, { a: 1 })).toBeUndefined();
    expect(fractureSignal(undefined, undefined)).toBeUndefined();
  });
  it('maps the G1 upright signals to "upright"', () => {
    const segs = livingSegments(G1);
    expect(fractureWord(segs, 'pelvis_z')?.text).toBe('upright');
    expect(fractureWord(segs, 'tilt_deg')?.text).toBe('upright');
  });
  it('uses a word the signal name contains, then the app mapping first', () => {
    const segs = livingSegments('THE robot SHALL keep its pelvis above 0.5 m');
    expect(fractureWord(segs, 'pelvis_z')?.text).toBe('pelvis');
    expect(fractureWord(segs, 'pelvis_z', { pelvis_z: ['above'] })?.text).toBe('above');
    expect(fractureWord(segs, 'mystery')?.text).toBe('keep');
  });
  it('writes the margin with a real minus sign and its unit', () => {
    expect(signedMarginText(-0.0712, 'm')).toBe('\u22120.071 m');
    expect(signedMarginText(-0.07, 'm')).toBe('\u22120.07 m');
    expect(signedMarginText(-Number.MAX_VALUE, 'm')).toBe('diverged');
  });
});

describe('harshestScenario', () => {
  it('takes the max of an up dimension, the min of a down one and the middle otherwise', () => {
    expect(harshestScenario({ dims: [
      { name: 'f', kind: 'force', min: 0, max: 250, severity: 'up' },
      { name: 'mu', kind: 'ratio', min: 0.3, max: 1, severity: 'down' },
      { name: 'a', kind: 'angle', min: 2, max: 4, severity: 'none' },
    ] })).toEqual({ f: 250, mu: 0.3, a: 3 });
  });
});
