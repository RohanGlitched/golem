// Resolves names into ids once, at setup time. The Step_Loop never calls mj_name2id.
import { SimError } from './errors.js';
import type { Mj, MjData, MjModel, NameLookups, ObjType, RobotApp, SimContext } from './types.js';

const TYPES: ObjType[] = ['body', 'geom', 'site', 'joint', 'actuator'];

export function buildContext(
  mj: Mj,
  model: MjModel,
  data: MjData,
  names?: RobotApp['names'],
): SimContext & { lookup: NameLookups } {
  const objs = mj.mjtObj as unknown as Record<string, { value: number } | undefined>;
  const find = (type: ObjType, name: string): number => {
    if (name === '') throw new SimError(`Empty ${type} name`);
    const id = mj.mj_name2id(model, (objs[`mjOBJ_${type.toUpperCase()}`] as { value: number }).value, name);
    if (id < 0) throw new SimError(`No ${type} named "${name}" in the model`);
    return id;
  };
  const lookup: NameLookups = {
    body: (n) => find('body', n),
    geom: (n) => find('geom', n),
    site: (n) => find('site', n),
    joint: (n) => find('joint', n),
    actuator: (n) => find('actuator', n),
  };
  const ids: Record<string, number> = {};
  for (const type of TYPES) {
    for (const name of names?.[type] ?? []) ids[`${type}:${name}`] = find(type, name);
  }
  return { mj, model, data, ids, lookup };
}
