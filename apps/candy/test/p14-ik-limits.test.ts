// Feature: candy-app, Property 14: IK joint limits and step limit
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IK } from '../constants';
import { IkSolver, makeIkResult } from '../controller/ik';
import { pandaEnv } from './helpers/panda';

const env = await pandaEnv();

/** A start configuration inside the limits, optionally within 0.05 rad of a singular pose (elbow stretched, wrist flat). */
const start = fc.tuple(
  ...env.jointRange.map(([lo, hi]) => fc.double({ min: lo! + 1e-3, max: hi! - 1e-3, noNaN: true })),
  fc.boolean(), fc.boolean(), fc.double({ min: 0, max: 0.05, noNaN: true }),
).map((v) => {
  const q = Float64Array.from(v.slice(0, 7) as number[]);
  if (v[7]) q[3] = Math.min(env.jointRange[3]![1]! - 1e-3, -0.0698 - (v[9] as number) + 0.05 * 0);   // elbow at its stretched limit
  if (v[8]) q[5] = env.jointRange[5]![0]! + 1e-3 + (v[9] as number);                                  // wrist flat
  return q;
});
const target = fc.tuple(fc.double({ min: -1.2, max: 1.2, noNaN: true }), fc.double({ min: -1.2, max: 1.2, noNaN: true }), fc.double({ min: -0.3, max: 1.2, noNaN: true }));

describe('IK limits', () => {
  it('keeps every joint inside its limits and changes no joint by more than 0.10 rad per iteration', () => {
    // each iteration runs mj_kinematics once on the scratch data, with the iterate in qpos
    const iterates: number[][] = [];
    const spy = Object.create(env.mj);
    spy.mj_kinematics = (m: any, d: any) => { iterates.push(Array.from((d.qpos as Float64Array).slice(0, 7))); env.mj.mj_kinematics(m, d); };
    const solver = new IkSolver(spy, env.model, env.site);
    try {
      fc.assert(fc.property(start, target, (q0, t) => {
        iterates.length = 0;
        const r = solver.solve(t, q0, makeIkResult());
        for (let j = 0; j < 7; j++) {
          expect(r.q[j]).toBeGreaterThanOrEqual(env.jointRange[j]![0]!);
          expect(r.q[j]).toBeLessThanOrEqual(env.jointRange[j]![1]!);
        }
        expect(iterates.length).toBeLessThanOrEqual(IK.maxIterations + 1);
        for (let i = 1; i < iterates.length; i++) {
          for (let j = 0; j < 7; j++) {
            expect(Math.abs(iterates[i]![j]! - iterates[i - 1]![j]!)).toBeLessThanOrEqual(IK.stepLimit + 1e-12);
          }
        }
      }), { numRuns: 150 });
    } finally { solver.dispose(); }
  });
});
