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
