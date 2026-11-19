// Candy_Signals: what the monitors read. `writeSignals` runs once per Control_Step, before that step's Sim_Steps.
// It may allocate (buffers and the contact vector come from the golem-sim helpers and are deleted by them); only
// step, substep and apply have to be allocation-free.
import { forEachContact, withDoubleBuffer } from 'golem-spec';
import { CANDY_COUNT, DISTMAX, UD } from './constants';
import type { SimContext } from './contract';
import { candyIds } from './controller/ids';
import { classifyCandies, inWorkspace, makeCandyStates, type CandyCounts, type CandyState } from './geometry';

export const SIGNAL_NAMES = [
  'min_link_hand_distance', 'fastest_link_speed', 'tip_speed', 'candies_sorted', 'candies_misplaced',
  'candies_dropped_outside', 'candies_active', 'table_force', 'hand_in_workspace',
] as const;

interface Scratch { states: CandyState[]; counts: CandyCounts }
const scratch = new WeakMap<SimContext, Scratch>();

function scratchFor(ctx: SimContext): Scratch {
  let s = scratch.get(ctx);
  if (s === undefined) { s = { states: makeCandyStates(), counts: { sorted: 0, misplaced: 0, droppedOutside: 0, active: 0 } }; scratch.set(ctx, s); }
  return s;
}

/**
 * Minimum signed distance (m) over every arm collision geom and both hand geoms, on the true hand pose, capped at
 * `distmax`. `mj_geomDistance` does not apply the contype/conaffinity filter, so the hand, which collides with
 * nothing, is still measured.
 */
export function minLinkHandDistance(ctx: SimContext, fromto: any): number {
  const ids = candyIds(ctx);
  const { mj, model, data } = ctx;
  let min = DISTMAX;
  for (let i = 0; i < ids.armGeoms.length; i++) {
    const g = ids.armGeoms[i] as number;
    const a = mj.mj_geomDistance(model, data, g, ids.palmGeom, DISTMAX, fromto) as number;
    const b = mj.mj_geomDistance(model, data, g, ids.forearmGeom, DISTMAX, fromto) as number;
    if (a < min) min = a;
    if (b < min) min = b;
  }
  return min;
}

/** Writes the Candy_Signals into `out`. */
export function writeSignals(ctx: SimContext, out: Record<string, number>): void {
  const ids = candyIds(ctx);
  const { mj, model, data } = ctx;
  mj.mj_kinematics(model, data);               // positions of the state we are in, not of the previous step

  const sc = scratchFor(ctx);
  const qpos: Float64Array = data.qpos;
  const qvel: Float64Array = data.qvel;
  const ud: Float64Array = data.userdata;
  const count = Math.min(CANDY_COUNT, Math.round(ud[UD.count] as number));
  for (let i = 0; i < CANDY_COUNT; i++) {
    const s = sc.states[i] as CandyState;
    const q = ids.candyQpos[i] as number, d = ids.candyDof[i] as number;
    s.x = qpos[q] as number; s.y = qpos[q + 1] as number; s.z = qpos[q + 2] as number;
    s.speed = Math.hypot(qvel[d] as number, qvel[d + 1] as number, qvel[d + 2] as number);
    s.colour = Math.round(ud[UD.colour + i] as number);
    s.active = i < count;
  }
  classifyCandies(sc.states, sc.counts);
  out['candies_sorted'] = sc.counts.sorted;
  out['candies_misplaced'] = sc.counts.misplaced;
  out['candies_dropped_outside'] = sc.counts.droppedOutside;
  out['candies_active'] = sc.counts.active;

  const mp: Float64Array = data.mocap_pos;
  const m = ids.handMocap;
  out['hand_in_workspace'] = inWorkspace(mp[3 * m] as number, mp[3 * m + 1] as number, mp[3 * m + 2] as number) ? 1 : 0;

  withDoubleBuffer(mj, 6, (buf) => {
    out['min_link_hand_distance'] = minLinkHandDistance(ctx, buf);
    const view = (): Float64Array => (typeof (buf as any).GetView === 'function' ? (buf as any).GetView() : (buf as any).getView());
    let fastest = 0;
    for (let i = 0; i < ids.speedBodies.length; i++) {
      mj.mj_objectVelocity(model, data, mj.mjtObj.mjOBJ_BODY.value, ids.speedBodies[i] as number, buf, 0);
      const v = view();
      const speed = Math.hypot(v[3] as number, v[4] as number, v[5] as number);
      if (speed > fastest || Number.isNaN(speed)) fastest = speed;
    }
    out['fastest_link_speed'] = fastest;
    mj.mj_objectVelocity(model, data, mj.mjtObj.mjOBJ_SITE.value, ids.tipSite, buf, 0);
    const tv = view();
    out['tip_speed'] = Math.hypot(tv[3] as number, tv[4] as number, tv[5] as number);
  });

  out['table_force'] = tableForce(ctx);
}

/** Sum of the normal contact forces (N) between arm collision geoms and the table. */
export function tableForce(ctx: SimContext): number {
  const ids = candyIds(ctx);
  const { mj, model, data } = ctx;
  if ((data.ncon as number) === 0) return 0;
  const arm = new Set<number>(ids.armGeoms);
  let total = 0;
  withDoubleBuffer(mj, 6, (buf) => {
    const view = (): Float64Array => (typeof (buf as any).GetView === 'function' ? (buf as any).GetView() : (buf as any).getView());
    forEachContact(mj, data, (contact: any, i: number) => {
      const a = contact.geom1 as number, b = contact.geom2 as number;
      if ((a === ids.tableGeom && arm.has(b)) || (b === ids.tableGeom && arm.has(a))) {
        mj.mj_contactForce(model, data, i, buf);
        total += view()[0] as number;
      }
    });
  });
  return total;
}
