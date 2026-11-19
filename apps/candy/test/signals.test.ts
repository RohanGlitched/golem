import { buildContext, geomDistance, liveHandleCount } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import { DISTMAX, HAND_START, Q_HOME, UD } from '../constants';
import { CANDY_NAMES, candyIds } from '../controller/ids';
import { IkSolver, makeIkResult } from '../controller/ik';
import { SIGNAL_NAMES, writeSignals } from '../signals';
import { compileRobot } from './helpers/mujoco';

const { mj, model } = await compileRobot();
const data = new mj.MjData(model);
const ctx = buildContext(mj, model, data, CANDY_NAMES as never);
const ids = candyIds(ctx);
const ik = new IkSolver(mj, model, ids.tipSite);
afterAll(() => { ik.dispose(); data.delete(); model.delete(); });

function reset(): void {
  data.qpos.fill(0); data.qvel.fill(0); data.xfrc_applied.fill(0);
  for (let j = 0; j < 7; j++) data.qpos[j] = Q_HOME[j];
  // candies back on the tray at their scene positions
  for (let i = 0; i < 6; i++) { const q = ids.candyQpos[i]!; data.qpos[q] = 0.36; data.qpos[q + 1] = -0.1 + 0.04 * i; data.qpos[q + 2] = 0.012; data.qpos[q + 3] = 1; }
  const m = ids.handMocap;
  data.mocap_pos[3 * m] = HAND_START.x; data.mocap_pos[3 * m + 1] = HAND_START.y; data.mocap_pos[3 * m + 2] = HAND_START.z;
  data.mocap_quat[4 * m] = Math.SQRT1_2; data.mocap_quat[4 * m + 1] = 0; data.mocap_quat[4 * m + 2] = 0; data.mocap_quat[4 * m + 3] = Math.SQRT1_2;
  data.userdata[UD.count] = 6;
  for (let i = 0; i < 6; i++) data.userdata[UD.colour + i] = i % 3;
  mj.mj_forward(model, data);
}
const read = (): Record<string, number> => { const out: Record<string, number> = {}; writeSignals(ctx, out); return out; };

describe('signals', () => {
  it('writes every signal as a finite number', () => {
    reset();
    const s = read();
    for (const name of SIGNAL_NAMES) expect(Number.isFinite(s[name]), name).toBe(true);
    expect(Object.keys(s).sort()).toEqual([...SIGNAL_NAMES].sort());
  });

  it('gives exactly 0.6 m when no hand geom is within distmax', () => {
    reset();
    expect(read()['min_link_hand_distance']).toBe(DISTMAX);
  });

  it('measures a hand that collides with nothing: mj_geomDistance ignores contype and conaffinity', () => {
    reset();
    const tip = data.site_xpos.slice(3 * ids.tipSite, 3 * ids.tipSite + 3) as Float64Array;
    const m = ids.handMocap;
    // palm centre 0.2 m below the tip and 0.1 m aside: the palm surface is about 0.17 m from the cup
    data.mocap_pos[3 * m] = tip[0]! + 0.1; data.mocap_pos[3 * m + 1] = tip[1]!; data.mocap_pos[3 * m + 2] = tip[2]! - 0.2;
    mj.mj_forward(model, data);
    const s = read();
    expect(s['min_link_hand_distance']).toBeLessThan(0.3);
    expect(s['min_link_hand_distance']).toBeGreaterThan(0.05);
    // the filtered pair really is filtered out of collision: the hand geoms have contype 0
    expect(model.geom_contype[ids.palmGeom]).toBe(0);
    expect(model.geom_conaffinity[ids.palmGeom]).toBe(0);
    // and the signal equals the helper's value for the cup against the palm or forearm
    let ref = DISTMAX;
    for (const g of ids.armGeoms) for (const h of [ids.palmGeom, ids.forearmGeom]) ref = Math.min(ref, geomDistance(mj, model, data, g, h, DISTMAX));
    expect(s['min_link_hand_distance']).toBeCloseTo(ref, 9);
  });

  it('reports a positive table_force when the cup is pressed into the table', () => {
    reset();
    expect(read()['table_force']).toBe(0);
    const r = ik.solve([0.5, 0, -0.02], Float64Array.from(Q_HOME), makeIkResult());
    expect(r.error).toBeLessThan(1e-3);
    for (let j = 0; j < 7; j++) data.qpos[j] = r.q[j]!;
    mj.mj_forward(model, data);
    const s = read();
    expect(s['table_force']).toBeGreaterThan(0);
  });

  it('measures the tip speed and the fastest link speed from the velocities', () => {
    reset();
    data.qvel[0] = 1;                       // 1 rad/s about the base axis
    mj.mj_forward(model, data);
    const s = read();
    expect(s['tip_speed']).toBeGreaterThan(0.29);
    expect(s['tip_speed']).toBeLessThan(0.33);
    expect(s['fastest_link_speed']).toBeGreaterThan(0.2);
    expect(s['fastest_link_speed']).toBeLessThan(0.4);
    reset();
    expect(read()['tip_speed']).toBeCloseTo(0, 9);
  });

  it('sets hand_in_workspace from the palm centre', () => {
    reset();
    expect(read()['hand_in_workspace']).toBe(0);
    const m = ids.handMocap;
    data.mocap_pos[3 * m] = 0.5; data.mocap_pos[3 * m + 1] = 0; data.mocap_pos[3 * m + 2] = 0.2;
    expect(read()['hand_in_workspace']).toBe(1);
  });

  it('counts candies in bowls from their positions, colours and speeds', () => {
    reset();
    // candy 0 (orange) in the orange bowl, at rest; candy 1 (purple) in the green bowl, at rest
    const put = (i: number, x: number, y: number) => { const q = ids.candyQpos[i]!; data.qpos[q] = x; data.qpos[q + 1] = y; data.qpos[q + 2] = 0.02; };
    put(0, 0.611, -0.382); put(1, 0.611, 0.382);
    mj.mj_forward(model, data);
    const s = read();
    expect(s['candies_sorted']).toBe(1);
    expect(s['candies_misplaced']).toBe(1);
    expect(s['candies_dropped_outside']).toBe(0);
    expect(s['candies_active']).toBe(6);
  });

  it('writes candies_active from the candy count in userdata', () => {
    reset();
    for (const n of [1, 3, 6]) {
      data.userdata[UD.count] = n;
      expect(read()['candies_active']).toBe(n);
    }
  });

  it('leaves the Handle_Counter unchanged over 100 calls', () => {
    reset();
    const before = liveHandleCount();
    for (let i = 0; i < 100; i++) read();
    expect(liveHandleCount()).toBe(before);
  });
});
