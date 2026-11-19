import { describe, expect, it } from 'vitest';
import { REFLEX_LIMITS, Reflex } from '../controller/reflex';

describe('balance reflex contract', () => {
  it('ships as the identity, so the policy sees the operator command unchanged', () => {
    const r = new Reflex();
    const out = new Float64Array(3);
    r.command({ qpos: new Float64Array(19), qvel: new Float64Array(18), t: 3 }, [0.5, 0, 0], out);
    expect(Array.from(out)).toEqual([0.5, 0, 0]);
  });
  it('declares command limits the walker enforces', () => {
    expect(REFLEX_LIMITS.v).toBe(1);
    expect(REFLEX_LIMITS.yaw).toBe(1);
  });
});

describe("Kiro's balance reflex", () => {
  it('passes the operator command through when nothing pushes the robot', async () => {
    const { KiroReflex } = await import('../controller/kiro-reflex');
    const r = new KiroReflex();
    const out = new Float64Array(3);
    const qpos = new Float64Array(19); qpos[3] = 1;
    for (let k = 0; k < 50; k++) r.command({ qpos, qvel: new Float64Array(18), t: 0.02 * k }, [0.5, 0, 0], out);
    expect(Array.from(out)).toEqual([0.5, 0, 0]);
  });
  it('steps into a sudden sideways push, within the 0.6 m/s cap', async () => {
    const { KiroReflex } = await import('../controller/kiro-reflex');
    const r = new KiroReflex();
    const out = new Float64Array(3);
    const qpos = new Float64Array(19); qpos[3] = 1;
    const qvel = new Float64Array(18);
    for (let k = 0; k < 20; k++) r.command({ qpos, qvel, t: 0.02 * k }, [0.5, 0, 0], out);
    qvel[1] = -1.2; // shoved toward the robot's right
    for (let k = 20; k < 30; k++) r.command({ qpos, qvel, t: 0.02 * k }, [0.5, 0, 0], out);
    expect(out[1]).toBeLessThan(-0.2);
    expect(out[1]).toBeGreaterThanOrEqual(-0.6);
    expect(out[0]).toBe(0.5);
  });
});
