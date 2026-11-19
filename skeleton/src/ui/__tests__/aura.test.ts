import { describe, expect, it } from 'vitest';
import { AURA_RMAX, AuraModel, auraDims, binOf, boundaryForce, binRadius, encodeTexels, radiusAt } from '../aura/aura-model.js';
import { NO_AURA_TEXT, NO_TRIALS_TEXT, auraSummary } from '../aura/aura-summary.js';

const deg = (d: number) => (d * Math.PI) / 180;

describe('AuraModel', () => {
  it('has 36 bins and wraps angles into them', () => {
    expect(binOf(0)).toBe(0);
    expect(binOf(deg(9.99))).toBe(0);
    expect(binOf(deg(10.01))).toBe(1);
    expect(binOf(deg(359.9))).toBe(35);
    expect(binOf(deg(-5))).toBe(35);
    expect(binOf(deg(365))).toBe(0);
  });

  it('counts robustness exactly 0 as held', () => {
    const m = new AuraModel(200);
    m.add(deg(15), 120, 0);
    expect(m.held[1]).toBe(120);
    expect(m.broke[1]).toBe(Infinity);
    expect(m.ticks).toHaveLength(0);
  });

  it('records the lowest broken force and a tick for each break', () => {
    const m = new AuraModel(200);
    m.add(deg(15), 150, -0.1);
    m.add(deg(16), 130, -0.2);
    m.add(deg(17), 170, -0.2);
    expect(m.broke[1]).toBe(130);
    expect(m.ticks.map((t) => t.force)).toEqual([130, 150, 170]);
  });

  it('ignores a NaN robustness and counts it', () => {
    const m = new AuraModel(200);
    m.add(deg(15), 150, Number.NaN);
    expect(m.ignored).toBe(1);
    expect(m.total).toBe(1);
    expect(boundaryForce(m, 1)).toBeUndefined();
  });

  it('resets every bin when the source changes', () => {
    const m = new AuraModel(200);
    m.add(deg(15), 150, -1); m.add(deg(95), 50, 1);
    m.reset(300);
    expect(m.forceMax).toBe(300);
    expect(m.total).toBe(0);
    expect([...m.held].every((v) => v === -Infinity)).toBe(true);
    expect([...m.broke].every((v) => v === Infinity)).toBe(true);
    expect(m.ticks).toHaveLength(0);
  });

  it('prefers the broken force as the boundary and scales the radius to AURA_RMAX', () => {
    const m = new AuraModel(200);
    m.add(deg(5), 180, 1);
    m.add(deg(5), 100, -1);
    expect(boundaryForce(m, 0)).toBe(100);
    expect(binRadius(m, 0)).toBeCloseTo(AURA_RMAX / 2, 12);
    m.add(deg(25), 400, 1);
    expect(binRadius(m, 2)).toBe(AURA_RMAX);
    expect(binRadius(m, 3)).toBe(0);
  });

  it('interpolates linearly between bin centres', () => {
    const m = new AuraModel(100);
    m.add(deg(5), 50, 1);
    m.add(deg(15), 100, 1);
    expect(radiusAt(m, deg(5))).toBeCloseTo(AURA_RMAX / 2, 12);
    expect(radiusAt(m, deg(10))).toBeCloseTo(0.75 * AURA_RMAX, 12);
    expect(radiusAt(m, deg(15))).toBeCloseTo(AURA_RMAX, 12);
  });

  it('writes G = 255 for a bin with a break', () => {
    const m = new AuraModel(100);
    m.add(deg(5), 50, -1);
    m.add(deg(15), 100, 1);
    const tex = new Uint8Array(36 * 4);
    encodeTexels(m, tex);
    expect([tex[0], tex[1]]).toEqual([128, 255]);
    expect([tex[4], tex[5]]).toEqual([255, 0]);
    expect([tex[8], tex[9]]).toEqual([0, 0]);
  });

  it('has no aura when the space lacks a force or an angle dimension', () => {
    expect(auraDims({ dims: [{ name: 'f', kind: 'force', min: 0, max: 1, severity: 'up' }] })).toBeUndefined();
    const both = auraDims({
      dims: [
        { name: 'p', kind: 'phase', min: 0, max: 1, severity: 'none' },
        { name: 'f', kind: 'force', min: 0, max: 1, severity: 'up' },
        { name: 'a', kind: 'angle', min: 0, max: 6, severity: 'none', wrap: true },
        { name: 'a2', kind: 'angle', min: 0, max: 6, severity: 'none', wrap: true },
      ],
    });
    expect(both?.force.name).toBe('f');
    expect(both?.angle.name).toBe('a');
  });
});

describe('auraSummary', () => {
  it('says there is nothing to map without force and direction', () => {
    expect(auraSummary(undefined)).toBe(NO_AURA_TEXT);
  });
  it('says no trials yet on an empty model', () => {
    expect(auraSummary(new AuraModel(200))).toBe(NO_TRIALS_TEXT);
  });
  it('names the weakest direction and its force', () => {
    const m = new AuraModel(200);
    m.add(deg(135), 168.4, -0.2);
    m.add(deg(45), 190, -0.2);
    expect(auraSummary(m)).toBe('Weakest direction 135 deg: breaks at 168 N');
  });
  it('takes the lowest bin index on a tie', () => {
    const m = new AuraModel(200);
    m.add(deg(275), 100, -1);
    m.add(deg(95), 100, -1);
    expect(auraSummary(m)).toBe('Weakest direction 95 deg: breaks at 100 N');
  });
  it('reports no break found with the strongest held push and the trial count', () => {
    const m = new AuraModel(200);
    m.add(deg(35), 150, 0.3);
    m.add(deg(215), 150, 0.3);
    m.add(deg(100), 20, 0.3);
    expect(auraSummary(m)).toBe('No break found. Strongest push held: 150 N at 35 deg in 3 trials');
  });
});
