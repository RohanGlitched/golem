// Physics fixture for the suction model: a mocap-driven cup with a `tip` site and one free candy.
// The cup points down, its face 8 mm above the tip site (the site is beyond the face, on the candy side),
// like the cup of the real scene.
import { NUSERDATA, SUCTION, UD } from '../../constants';
import { SuctionWorkspace, suctionStep, type SuctionIds } from '../../controller/suction';
import { getMj } from './mujoco';

export type Shape = 'box' | 'sphere' | 'capsule';
export const HALF_HEIGHT: Record<Shape, number> = { box: 0.010, sphere: 0.012, capsule: 0.008 };
const GEOM: Record<Shape, string> = {
  box: 'type="box" size="0.01 0.01 0.01"',
  sphere: 'type="sphere" size="0.012"',
  capsule: 'type="capsule" fromto="-0.008 0 0 0.008 0 0" size="0.008"',
};

export function fixtureXml(shape: Shape, mass: number): string {
  return `<mujoco model="suction fixture">
  <option timestep="0.002" gravity="0 0 -9.81"><flag autoreset="disable"/></option>
  <size nuserdata="${NUSERDATA}"/>
  <worldbody>
    <geom name="floor" type="plane" size="5 5 0.1" pos="0 0 -3" contype="1" conaffinity="14"/>
    <body name="cupbody" mocap="true" pos="0 0 1">
      <site name="tip" pos="0 0 0" size="0.004"/>
      <geom name="cup_collision" type="cylinder" size="0.02 0.05" pos="0 0 0.058" contype="8" conaffinity="5"/>
    </body>
    <body name="candy_0" pos="0 0 ${1 + 0.008 - HALF_HEIGHT[shape]}">
      <freejoint name="candy_0_free"/>
      <geom name="candy_0_geom" ${GEOM[shape]} mass="${mass}" friction="1 0.005 0.0001" contype="4" conaffinity="9"/>
    </body>
  </worldbody>
</mujoco>
`;
}

export interface SuctionRun {
  /** Largest |tip - candy centre| over the move (m). */
  maxDist: number;
  /** Distance at the end (m). */
  finalDist: number;
  /** Largest force magnitude applied to the candy (N). */
  maxForce: number;
  /** Step index at which the candy first left the engage radius, or -1. */
  leftAt: number;
  /** Every distance sampled during the move, one per Sim_Step. */
  trace: Float64Array;
  finite: boolean;
}

export interface RunSpec {
  shape: Shape;
  mass: number;
  vacuum?: number;
  /** Cup acceleration vector (m/s²) during the move. */
  accel?: [number, number, number];
  /** Speed at which the cup stops accelerating (m/s). */
  vMax?: number;
  /** Settle time with the cup at rest and suction on (s). */
  settle?: number;
  /** Duration of the move (s). */
  move?: number;
}

export async function runSuction(spec: RunSpec): Promise<SuctionRun> {
  const mj = await getMj();
  mj.FS.writeFile('/suction-fixture.xml', fixtureXml(spec.shape, spec.mass));
  const model = mj.MjModel.from_xml_path('/suction-fixture.xml');
  const data = new mj.MjData(model);
  try {
    const id = (type: string, name: string): number => mj.mj_name2id(model, mj.mjtObj[`mjOBJ_${type}`].value, name);
    const jid = id('JOINT', 'candy_0_free');
    const bid = id('BODY', 'candy_0');
    const ids: SuctionIds = {
      tipSite: id('SITE', 'tip'),
      candyQpos: new Int32Array(6).fill(model.jnt_qposadr[jid]),
      candyDof: new Int32Array(6).fill(model.jnt_dofadr[jid]),
      candyBody: new Int32Array(6).fill(bid),
    };
    const ctx = { mj, model, data, ids: {} };
    const ws = new SuctionWorkspace(ctx);
    const ud: Float64Array = data.userdata;
    ud[UD.vacuum] = spec.vacuum ?? 1;
    ud[UD.count] = 1;
    ud[UD.switch] = 1;
    const mocap: Float64Array = data.mocap_pos;
    mocap[0] = 0; mocap[1] = 0; mocap[2] = 1;
    mj.mj_forward(model, data);

    const dt = model.opt.timestep as number;
    const accel = spec.accel ?? [0, 0, 0];
    const aRaw = Math.hypot(accel[0], accel[1], accel[2]);
    const aMag = aRaw > 1e-9 ? aRaw : 0;     // below a nano-m/s² the cup does not move
    const vMax = spec.vMax ?? 0.5;
    const tAcc = aMag > 0 ? vMax / aMag : 0;
    const settleSteps = Math.round((spec.settle ?? 0.1) / dt);
    const moveSteps = Math.round((spec.move ?? 0.5) / dt);
    const trace = new Float64Array(settleSteps + moveSteps);
    const qpos: Float64Array = data.qpos;
    const xfrc: Float64Array = data.xfrc_applied;
    const qa = ids.candyQpos[0] as number;
    const site: Float64Array = data.site_xpos;
    let maxForce = 0, maxDist = 0, leftAt = -1, finite = true;
    const row = 6 * bid;
    for (let n = 0; n < settleSteps + moveSteps; n++) {
      const tm = (n - settleSteps) * dt;     // time into the move
      if (tm > 0) {
        // distance covered: constant acceleration up to vMax, then constant speed
        const s = tm <= tAcc ? 0.5 * aMag * tm * tm : 0.5 * aMag * tAcc * tAcc + vMax * (tm - tAcc);
        const u = aMag > 0 ? 1 / aMag : 0;
        mocap[0] = accel[0] * u * s; mocap[1] = accel[1] * u * s; mocap[2] = 1 + accel[2] * u * s;
      }
      xfrc.fill(0);
      suctionStep(mj, ctx, ids, ws);
      const f = Math.hypot(xfrc[row] as number, xfrc[row + 1] as number, xfrc[row + 2] as number);
      if (f > maxForce) maxForce = f;
      mj.mj_step(model, data);
      mj.mj_kinematics(model, data);
      const s3 = 3 * ids.tipSite;
      const d = Math.hypot((site[s3] as number) - (qpos[qa] as number), (site[s3 + 1] as number) - (qpos[qa + 1] as number), (site[s3 + 2] as number) - (qpos[qa + 2] as number));
      if (!Number.isFinite(d)) finite = false;
      trace[n] = d;
      if (n >= settleSteps) {
        if (d > maxDist) maxDist = d;
        if (leftAt < 0 && d > SUCTION.engageRadius) leftAt = n - settleSteps;
      }
    }
    return { maxDist, finalDist: trace[trace.length - 1] as number, maxForce, leftAt, trace, finite };
  } finally {
    data.delete();
    model.delete();
  }
}
