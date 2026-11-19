// MuJoCo takes the larger friction of two touching geoms unless one has a higher priority. The floor
// carries priority 1, so lowering its friction lowers the foot contact friction.
import { afterAll, describe, expect, it } from 'vitest';
import { compileRobot } from './helpers/mujoco';

const loaded = compileRobot();
afterAll(async () => { (await loaded).model.delete(); });

describe('floor contact friction', () => {
  it('gives the floor a higher contact priority than every robot geom', async () => {
    const { mj, model } = await loaded;
    const floor = mj.mj_name2id(model, mj.mjtObj.mjOBJ_GEOM.value, 'floor');
    expect(floor).toBeGreaterThanOrEqual(0);
    expect(model.geom_priority[floor]).toBe(1);
    for (let g = 0; g < model.ngeom; g++) if (g !== floor) expect(model.geom_priority[g]).toBeLessThan(1);
  });
});
