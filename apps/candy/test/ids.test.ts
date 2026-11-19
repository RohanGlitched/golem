import { buildContext } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import { CANDY_NAMES, candyIds } from '../controller/ids';
import { compileRobot } from './helpers/mujoco';

const { mj, model } = await compileRobot();
const data = new mj.MjData(model);
afterAll(() => { data.delete(); model.delete(); });

const names = CANDY_NAMES as unknown as Parameters<typeof buildContext>[3];
const ctx = buildContext(mj, model, data, names);

describe('candyIds', () => {
  const ids = candyIds(ctx);
  it('resolves every name once and returns the same object on the second call', () => {
    expect(candyIds(ctx)).toBe(ids);
    expect(ids.linkBody).toHaveLength(8);
    expect(ids.actuator).toEqual(Int32Array.from([0, 1, 2, 3, 4, 5, 6]));
    expect(Array.from(ids.jointQpos)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(ids.candyQpos).toEqual(Int32Array.from([7, 14, 21, 28, 35, 42]));
    expect(ids.candyDof).toEqual(Int32Array.from([7, 13, 19, 25, 31, 37]));
    expect(ids.handMocap).toBe(0);
  });
  it('collects the arm collision geoms: link geoms of contype 2 and the cup geom of contype 8', () => {
    expect(ids.armGeoms.length).toBeGreaterThan(8);
    const geomContype: Int32Array = model.geom_contype;
    const geomBody: Int32Array = model.geom_bodyid;
    for (const g of ids.armGeoms) {
      expect([2, 8]).toContain(geomContype[g]);
      if (geomContype[g] === 8) expect(geomBody[g]).toBe(ids.cupBody);
    }
  });
  it('leaves candy geoms, hand geoms, bowls and the table out of the arm collision list', () => {
    const geomBody: Int32Array = model.geom_bodyid;
    const bodyName = (b: number): string => mj.mj_id2name(model, mj.mjtObj.mjOBJ_BODY.value, b);
    for (const g of ids.armGeoms) expect(bodyName(geomBody[g]!)).toMatch(/^(link[0-7]|cup)$/);
    expect(ids.armGeoms).not.toContain(ids.tableGeom);
    expect(ids.armGeoms).not.toContain(ids.palmGeom);
    expect(ids.armGeoms).not.toContain(ids.forearmGeom);
  });
  it('lists link0..link7 and the cup for the speed signal', () => {
    expect(ids.speedBodies).toHaveLength(9);
    expect(ids.speedBodies[8]).toBe(ids.cupBody);
  });
  it('throws a message that names the missing id when app.names did not resolve it', () => {
    const bare = { ...ctx, ids: { ...ctx.ids } } as typeof ctx;
    delete bare.ids['site:tip'];
    expect(() => candyIds(bare)).toThrow('site "tip" is not resolved in ctx.ids; add it to app.names');
  });
});
