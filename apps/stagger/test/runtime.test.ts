import { describe, expect, it } from 'vitest';
import { DEFAULT_COMMAND, SPEED_WINDOW, resetRuntime, runtimeFor } from '../runtime';

const ctx = () => ({ mj: {}, model: {}, data: {}, ids: {} });

describe('runtimeFor', () => {
  it('returns the same runtime for the same ctx', () => {
    const c = ctx();
    expect(runtimeFor(c)).toBe(runtimeFor(c));
  });

  it('returns different runtimes for different ctx', () => {
    expect(runtimeFor(ctx())).not.toBe(runtimeFor(ctx()));
  });

  it('starts with the default command, no delay and nothing latched or saved', () => {
    const rt = runtimeFor(ctx());
    expect(Array.from(rt.command)).toEqual([...DEFAULT_COMMAND]);
    expect(Array.from(rt.command)).toEqual([0.5, 0, 0]);
    expect(rt.delaySteps).toBe(0);
    expect(rt.trigger.latched).toBe(false);
    expect(rt.push.latched).toBe(false);
    expect(rt.saved.has).toBe(false);
    expect(rt.speedRing.buf.length).toBe(SPEED_WINDOW);
    expect(rt.speedRing.n).toBe(0);
  });

  it('restores defaults on resetRuntime', () => {
    const rt = runtimeFor(ctx());
    rt.command[0] = 1.2; rt.command[2] = 0.3; rt.delaySteps = 7;
    rt.trigger.latched = true; rt.trigger.t = 2; rt.trigger.pos[0] = 4; rt.trigger.heading[0] = 0; rt.trigger.heading[1] = 1;
    rt.push.latched = true; rt.push.startTime = 2.3; rt.push.dirX = -1;
    rt.saved.has = true; rt.saved.massHas = true;
    rt.speedRing.buf[3] = 9; rt.speedRing.n = 4; rt.speedRing.head = 4;
    resetRuntime(rt);
    expect(Array.from(rt.command)).toEqual([0.5, 0, 0]);
    expect(rt.delaySteps).toBe(0);
    expect(rt.trigger).toEqual({ latched: false, t: 0, pos: new Float64Array(3), heading: Float64Array.from([1, 0]) });
    expect(rt.push).toEqual({ startTime: 0, dirX: 1, dirY: 0, latched: false });
    expect(rt.saved.has || rt.saved.massHas || rt.saved.gravityHas || rt.saved.frictionHas).toBe(false);
    expect(rt.speedRing.n).toBe(0);
    expect(rt.speedRing.buf.every((x) => x === 0)).toBe(true);
  });

  it('allocates nothing new on a second call or a reset', () => {
    const c = ctx();
    const rt = runtimeFor(c);
    const arrays = [rt.command, rt.trigger.pos, rt.trigger.heading, rt.saved.gravity, rt.saved.torsoInertia,
      rt.saved.floorFriction, rt.speedRing.buf, rt.scratch];
    resetRuntime(rt);
    const again = runtimeFor(c);
    expect([again.command, again.trigger.pos, again.trigger.heading, again.saved.gravity, again.saved.torsoInertia,
      again.saved.floorFriction, again.speedRing.buf, again.scratch]).toEqual(arrays);
    arrays.forEach((a, i) => expect([again.command, again.trigger.pos, again.trigger.heading, again.saved.gravity,
      again.saved.torsoInertia, again.saved.floorFriction, again.speedRing.buf, again.scratch][i]).toBe(a));
  });
});
