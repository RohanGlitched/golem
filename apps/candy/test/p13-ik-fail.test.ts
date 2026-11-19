// Feature: candy-app, Property 13: IK failure contract
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IK } from '../constants';
import { IkSolver, makeIkResult } from '../controller/ik';
import { HOME, pandaEnv } from './helpers/panda';

const env = await pandaEnv();

/** Outside the envelope: farther than 0.9 m from the base, or more than 0.05 m below the Table. */
const farAway = fc.tuple(
  fc.double({ min: 0.95, max: 2, noNaN: true }), fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), fc.double({ min: -0.5, max: 1.2, noNaN: true }),
).map(([r, a, z]) => [r * Math.cos(a), r * Math.sin(a), z] as [number, number, number]);
const belowTable = fc.tuple(
  fc.double({ min: 0.3, max: 0.7, noNaN: true }), fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), fc.double({ min: -0.9, max: -0.06, noNaN: true }),
).map(([r, a, z]) => [r * Math.cos(a), r * Math.sin(a), z] as [number, number, number]);

describe('IK failure contract', () => {
  it('stops within 200 iterations and reports the true tip error of the joints it returns', () => {
    // The solver is pure kinematics: it does not know the Table. A point 6 cm below the Table is inside the arm's
    // kinematic envelope and may converge, so convergence failure is required only beyond the 0.9 m reach.
    fc.assert(fc.property(fc.oneof(farAway.map((t) => ({ t, far: true })), belowTable.map((t) => ({ t, far: false }))), ({ t, far }) => {
      const r = env.solver.solve(t, HOME, makeIkResult());
      expect(r.iterations).toBeLessThanOrEqual(IK.maxIterations);
      if (far) expect(r.converged).toBe(false);
      if (far) expect(r.error).toBeGreaterThan(0.005);
      const fk = env.fk(r.q);
      const actual = Math.hypot(fk.p[0] - t[0], fk.p[1] - t[1], fk.p[2] - t[2]);
      expect(Math.abs(r.error - actual)).toBeLessThanOrEqual(1e-9);
      // never worse than doing nothing
      const start = Math.hypot(env.fk(HOME).p[0] - t[0], env.fk(HOME).p[1] - t[1], env.fk(HOME).p[2] - t[2]);
      expect(r.error).toBeLessThanOrEqual(start + 1e-12);
    }), { numRuns: 150 });
  });

  it('returns the start configuration and Infinity when a joint of the start is not finite', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 6 }), fc.constantFrom(NaN, Infinity, -Infinity), (j, bad) => {
      const start = Float64Array.from(HOME);
      start[j] = bad;
      const r = env.solver.solve([0.5, 0, 0.1], start, makeIkResult());
      expect(r.error).toBe(Infinity);
      expect(r.converged).toBe(false);
      for (let k = 0; k < 7; k++) expect(Object.is(r.q[k], start[k])).toBe(true);
    }), { numRuns: 100 });
  });

  it('returns the start configuration and Infinity when a Jacobian entry is not finite', () => {
    const bad = Object.create(env.mj);
    let hit = 0;
    bad.mj_jacSite = (m: any, d: any, jp: any, jr: any, s: number) => {
      env.mj.mj_jacSite(m, d, jp, jr, s);
      (hit++ % 2 === 0 ? jp : jr).GetView()[2] = NaN;
    };
    const solver = new IkSolver(bad, env.model, env.site);
    try {
      fc.assert(fc.property(fc.double({ min: -0.3, max: 0.3, noNaN: true }), (d) => {
        const start = Float64Array.from(HOME); start[0] = HOME[0]! + d;
        const r = solver.solve([0.45, 0.1, 0.1], start, makeIkResult());
        expect(r.error).toBe(Infinity);
        expect(Array.from(r.q)).toEqual(Array.from(start));
      }), { numRuns: 50 });
    } finally { solver.dispose(); }
  });
});
