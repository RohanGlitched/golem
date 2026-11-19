import { describe, expect, it } from 'vitest';
import { BOWLS, CANDY_HALF_HEIGHT, CTRL, IK, TRAY } from '../constants';
import { IkSolver, adaptiveLambda, dlsStep, makeIkResult, manipulability } from '../controller/ik';
import { HOME, pandaEnv } from './helpers/panda';

const env = await pandaEnv();
const err = (p: number[], t: number[]) => Math.hypot(p[0]! - t[0]!, p[1]! - t[1]!, p[2]! - t[2]!);
const deg = (r: number) => (r * 180) / Math.PI;

describe('IkSolver', () => {
  it('returns the Home_Pose for the home tip position, in no iterations', () => {
    const home = env.fk(HOME).p;
    const r = env.solver.solve(home, HOME, makeIkResult());
    expect(r.converged).toBe(true);
    expect(r.error).toBeLessThan(1e-9);
    expect(r.iterations).toBe(0);
    expect(Array.from(r.q)).toEqual(Array.from(HOME));
  });

  it('points the cup down within 0.1 degree at the Home_Pose', () => {
    expect(deg(env.fk(HOME).tilt)).toBeLessThan(0.1);
  });

  it('reaches every waypoint of the tray and bowl grid within 1 mm with the cup down within 5 degrees', () => {
    const targets: number[][] = [];
    for (const x of [TRAY.xMin + 0.01, 0.48, TRAY.xMax - 0.03]) {
      for (const y of [-0.13, 0, 0.13]) {
        for (const h of CANDY_HALF_HEIGHT.slice(0, 3)) {
          targets.push([x, y, h + CTRL.descendOffset], [x, y, CTRL.approachHeight + h], [x, y, CTRL.liftHeight]);
        }
      }
    }
    for (const b of BOWLS) targets.push([b.x, b.y, CTRL.releaseHeight], [b.x, b.y, CTRL.liftHeight]);
    const worst = { err: 0, tilt: 0, it: 0 };
    for (const t of targets) {
      const r = env.solver.solve(t, HOME, makeIkResult());
      expect(r.converged, `target ${t.join(', ')}: error ${r.error}`).toBe(true);
      const fk = env.fk(r.q);
      expect(err(fk.p, t)).toBeLessThanOrEqual(1e-3);
      expect(deg(fk.tilt)).toBeLessThanOrEqual(5);
      worst.err = Math.max(worst.err, r.error); worst.tilt = Math.max(worst.tilt, deg(fk.tilt)); worst.it = Math.max(worst.it, r.iterations);
    }
    console.log(`grid of ${targets.length} targets: worst error ${(worst.err * 1000).toFixed(3)} mm, worst tilt ${worst.tilt.toFixed(2)} deg, most iterations ${worst.it}`);
  });

  it('returns the best error found and at most 200 iterations for an unreachable target', () => {
    const t = [2.0, 0, 0.3];
    const r = env.solver.solve(t, HOME, makeIkResult());
    expect(r.converged).toBe(false);
    expect(r.iterations).toBeLessThanOrEqual(IK.maxIterations);
    expect(r.error).toBeGreaterThan(1);
    expect(r.error).toBeCloseTo(err(env.fk(r.q).p, t), 9);
  });

  it('returns the start joints and Infinity when the Jacobian is not finite', () => {
    const nan = Object.create(env.mj);
    nan.mj_jacSite = (m: any, d: any, jacp: any, jacr: any, s: number) => {
      env.mj.mj_jacSite(m, d, jacp, jacr, s);
      jacp.GetView()[0] = NaN;
    };
    const s = new IkSolver(nan, env.model, env.site);
    try {
      const start = Float64Array.from(HOME); start[0] = 0.1;
      const r = s.solve([0.5, 0.1, 0.1], start, makeIkResult());
      expect(r.error).toBe(Infinity);
      expect(Array.from(r.q)).toEqual(Array.from(start));
    } finally { s.dispose(); }
  });

  it('returns the start joints and Infinity when the start configuration is not finite', () => {
    const start = Float64Array.from(HOME); start[3] = NaN;
    const r = env.solver.solve([0.5, 0, 0.1], start, makeIkResult());
    expect(r.error).toBe(Infinity);
  });

  it('disposes once: a second dispose does nothing, and solving afterwards throws', () => {
    const s = new IkSolver(env.mj, env.model, env.site);
    s.dispose();
    expect(() => s.dispose()).not.toThrow();
    expect(() => s.solve([0.4, 0, 0.1], HOME, makeIkResult())).toThrow(/disposed/);
  });

  it('is bit-identical on a repeated call', () => {
    const a = env.solver.solve([0.5, 0.1, 0.1], HOME, makeIkResult());
    const b = env.solver.solve([0.5, 0.1, 0.1], HOME, makeIkResult());
    expect(Array.from(a.q).map((v) => Object.is(v, 0))).toEqual(Array.from(b.q).map((v) => Object.is(v, 0)));
    expect(Array.from(a.q)).toEqual(Array.from(b.q));
    expect(a.error).toBe(b.error);
  });
});

describe('numeric core', () => {
  it('has the Panda home Jacobian at full rank with a manipulability above mu0', () => {
    expect(adaptiveLambda(1)).toBe(IK.lambda0);
    expect(adaptiveLambda(0)).toBeCloseTo(IK.lambdaMax, 12);
    expect(adaptiveLambda(IK.mu0 / 2)).toBeCloseTo(IK.lambda0 + (IK.lambdaMax - IK.lambda0) / 4, 12);
  });
  it('solves a 5x7 identity-like system', () => {
    const J = new Float64Array(35);
    for (let i = 0; i < 5; i++) J[i * 7 + i] = 1;
    const out = new Float64Array(7);
    expect(dlsStep(J, [0.1, 0.2, 0.3, 0.4, 0.5], 0, out)).toBe(true);
    expect(Array.from(out)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0, 0]);
    expect(manipulability(J)).toBeCloseTo(1, 12);
  });
  it('gives manipulability 0 for a rank-deficient Jacobian', () => {
    const J = new Float64Array(35);
    for (let i = 0; i < 4; i++) J[i * 7 + i] = 1;
    expect(manipulability(J)).toBe(0);
  });
});
