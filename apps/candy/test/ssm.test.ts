import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { separation, speedScale } from '../controller/ssm';

const SRC = readFileSync(new URL('../controller/ssm.ts', import.meta.url), 'utf8');

describe('speedScale', () => {
  it('is 0 at 0.15 m and below, 1 at 0.40 m and above', () => {
    expect(speedScale(0)).toBe(0);
    expect(speedScale(0.15)).toBe(0);
    expect(speedScale(0.4)).toBe(1);
    expect(speedScale(3)).toBe(1);
  });
  it('is linear between: 0.5 at 0.275 m', () => {
    expect(speedScale(0.275)).toBeCloseTo(0.5, 12);
    expect(speedScale(0.2)).toBeCloseTo(0.2, 12);
  });
  it('is 0 when the distance is not finite', () => {
    expect(speedScale(NaN)).toBe(0);
    expect(speedScale(Infinity)).toBe(0);
    expect(speedScale(-Infinity)).toBe(0);
  });
});

describe('separation', () => {
  const hand = [0.55, 1.1, 0.3, Math.PI / 2];
  it('measures to the palm surface in front of the palm', () => {
    // 0.4 m from the palm centre along -y (away from the forearm): 0.4 - 0.05
    expect(separation([0.55, 0.7, 0.3], hand)).toBeCloseTo(0.35, 12);
  });
  it('measures to the forearm capsule beside the forearm', () => {
    // 0.2 m along the forearm (+y), 0.3 m to the side: distance to the axis is 0.3, minus the 0.04 m radius
    expect(separation([0.85, 1.3, 0.3], hand)).toBeCloseTo(0.26, 12);
  });
  it('is 0 inside a hand geom', () => {
    expect(separation([0.55, 1.1, 0.3], hand)).toBe(0);
    expect(separation([0.55, 1.3, 0.3], hand)).toBe(0);
  });
  it('is NaN or infinite for a hand that is not finite, so the speed scale is 0', () => {
    expect(speedScale(separation([0, 0, 0], [NaN, 0, 0, 0]))).toBe(0);
    expect(speedScale(separation([0, 0, 0], [0, 0, 0, NaN]))).toBe(0);
    expect(speedScale(separation([0, 0, 0], [Infinity, 0, 0, 0]))).toBe(0);
    expect(speedScale(separation([0, 0, NaN], [0, 1, 0, 0]))).toBe(0);
  });
  it('takes the tip and the hand pose only: no link, no model', () => {
    expect(separation.length).toBe(2);
    expect(speedScale.length).toBe(1);
  });
  it('states in its source header that it measures from the Tip only and that this is the known limit of v1', () => {
    const header = SRC.slice(0, SRC.indexOf('import'));
    expect(header).toMatch(/measures the separation from the suction-cup TIP ONLY/);
    expect(header).toMatch(/known limit of v1/);
    expect(header).toMatch(/Do not add a second\s+\*?\s*distance check/);
  });
  it('imports nothing but constants: no model, no MuJoCo, no other controller module', () => {
    const imports = [...SRC.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    expect(imports).toEqual(['../constants']);
  });
});
