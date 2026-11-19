// MJCF rewrite: collision meshes become convex hulls (group 3), visual meshes become light meshes
// (group 2, no contacts), and motors become PD actuators so MuJoCo evaluates the PD law at every
// Sim_Step. The upstream deploy script computes the same law in Python at every Sim_Step; the
// skeleton's episode runner calls a controller once per Control_Step, so the law lives in the model.
import { hullName, visualName } from './stl.mjs';

/** kp (N·m/rad) and kd (N·m·s/rad) by joint suffix, from Unitree's g1.yaml. */
export const PD_GAINS = [
  ['hip_pitch_joint', 100, 2], ['hip_roll_joint', 100, 2], ['hip_yaw_joint', 100, 2],
  ['knee_joint', 150, 4], ['ankle_pitch_joint', 40, 2], ['ankle_roll_joint', 40, 2],
];

const HULL_SUFFIX = '_hull';

/** @param {string} tag @param {string} name @returns {string|undefined} */
function getAttr(tag, name) {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : undefined;
}

/** Sets an attribute, replacing it in place or appending it before the closing bracket. */
function setAttr(tag, name, value) {
  const re = new RegExp(`(\\s${name}=")[^"]*(")`);
  if (re.test(tag)) return tag.replace(re, `$1${value}$2`);
  return tag.replace(/\s*\/>$/, ` ${name}="${value}"/>`);
}

/**
 * Splits geoms into visual and collision meshes and rewrites the asset list and geoms.
 * @param {string} xml upstream or already rewritten MJCF
 * @returns {string}
 */
export function rewriteMjcf(xml) {
  // 1. Which source meshes are used by visual and by collision geoms.
  const assets = [...xml.matchAll(/<mesh\b[^>]*\/>/g)].map((m) => m[0]);
  /** @type {Map<string, string>} mesh name -> file */
  const fileOf = new Map();
  for (const a of assets) fileOf.set(/** @type {string} */ (getAttr(a, 'name')), /** @type {string} */ (getAttr(a, 'file')));
  const processed = (file) => /\.(hull|vis)\.stl$/.test(file ?? '');

  const isVisual = (g) => getAttr(g, 'contype') === '0' && getAttr(g, 'conaffinity') === '0';
  /** @type {Set<string>} */ const useVis = new Set();
  /** @type {Set<string>} */ const useHull = new Set();
  for (const g of xml.matchAll(/<geom\b[^>]*\/>/g)) {
    const mesh = getAttr(g[0], 'mesh');
    if (mesh === undefined || processed(fileOf.get(mesh))) continue;
    (isVisual(g[0]) ? useVis : useHull).add(mesh);
  }

  // 2. Geoms.
  let out = xml.replace(/<geom\b[^>]*\/>/g, (g) => {
    const mesh = getAttr(g, 'mesh');
    if (mesh === undefined || processed(fileOf.get(mesh))) return g;
    if (isVisual(g)) {
      let r = setAttr(g, 'group', '2');
      r = setAttr(r, 'contype', '0');
      return setAttr(r, 'conaffinity', '0');
    }
    let r = setAttr(g, 'group', '3');
    r = setAttr(r, 'mesh', mesh + HULL_SUFFIX);
    return r;
  });

  // 3. Assets: one visual and/or one hull entry per source mesh, at the position of the original.
  out = out.replace(/<mesh\b[^>]*\/>/g, (a) => {
    const name = /** @type {string} */ (getAttr(a, 'name'));
    const file = /** @type {string} */ (getAttr(a, 'file'));
    if (processed(file)) return a;
    const parts = [];
    if (useVis.has(name)) parts.push(`<mesh name="${name}" file="${visualName(file)}"/>`);
    if (useHull.has(name)) parts.push(`<mesh name="${name}${HULL_SUFFIX}" file="${hullName(file)}"/>`);
    return parts.join('\n    ');
  });

  // 4. Actuators: motor -> PD actuator.
  out = out.replace(/<motor\b[^>]*\/>/g, (a) => {
    const joint = getAttr(a, 'joint') ?? '';
    const g = PD_GAINS.find(([suffix]) => joint.endsWith(suffix));
    if (g === undefined) return a;
    const [, kp, kd] = g;
    return `<general name="${getAttr(a, 'name')}" joint="${joint}" gaintype="fixed" biastype="affine" gainprm="${kp}" biasprm="0 ${-kp} ${-kd}"/>`;
  });
  return out;
}

/**
 * @param {string} xml rewritten MJCF
 * @returns {{ vis: string[], hull: string[] }} file names (under meshes/) that the MJCF references
 */
export function referencedMeshFiles(xml) {
  const vis = [], hull = [];
  for (const m of xml.matchAll(/<mesh\b[^>]*\/>/g)) {
    const f = getAttr(m[0], 'file') ?? '';
    (f.endsWith('.hull.stl') ? hull : vis).push(f);
  }
  return { vis, hull };
}

/** @param {string} robotMjcfName file name of the Robot_MJCF @returns {string} */
export function writeScene(robotMjcfName) {
  return `<mujoco model="stagger scene">
  <include file="${robotMjcfName}"/>
  <option timestep="0.002">
    <flag autoreset="disable"/>
  </option>

  <statistic center="1.0 0.7 1.0" extent="0.8"/>

  <visual>
    <headlight diffuse="0.6 0.6 0.6" ambient="0.1 0.1 0.1" specular="0.9 0.9 0.9"/>
  </visual>

  <asset>
    <texture type="2d" name="groundplane" builtin="checker" mark="edge" rgb1="0.2 0.3 0.4" rgb2="0.1 0.2 0.3" markrgb="0.8 0.8 0.8" width="300" height="300"/>
    <material name="groundplane" texture="groundplane" texuniform="true" texrepeat="5 5" reflectance="0.2"/>
  </asset>

  <worldbody>
    <light pos="1 0 3.5" dir="0 0 -1" directional="true"/>
    <!-- priority 1: contacts take the floor friction, so the friction perturbation can lower it -->
    <geom name="floor" size="0 0 0.05" type="plane" material="groundplane" priority="1"/>
  </worldbody>
</mujoco>
`;
}