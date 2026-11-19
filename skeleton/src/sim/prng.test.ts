import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from './prng.js';
import { SEED } from './test-support.js';

describe('mulberry32', () => {
  it('gives equal first 1000 values for equal seeds', () => {
    const a = mulberry32(12345), b = mulberry32(12345);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });
  it('gives different sequences for different seeds', () => {
    const a = mulberry32(1), b = mulberry32(2);
    let differ = false;
    for (let i = 0; i < 10; i++) if (a() !== b()) differ = true;
    expect(differ).toBe(true);
  });
  it('stays in [0, 1)', () => {
    const r = mulberry32(0xffffffff);
    for (let i = 0; i < 10000; i++) {
      const v = r();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });
  it('uses no global random source anywhere under skeleton/src/sim', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const needle = 'Math.' + 'random';
    const offenders: string[] = [];
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && readFileSync(p, 'utf8').includes(needle)) offenders.push(p);
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });
});

// Feature: golem-sim, Property 20 (PRNG part): PRNG and seed behaviour
describe('mulberry32 properties', () => {
  it('yields values in [0, 1) and equal sequences for equal seeds', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4294967295 }), (seed) => {
        const a = mulberry32(seed), b = mulberry32(seed);
        for (let i = 0; i < 1000; i++) {
          const x = a();
          if (!(x >= 0 && x < 1) || x !== b()) return false;
        }
        return true;
      }),
      { numRuns: 100, seed: SEED },
    );
  });
});
