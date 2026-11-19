// Model ids that the controller, the signals and the perturbations need, resolved once per trial.
// The Episode_Runner resolves the names listed in CANDY_NAMES into ctx.ids (`<type>:<name>`) before the first
// Sim_Step; this module turns them into typed arrays and caches the result per context in a WeakMap.
import { CANDY_COUNT } from '../constants';
import type { SimContext } from '../contract';
import type { SuctionIds } from './suction';

const range = (n: number, f: (i: number) => string): string[] => Array.from({ length: n }, (_, i) => f(i));

/** Names for `RobotApp.names`. */
export const CANDY_NAMES = {
  body: [...range(8, (i) => `link${i}`), 'cup', 'hand', ...range(CANDY_COUNT, (i) => `candy_${i}`)],
  geom: ['table', 'hand_palm', 'hand_forearm'],
  site: ['tip'],
  joint: [...range(7, (i) => `joint${i + 1}`), ...range(CANDY_COUNT, (i) => `candy_${i}_free`)],
  actuator: range(7, (i) => `actuator${i + 1}`),
} as const;

export interface CandyIds extends SuctionIds {
  /** Bodies link0..link7. */
  linkBody: Int32Array;
  cupBody: number;
  handBody: number;
  /** Row of the Hand in mocap_pos and mocap_quat. */
  handMocap: number;
  tableGeom: number;
  palmGeom: number;
  forearmGeom: number;
  /** data.ctrl index of each arm actuator. */
  actuator: Int32Array;
  /** Address of each arm joint in qpos. */
  jointQpos: Int32Array;
  /** Arm_Collision_Geoms: geoms of link0..link7 with contype 2, and the cup geom with contype 8. */
  armGeoms: Int32Array;
  /** link0..link7 and the cup, for the fastest-link signal. */
  speedBodies: Int32Array;
}

const cache = new WeakMap<SimContext, CandyIds>();

function need(ctx: SimContext, type: string, name: string): number {
  const id = ctx.ids[`${type}:${name}`];
  if (id === undefined) throw new Error(`${type} "${name}" is not resolved in ctx.ids; add it to app.names`);
  return id;
}

/** Resolves the ids of `ctx` on the first call and returns the same object afterwards. */
export function candyIds(ctx: SimContext): CandyIds {
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;
  const model = ctx.model;
  const linkBody = Int32Array.from({ length: 8 }, (_, i) => need(ctx, 'body', `link${i}`));
  const cupBody = need(ctx, 'body', 'cup');
  const candyBody = Int32Array.from({ length: CANDY_COUNT }, (_, i) => need(ctx, 'body', `candy_${i}`));
  const jnt = (n: string): number => need(ctx, 'joint', n);
  const qposAdr: Int32Array = model.jnt_qposadr;
  const dofAdr: Int32Array = model.jnt_dofadr;
  const handBody = need(ctx, 'body', 'hand');
  const mocapId: Int32Array = model.body_mocapid;
  const handMocap = mocapId[handBody] as number;
  if (!(handMocap >= 0)) throw new Error('body "hand" is not a mocap body');

  const geomBody: Int32Array = model.geom_bodyid;
  const geomType: Int32Array = model.geom_contype;
  const arm: number[] = [];
  const linkSet = new Set(linkBody);
  for (let g = 0; g < (model.ngeom as number); g++) {
    const b = geomBody[g] as number;
    const ct = geomType[g] as number;
    if ((linkSet.has(b) && ct === 2) || (b === cupBody && ct === 8)) arm.push(g);
  }
  if (arm.length === 0) throw new Error('the model has no arm collision geoms (contype 2 on link0..link7, contype 8 on the cup)');

  const ids: CandyIds = {
    tipSite: need(ctx, 'site', 'tip'),
    candyQpos: Int32Array.from({ length: CANDY_COUNT }, (_, i) => qposAdr[jnt(`candy_${i}_free`)] as number),
    candyDof: Int32Array.from({ length: CANDY_COUNT }, (_, i) => dofAdr[jnt(`candy_${i}_free`)] as number),
    candyBody,
    linkBody, cupBody, handBody, handMocap,
    tableGeom: need(ctx, 'geom', 'table'),
    palmGeom: need(ctx, 'geom', 'hand_palm'),
    forearmGeom: need(ctx, 'geom', 'hand_forearm'),
    actuator: Int32Array.from({ length: 7 }, (_, i) => need(ctx, 'actuator', `actuator${i + 1}`)),
    jointQpos: Int32Array.from({ length: 7 }, (_, i) => qposAdr[jnt(`joint${i + 1}`)] as number),
    armGeoms: Int32Array.from(arm),
    speedBodies: Int32Array.from([...linkBody, cupBody]),
  };
  cache.set(ctx, ids);
  return ids;
}
