import { describe, expect, it } from 'vitest';
import { UD } from '../constants';
import { suctionStep } from '../controller/suction';
import { gcCount } from './helpers/alloc';
import { fakeSuction } from './helpers/fakeSuction';

describe('suctionStep', () => {
  it('writes no force and does not touch the kinematics while the switch is off', () => {
    const f = fakeSuction();
    f.setTip(0.4, 0, 0.1); f.setCandy(0, 0.4, 0, 0.1);
    suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
    expect(f.data.xfrc_applied.every((v) => v === 0)).toBe(true);
    expect(f.calls.kinematics).toBe(0);
  });
  it('adds the force to one candy only and records it as the target', () => {
    const f = fakeSuction();
    f.data.userdata[UD.switch] = 1;
    f.setTip(0.4, 0, 0.1);
    f.setCandy(0, 0.4, 0, 0.1 - 0.004);
    f.setCandy(1, 0.4, 0, 0.1 - 0.006);
    f.setCandy(2, 0.9, 0.9, 0);
    suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
    expect(f.forceOn(0)[2]).toBeCloseTo(400 * 0.004, 9);
    expect(f.forceOn(1)).toEqual([0, 0, 0]);
    expect(f.data.userdata[UD.target]).toBe(0);
    expect(f.calls.kinematics).toBe(1);
  });
  it('gives a tie to the lower candy index', () => {
    const f = fakeSuction();
    f.data.userdata[UD.switch] = 1;
    f.setTip(0.4, 0, 0.1);
    for (const i of [1, 3, 4]) f.setCandy(i, 0.4 + 0.005, 0, 0.1);
    f.setCandy(0, 0.9, 0.9, 0); f.setCandy(2, 0.9, 0.9, 0); f.setCandy(5, 0.9, 0.9, 0);
    suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
    expect(f.data.userdata[UD.target]).toBe(1);
    expect(f.forceOn(1)[0]).toBeLessThan(0);
    expect(f.forceOn(3)).toEqual([0, 0, 0]);
  });
  it('applies no force when no candy is within 0.01 m, and records target -1', () => {
    const f = fakeSuction();
    f.data.userdata[UD.switch] = 1;
    f.setTip(0.4, 0, 0.1);
    for (let i = 0; i < 6; i++) f.setCandy(i, 0.4, 0, 0.1 - 0.0101);
    suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
    expect(f.data.xfrc_applied.every((v) => v === 0)).toBe(true);
    expect(f.data.userdata[UD.target]).toBe(-1);
  });
  it('applies the force just inside 0.01 m', () => {
    const f = fakeSuction();
    f.data.userdata[UD.switch] = 1;
    f.setTip(0.4, 0, 0.1); f.setCandy(0, 0.4, 0, 0.1 - 0.00999);
    for (let i = 1; i < 6; i++) f.setCandy(i, 0.9, 0.9, 0);
    suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
    expect(f.data.userdata[UD.target]).toBe(0);
  });
  it('ignores inactive candies', () => {
    const f = fakeSuction();
    f.data.userdata[UD.switch] = 1;
    f.data.userdata[UD.count] = 2;
    f.setTip(0.4, 0, 0.1);
    f.setCandy(0, 0.9, 0.9, 0); f.setCandy(1, 0.9, 0.9, 0);
    f.setCandy(5, 0.4, 0, 0.1);
    suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
    expect(f.data.userdata[UD.target]).toBe(-1);
    expect(f.forceOn(5)).toEqual([0, 0, 0]);
  });
  it('caps the force at 3 N times the vacuum ratio', () => {
    const f = fakeSuction();
    f.data.userdata[UD.switch] = 1;
    f.data.userdata[UD.vacuum] = 0.5;
    f.setTip(0.4, 0, 0.1); f.setCandy(0, 0.4, 0, 0.1 - 0.009);
    suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
    expect(Math.hypot(...f.forceOn(0))).toBeCloseTo(1.5, 12);
  });
  it('adds to a force that is already in xfrc_applied', () => {
    const f = fakeSuction();
    f.data.userdata[UD.switch] = 1;
    f.data.xfrc_applied[6 * 2 + 2] = 5;
    f.setTip(0.4, 0, 0.1); f.setCandy(0, 0.4, 0, 0.1 - 0.002);
    suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
    expect(f.forceOn(0)[2]).toBeCloseTo(5 + 0.8, 12);
  });
  it('uses the damping term from the tip speed and the candy speed', () => {
    const f = fakeSuction();
    f.data.userdata[UD.switch] = 1;
    f.setTip(0.4, 0, 0.1); f.setCandy(0, 0.4, 0, 0.1);
    suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);                // first call: tip velocity 0
    f.data.xfrc_applied.fill(0);
    f.setTip(0.4, 0, 0.1 + 0.0002);                            // the tip rose 0.2 mm in one 2 ms step: 0.1 m/s
    f.data.qvel[2] = 0.03;                                     // the candy rises at 0.03 m/s
    suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
    expect(f.forceOn(0)[2]).toBeCloseTo(400 * 0.0002 + 2 * (0.1 - 0.03), 9);
  });
  it('clamps a vacuum ratio of 1.7 to 1 and counts one warning that names the original value', () => {
    const f = fakeSuction();
    f.data.userdata[UD.switch] = 1;
    f.data.userdata[UD.vacuum] = 1.7;
    f.setTip(0.4, 0, 0.1); f.setCandy(0, 0.4, 0, 0.1 - 0.009);
    for (let i = 0; i < 5; i++) suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
    expect(f.data.userdata[UD.warnCount]).toBe(1);
    expect(f.data.userdata[UD.warnValue]).toBe(1.7);
    f.data.userdata[UD.vacuum] = NaN;
    suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
    suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
    expect(f.data.userdata[UD.warnCount]).toBe(2);
    expect(Number.isNaN(f.data.userdata[UD.warnValue]!)).toBe(true);
  });
  it('treats a non-finite ratio as 0: no force', () => {
    const f = fakeSuction();
    f.data.userdata[UD.switch] = 1;
    f.data.userdata[UD.vacuum] = NaN;
    f.setTip(0.4, 0, 0.1); f.setCandy(0, 0.4, 0, 0.1 - 0.009);
    suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
    expect(f.forceOn(0)).toEqual([0, 0, 0]);
  });
  it('allocates nothing over 100 000 steps', async () => {
    const f = fakeSuction();
    f.data.userdata[UD.switch] = 1;
    f.setTip(0.4, 0, 0.1); f.setCandy(0, 0.4, 0, 0.1 - 0.003);
    const n = await gcCount(100_000, () => { suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws); f.data.xfrc_applied.fill(0); });
    expect(n).toBe(0);
  });
});
