import { describe, expect, it } from 'vitest';
import { mulberry32 as simMulberry } from '../sim/prng.js';
import { deriveSeed, fmix32, hashString, mulberry32, SALT } from './prng.js';

describe('fmix32', () => {
  it('maps 0 to 0 and 1 to the murmur3 reference value', () => {
    expect(fmix32(0)).toBe(0);
    expect(fmix32(1)).toBe(0x514e28b7);
  });
  it('returns uint32 for negative and oversized input', () => {
    expect(fmix32(-1)).toBeGreaterThanOrEqual(0);
    expect(fmix32(2 ** 32 + 5)).toBe(fmix32(5));
  });
});

describe('mulberry32', () => {
  it('matches the sim module stream for the same seed', () => {
    const a = mulberry32(12345); const b = simMulberry(12345);
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });
  it('stays in [0, 1) and is repeatable', () => {
    const a = mulberry32(7); const b = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const x = a();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(b()).toBe(x);
    }
  });
});

describe('hashString', () => {
  it('is the same for equal strings and differs for different dimension names', () => {
    expect(hashString('push.force')).toBe(hashString('push.force'));
    expect(hashString('push.force')).not.toBe(hashString('push.angle'));
    expect(hashString('')).toBe(fmix32(0x811c9dc5));
  });
});

describe('deriveSeed', () => {
  it('returns a uint32 and the same value for the same inputs', () => {
    const s = deriveSeed(42, SALT.phase1, 0);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(2 ** 32);
    expect(deriveSeed(42, SALT.phase1, 0)).toBe(s);
  });
  it('gives distinct seeds for distinct indices in 5000 trials', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) seen.add(deriveSeed(99, SALT.phase2, i));
    expect(seen.size).toBe(5000);
  });
  it('gives different streams for different phases', () => {
    expect(deriveSeed(1, 1, 0)).not.toBe(deriveSeed(1, 2, 0));
  });
  it('has fixed expected values (regression anchors)', () => {
    expect(deriveSeed(0, 1, 0)).toBe(fmix32(fmix32(Math.imul(2, 0x9e3779b1) >>> 0)));
    expect(deriveSeed(123, 3, 7)).toBe(
      fmix32((fmix32((123 ^ Math.imul(4, 0x9e3779b1)) >>> 0) + Math.imul(7, 0x9e3779b9)) >>> 0),
    );
  });
});
