// Feature: candy-app, Property 19: SSM measures from the Tip only
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HAND } from '../constants';
import { separation, speedScale } from '../controller/ssm';

const p3 = fc.tuple(fc.double({ min: -1.5, max: 1.5, noNaN: true }), fc.double({ min: -1.5, max: 1.5, noNaN: true }), fc.double({ min: -0.2, max: 1, noNaN: true }));
const yaw = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });

/** Independent oracle: distance to the palm sphere and to the forearm capsule by sampling the axis finely. */
function oracle(tip: number[], hand: number[]): number {
  const [px, py, pz, a] = hand as [number, number, number, number];
  const palm = Math.hypot(tip[0]! - px, tip[1]! - py, tip[2]! - pz) - HAND.palmRadius;
  let best = Infinity;
  const n = 3000;
  for (let i = 0; i <= n; i++) {
    const s = (HAND.forearmLength * i) / n;
    best = Math.min(best, Math.hypot(tip[0]! - (px + s * Math.cos(a)), tip[1]! - (py + s * Math.sin(a)), tip[2]! - pz));
  }
  return Math.max(0, Math.min(palm, best - HAND.forearmRadius));
}

describe('SSM from the tip only', () => {
  it('equals speedScale(separation(tip, hand)) and depends on nothing else', () => {
    fc.assert(fc.property(p3, p3, yaw, (tip, h, a) => {
      const hand = [h[0], h[1], h[2], a];
      const d = separation(tip, hand);
      // equal inputs, equal outputs, whatever else the arm is doing
      expect(separation([...tip], [...hand])).toBe(d);
      expect(speedScale(d)).toBe(speedScale(separation(tip, hand)));
      expect(Math.abs(d - oracle(tip, hand))).toBeLessThan(2e-4);
    }), { numRuns: 300 });
  });

  it('has no link, joint or model input', () => {
    expect(separation.length).toBe(2);
    const src = readFileSync(new URL('../controller/ssm.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const word of ['model', 'data', 'xpos', 'link', 'qpos', 'mj_']) expect(code).not.toContain(word);
  });
});
