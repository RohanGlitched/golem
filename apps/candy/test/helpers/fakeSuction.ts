// A typed-array stand-in for the parts of MjData that suctionStep touches.
import { NUSERDATA, UD } from '../../constants';
import type { SimContext } from '../../contract';
import { SuctionWorkspace, type SuctionIds } from '../../controller/suction';

export const NBODY = 10;           // rows of xfrc_applied: bodies 0..9; candy i is body 2 + i

export function fakeSuction() {
  const data = {
    userdata: new Float64Array(NUSERDATA),
    xfrc_applied: new Float64Array(6 * NBODY),
    qpos: new Float64Array(7 * 6),
    qvel: new Float64Array(6 * 6),
    site_xpos: new Float64Array(3 * 2),
  };
  data.userdata[UD.vacuum] = 1;
  data.userdata[UD.count] = 6;
  const calls = { kinematics: 0 };
  const mj = { mj_kinematics: () => { calls.kinematics++; } };
  const ctx = { mj, model: { opt: { timestep: 0.002 } }, data, ids: {} };
  const ids: SuctionIds = {
    tipSite: 1,
    candyQpos: Int32Array.from({ length: 6 }, (_, i) => 7 * i),
    candyDof: Int32Array.from({ length: 6 }, (_, i) => 6 * i),
    candyBody: Int32Array.from({ length: 6 }, (_, i) => 2 + i),
  };
  const ws = new SuctionWorkspace(ctx as unknown as SimContext);
  const setTip = (x: number, y: number, z: number): void => { data.site_xpos[3] = x; data.site_xpos[4] = y; data.site_xpos[5] = z; };
  const setCandy = (i: number, x: number, y: number, z: number): void => { data.qpos[7 * i] = x; data.qpos[7 * i + 1] = y; data.qpos[7 * i + 2] = z; };
  const forceOn = (i: number): number[] => [0, 1, 2].map((k) => data.xfrc_applied[6 * (2 + i) + k]!);
  return { ctx: ctx as unknown as SimContext, data, ids, ws, setTip, setCandy, forceOn, calls };
}
