// Feature: candy-app, Property 12: IK converges on reachable points
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IK, REACHABLE } from '../constants';
import { makeIkResult } from '../controller/ik';
import { HOME, pandaEnv } from './helpers/panda';

const env = await pandaEnv();

/** A point of the reachable box of the design constants table. */
const reachable = fc.tuple(
  fc.double({ min: REACHABLE.xMin, max: REACHABLE.xMax, noNaN: true }),
  fc.double({ min: -REACHABLE.yAbsMax, max: REACHABLE.yAbsMax, noNaN: true }),
  fc.double({ min: REACHABLE.zMin, max: REACHABLE.zMax, noNaN: true }),
).filter(([x, y]) => Math.hypot(x, y) <= REACHABLE.rMax);

describe('IK convergence', () => {
  it('reaches any point of the reachable box within 1 mm in fewer than 200 iterations, cup within 5 degrees of down', () => {
    fc.assert(fc.property(reachable, (t) => {
      const r = env.solver.solve(t, HOME, makeIkResult());
      expect(r.converged, `target ${t.join(', ')} error ${r.error}`).toBe(true);
      expect(r.error).toBeLessThanOrEqual(IK.posTol);
      expect(r.iterations).toBeLessThan(IK.maxIterations);
      const fk = env.fk(r.q);
      expect(Math.hypot(fk.p[0] - t[0], fk.p[1] - t[1], fk.p[2] - t[2])).toBeLessThanOrEqual(1e-3 + 1e-9);
      expect(fk.tilt * 180 / Math.PI).toBeLessThanOrEqual(5);
    }), { numRuns: 200 });
  });
});
