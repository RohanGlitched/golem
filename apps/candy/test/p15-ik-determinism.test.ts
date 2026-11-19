// Feature: candy-app, Property 15: IK is deterministic and leaves state untouched
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IkSolver, makeIkResult } from '../controller/ik';
import { HOME, pandaEnv } from './helpers/panda';

const env = await pandaEnv();

const target = fc.tuple(fc.double({ min: 0.2, max: 0.9, noNaN: true }), fc.double({ min: -0.5, max: 0.5, noNaN: true }), fc.double({ min: 0, max: 0.4, noNaN: true }));
const offsets = fc.array(fc.double({ min: -0.2, max: 0.2, noNaN: true }), { minLength: 7, maxLength: 7 });

describe('IK determinism', () => {
  it('gives bit-identical joints, error and iteration count for equal inputs, even on a second solver', () => {
    const other = new IkSolver(env.mj, env.model, env.site);
    try {
      fc.assert(fc.property(target, offsets, (t, d) => {
        const q0 = Float64Array.from(HOME, (v, j) => v + d[j]!);
        const a = env.solver.solve(t, q0, makeIkResult());
        const b = env.solver.solve(t, q0, makeIkResult());
        const c = other.solve(t, q0, makeIkResult());
        for (const x of [b, c]) {
          for (let j = 0; j < 7; j++) expect(Object.is(a.q[j], x.q[j])).toBe(true);
          expect(Object.is(a.error, x.error)).toBe(true);
          expect(a.iterations).toBe(x.iterations);
        }
      }), { numRuns: 100 });
    } finally { other.dispose(); }
  });

  it('leaves the qpos of a live MjData untouched and does not modify its start argument', () => {
    const live = new env.mj.MjData(env.model);
    try {
      fc.assert(fc.property(target, offsets, (t, d) => {
        for (let j = 0; j < 7; j++) live.qpos[j] = HOME[j]! + d[j]!;
        const before = Float64Array.from(live.qpos);
        const q0 = Float64Array.from(live.qpos.slice(0, 7));
        const q0Copy = Float64Array.from(q0);
        env.solver.solve(t, q0, makeIkResult());
        const after = live.qpos as Float64Array;
        for (let k = 0; k < before.length; k++) expect(Object.is(before[k], after[k])).toBe(true);
        for (let j = 0; j < 7; j++) expect(Object.is(q0[j], q0Copy[j])).toBe(true);
      }), { numRuns: 50 });
    } finally { live.delete(); }
  });
});
