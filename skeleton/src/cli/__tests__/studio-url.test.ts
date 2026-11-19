import { describe, expect, it } from 'vitest';
import { decodeStudioHash, encodeStudioHash, studioUrl } from '../studio-url.js';

describe('studio hash', () => {
  it('sorts dimensions by name and writes SI numbers', () => {
    expect(encodeStudioHash({ reqId: 'R3', seed: 417, scenario: { 'push.force': 168, 'push.angle': 2.356 } }))
      .toBe('#r=R3&seed=417&d.push.angle=2.356&d.push.force=168');
  });

  it('escapes reserved URL characters in dimension names and ids', () => {
    const h = { reqId: '1.2 & x', seed: 1, scenario: { 'a=b&c#d': 1 } };
    expect(decodeStudioHash(encodeStudioHash(h))).toEqual(h);
  });

  it('keeps negative zero and tiny values', () => {
    const h = { reqId: 'x', seed: 0, scenario: { z: -0, t: 1e-7, big: 1.5e21 } };
    const d = decodeStudioHash(encodeStudioHash(h));
    expect(Object.is(d.scenario['z'], -0)).toBe(true);
    expect(d.scenario['t']).toBe(1e-7);
    expect(d.scenario['big']).toBe(1.5e21);
  });

  it('rejects NaN and infinities on encode', () => {
    expect(() => encodeStudioHash({ reqId: 'x', seed: 1, scenario: { a: NaN } })).toThrow(/finite/);
    expect(() => encodeStudioHash({ reqId: 'x', seed: 1, scenario: { a: Infinity } })).toThrow(/finite/);
  });

  it.each(['', '#', '#r=x', '#r=x&seed=-1', '#r=x&seed=1&d.a=abc', '#r=x&seed=1&q=1', '#r=%E0&seed=1', '#seed=1&r=x'])(
    'throws on the malformed hash %j', (h) => { expect(() => decodeStudioHash(h)).toThrow(/malformed studio hash/); },
  );

  it('falls back to a relative path built from the app id', () => {
    expect(studioUrl({}, 'stagger', { reqId: 'R1', seed: 2, scenario: {} })).toBe('apps/stagger/web/index.html#r=R1&seed=2');
  });

  it('replaces an existing hash on the configured studio URL', () => {
    expect(studioUrl({ studioUrl: 'https://x.test/s.html#old' }, 'a', { reqId: 'R1', seed: 2, scenario: { f: 1 } }))
      .toBe('https://x.test/s.html#r=R1&seed=2&d.f=1');
  });
});
