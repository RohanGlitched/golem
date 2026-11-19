// Writes robot/scene.xml: a wooden doorstep table with a felt tray, three bowls, six candies, a mocap hand,
// lights and a night backdrop. The output depends only on the numbers in consts.mjs: no clock, no randomness.
import {
  BOWL, BOWLS, BOWL_CONTACT, CANDY_COUNT, CANDY_HALF_HEIGHT, CANDY_MASS, COLOURS, CONAFFINITY, CONTYPE, FLOOR_Z, HAND, HAND_START,
  NUSERDATA, SIM_DT, TABLE, TRAY,
} from './consts.mjs';

/** @param {number} x @returns {string} fixed-format number: at most 6 decimals, no trailing zeros, no "-0" */
export const f = (x) => String(Number(x.toFixed(6)));
/** @param {readonly number[]} v @returns {string} */
const vec = (v) => v.map(f).join(' ');

const WOOD = [
  { name: 'wood_a', rgba: [0.46, 0.29, 0.15, 1] },
  { name: 'wood_b', rgba: [0.40, 0.25, 0.13, 1] },
  { name: 'wood_c', rgba: [0.52, 0.33, 0.18, 1] },
];
const WOOD_DARK = [0.17, 0.10, 0.055, 1];
const SKIN = [0.87, 0.67, 0.53, 1];
const SLEEVE = [0.16, 0.08, 0.24, 1];
const COLOUR_NAMES = ['orange', 'purple', 'green'];
/** solref of the bowl geoms: overdamped, so that a candy landing in a bowl does not bounce out. The table and the candies keep the MuJoCo default. */
const BOWL_SOLREF = `${f(BOWL_CONTACT.timeConstant)} ${f(BOWL_CONTACT.dampRatio)}`;

/** Orthonormal camera axes (`xyaxes`) for a camera at `eye` looking at `target` with +z up. */
export function lookAtXyAxes(eye, target) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
  const fwd = unit(sub(target, eye));
  const right = unit(cross(fwd, [0, 0, 1]));
  const up = cross(right, fwd);
  return [...right, ...up];
}

/** @returns {string} the geom lines of a decorative jack-o'-lantern in the back-left corner (visual only) */
function pumpkin() {
  const x = -0.10, y = 0.44;
  const vis = 'contype="0" conaffinity="0"';
  return [
    `<geom name="pumpkin_body" type="ellipsoid" size="0.075 0.075 0.060" pos="${vec([x, y, 0.060])}" rgba="0.95 0.42 0.05 1" material="candy_orange" ${vis}/>`,
    `<geom name="pumpkin_stem" type="cylinder" size="0.011 0.016" pos="${vec([x, y, 0.126])}" rgba="0.30 0.38 0.12 1" ${vis}/>`,
    `<geom name="pumpkin_eye_l" type="box" size="0.012 0.004 0.012" pos="${vec([x + 0.068, y - 0.030, 0.075])}" rgba="0.08 0.04 0.01 1" ${vis}/>`,
    `<geom name="pumpkin_eye_r" type="box" size="0.012 0.004 0.012" pos="${vec([x + 0.068, y + 0.030, 0.075])}" rgba="0.08 0.04 0.01 1" ${vis}/>`,
    `<geom name="pumpkin_mouth" type="box" size="0.010 0.026 0.007" pos="${vec([x + 0.072, y, 0.040])}" rgba="0.08 0.04 0.01 1" ${vis}/>`,
  ].join('\n    ');
}

/** @returns {string} */
function tableXml() {
  const cx = (TABLE.xMin + TABLE.xMax) / 2, hx = (TABLE.xMax - TABLE.xMin) / 2;
  const hy = (TABLE.yMax - TABLE.yMin) / 2, ht = TABLE.thickness / 2;
  const vis = 'contype="0" conaffinity="0"';
  const lines = [];
  lines.push(`<geom name="table" type="box" size="${vec([hx, hy, ht])}" pos="${vec([cx, 0, -ht])}" rgba="${vec(WOOD_DARK)}" material="wood_dark" contype="${CONTYPE.world}" conaffinity="${CONAFFINITY.world}"/>`);
  // Planks run along x. A 3 mm gap between boards shows the dark base.
  const planks = 12;
  const w = (TABLE.yMax - TABLE.yMin) / planks;
  for (let i = 0; i < planks; i++) {
    const m = WOOD[(i * 7) % 3];
    const y = TABLE.yMin + w * (i + 0.5);
    lines.push(`<geom name="plank_${i}" type="box" size="${vec([hx, w / 2 - 0.0015, 0.0005])}" pos="${vec([cx, y, -0.0001])}" rgba="${vec(m.rgba)}" material="${m.name}" ${vis}/>`);
  }
  // Apron below the top and four legs down to the floor.
  const ay = hy - 0.02, ax = hx - 0.02;
  lines.push(`<geom name="apron_front" type="box" size="${vec([0.012, ay, 0.04])}" pos="${vec([TABLE.xMax - 0.032, 0, -0.08])}" rgba="${vec(WOOD_DARK)}" material="wood_dark" ${vis}/>`);
  lines.push(`<geom name="apron_back" type="box" size="${vec([0.012, ay, 0.04])}" pos="${vec([TABLE.xMin + 0.032, 0, -0.08])}" rgba="${vec(WOOD_DARK)}" material="wood_dark" ${vis}/>`);
  lines.push(`<geom name="apron_left" type="box" size="${vec([ax, 0.012, 0.04])}" pos="${vec([cx, TABLE.yMin + 0.032, -0.08])}" rgba="${vec(WOOD_DARK)}" material="wood_dark" ${vis}/>`);
  lines.push(`<geom name="apron_right" type="box" size="${vec([ax, 0.012, 0.04])}" pos="${vec([cx, TABLE.yMax - 0.032, -0.08])}" rgba="${vec(WOOD_DARK)}" material="wood_dark" ${vis}/>`);
  const legH = (-TABLE.thickness - FLOOR_Z) / 2;
  const legs = [[TABLE.xMin + 0.04, TABLE.yMin + 0.04], [TABLE.xMin + 0.04, TABLE.yMax - 0.04], [TABLE.xMax - 0.04, TABLE.yMin + 0.04], [TABLE.xMax - 0.04, TABLE.yMax - 0.04]];
  legs.forEach(([x, y], i) => {
    lines.push(`<geom name="leg_${i}" type="box" size="${vec([0.03, 0.03, legH])}" pos="${vec([x, y, -TABLE.thickness - legH])}" rgba="${vec(WOOD_DARK)}" material="wood_dark" ${vis}/>`);
  });
  // The doorstep: a slab of grey stone in front of the table.
  lines.push(`<geom name="doorstep" type="box" size="${vec([0.20, hy + 0.05, 0.10])}" pos="${vec([TABLE.xMax + 0.24, 0, FLOOR_Z + 0.10])}" rgba="0.30 0.29 0.31 1" material="stone" ${vis}/>`);
  return lines.join('\n    ');
}

/** @returns {string} the tray marking: dark felt with an orange border, no collision */
function trayXml() {
  const cx = (TRAY.xMin + TRAY.xMax) / 2, cy = (TRAY.yMin + TRAY.yMax) / 2;
  const hx = (TRAY.xMax - TRAY.xMin) / 2, hy = (TRAY.yMax - TRAY.yMin) / 2;
  const vis = 'contype="0" conaffinity="0"';
  const t = 0.004;
  const z = 0.0005;
  return [
    `<geom name="tray" type="box" size="${vec([hx, hy, 0.0003])}" pos="${vec([cx, cy, z])}" rgba="0.09 0.07 0.11 1" material="felt" ${vis}/>`,
    `<geom name="tray_edge_near" type="box" size="${vec([t / 2, hy, 0.0004])}" pos="${vec([TRAY.xMin + t / 2, cy, z + 0.0002])}" rgba="0.90 0.40 0.05 1" ${vis}/>`,
    `<geom name="tray_edge_far" type="box" size="${vec([t / 2, hy, 0.0004])}" pos="${vec([TRAY.xMax - t / 2, cy, z + 0.0002])}" rgba="0.90 0.40 0.05 1" ${vis}/>`,
    `<geom name="tray_edge_left" type="box" size="${vec([hx, t / 2, 0.0004])}" pos="${vec([cx, TRAY.yMin + t / 2, z + 0.0002])}" rgba="0.90 0.40 0.05 1" ${vis}/>`,
    `<geom name="tray_edge_right" type="box" size="${vec([hx, t / 2, 0.0004])}" pos="${vec([cx, TRAY.yMax - t / 2, z + 0.0002])}" rgba="0.90 0.40 0.05 1" ${vis}/>`,
  ].join('\n    ');
}

/** @param {number} i bowl index @returns {string} */
function bowlXml(i) {
  const b = /** @type {{ name: string, x: number, y: number }} */ (BOWLS[i]);
  const rgba = vec(/** @type {number[]} */ (COLOURS[i]));
  const mat = `candy_${COLOUR_NAMES[i]}`;
  const { innerHalf: ih, wallThickness: wt, wallHeight: wh, floorRadius: fr, floorHalfHeight: fh, floorSink: fs } = BOWL;
  const attrs = `rgba="${rgba}" material="${mat}" contype="${CONTYPE.world}" conaffinity="${CONAFFINITY.world}" solref="${BOWL_SOLREF}"`;
  const mid = ih + wt / 2;
  const half = ih + wt;
  return `<body name="${b.name}" pos="${vec([b.x, b.y, 0])}">
      <geom name="${b.name}_floor" type="cylinder" size="${vec([fr, fh + fs / 2])}" pos="0 0 ${f(fh - fs / 2)}" ${attrs}/>
      <geom name="${b.name}_wall_px" type="box" size="${vec([wt / 2, half, wh / 2])}" pos="${vec([mid, 0, wh / 2])}" ${attrs}/>
      <geom name="${b.name}_wall_nx" type="box" size="${vec([wt / 2, half, wh / 2])}" pos="${vec([-mid, 0, wh / 2])}" ${attrs}/>
      <geom name="${b.name}_wall_py" type="box" size="${vec([ih, wt / 2, wh / 2])}" pos="${vec([0, mid, wh / 2])}" ${attrs}/>
      <geom name="${b.name}_wall_ny" type="box" size="${vec([ih, wt / 2, wh / 2])}" pos="${vec([0, -mid, wh / 2])}" ${attrs}/>
    </body>`;
}

/** @param {number} i candy index @returns {string} */
function candyXml(i) {
  const h = /** @type {number} */ (CANDY_HALF_HEIGHT[i]);
  const colour = i % 3;
  const rgba = vec(/** @type {number[]} */ (COLOURS[colour]));
  const shape = i % 3 === 0
    ? 'type="box" size="0.01 0.01 0.01"'
    : i % 3 === 1 ? 'type="sphere" size="0.012"' : 'type="capsule" fromto="-0.008 0 0 0.008 0 0" size="0.008"';
  const x = 0.36, y = -0.10 + 0.04 * i;
  return `<body name="candy_${i}" pos="${vec([x, y, h])}">
      <freejoint name="candy_${i}_free"/>
      <geom name="candy_${i}_geom" ${shape} mass="${f(CANDY_MASS)}" rgba="${rgba}" material="candy_${COLOUR_NAMES[colour]}" friction="1 0.005 0.0001" contype="${CONTYPE.candy}" conaffinity="${CONAFFINITY.candy}"/>
    </body>`;
}

/** @returns {string} the mocap hand: collision-free palm and forearm, plus visual fingers and a sleeve */
function handXml() {
  const q = [Math.cos(HAND_START.yaw / 2), 0, 0, Math.sin(HAND_START.yaw / 2)];
  const vis = 'contype="0" conaffinity="0"';
  const skin = vec(SKIN);
  const fingers = [-0.03, -0.01, 0.01, 0.03].map((y, i) =>
    `<geom name="hand_finger_${i}" type="capsule" fromto="${vec([-0.04, y, 0, -0.115 - 0.005 * (i % 2 === 0 ? 0 : -1), y, 0])}" size="0.009" rgba="${skin}" ${vis}/>`);
  return `<body name="hand" mocap="true" pos="${vec([HAND_START.x, HAND_START.y, HAND_START.z])}" quat="${vec(q)}">
      <geom name="hand_palm" type="sphere" size="${f(HAND.palmRadius)}" rgba="${skin}" ${vis}/>
      <geom name="hand_forearm" type="capsule" fromto="0 0 0 ${f(HAND.forearmLength)} 0 0" size="${f(HAND.forearmRadius)}" rgba="${skin}" ${vis}/>
      <geom name="hand_sleeve" type="capsule" fromto="0.17 0 0 ${f(HAND.forearmLength)} 0 0" size="0.046" rgba="${vec(SLEEVE)}" ${vis}/>
      <geom name="hand_thumb" type="capsule" fromto="-0.02 0.05 0 -0.07 0.075 0" size="0.011" rgba="${skin}" ${vis}/>
      ${fingers.join('\n      ')}
    </body>`;
}

/**
 * @param {string} [pandaFile] file name of the patched Panda model, in the same folder
 * @returns {string}
 */
export function writeScene(pandaFile = 'panda.xml') {
  const eye = [1.65, -1.30, 0.95];
  const target = [0.52, 0.0, 0.10];
  const mats = COLOUR_NAMES.map((n, i) =>
    `<material name="candy_${n}" rgba="${vec(/** @type {number[]} */ (COLOURS[i]))}" specular="0.9" shininess="0.85" reflectance="0.04"/>`);
  const woods = WOOD.map((w) => `<material name="${w.name}" rgba="${vec(w.rgba)}" specular="0.18" shininess="0.25"/>`);
  const candies = Array.from({ length: CANDY_COUNT }, (_, i) => candyXml(i));
  return `<mujoco model="candy scene">
  <include file="${pandaFile}"/>
  <option timestep="${f(SIM_DT)}">
    <flag autoreset="disable"/>
  </option>
  <size nuserdata="${NUSERDATA}"/>

  <statistic center="0.5 0 0.15" extent="1.1"/>

  <visual>
    <headlight diffuse="0.30 0.27 0.36" ambient="0.20 0.16 0.26" specular="0.15 0.15 0.18"/>
    <global azimuth="125" elevation="-24"/>
    <quality shadowsize="4096"/>
    <rgba haze="0.10 0.06 0.14 1"/>
  </visual>

  <asset>
    <texture type="skybox" builtin="gradient" rgb1="0.24 0.11 0.32" rgb2="0.015 0.008 0.03" width="512" height="512"/>
    <texture type="2d" name="floor" builtin="checker" mark="edge" rgb1="0.11 0.09 0.13" rgb2="0.075 0.06 0.095" markrgb="0.22 0.18 0.26" width="300" height="300"/>
    <material name="floor" texture="floor" texuniform="true" texrepeat="6 6" reflectance="0.12"/>
    <material name="felt" rgba="0.09 0.07 0.11 1" specular="0" shininess="0"/>
    <material name="stone" rgba="0.30 0.29 0.31 1" specular="0.05" shininess="0.1"/>
    ${[...mats, ...woods, '<material name="wood_dark" rgba="0.17 0.10 0.055 1" specular="0.1" shininess="0.2"/>'].join('\n    ')}
  </asset>

  <worldbody>
    <light name="lantern" pos="0.95 -0.95 1.60" dir="-0.40 0.45 -0.80" cutoff="52" exponent="8" diffuse="1.0 0.72 0.40" specular="0.55 0.45 0.30" castshadow="true"/>
    <light name="moon" pos="-0.6 1.3 1.8" dir="0.35 -0.75 -0.55" directional="true" diffuse="0.17 0.15 0.34" specular="0.08 0.08 0.16" castshadow="false"/>
    <camera name="studio" pos="${vec(eye)}" xyaxes="${vec(lookAtXyAxes(eye, target))}" fovy="38"/>
    <geom name="floor" type="plane" size="4 4 0.05" pos="0 0 ${f(FLOOR_Z)}" material="floor" contype="${CONTYPE.world}" conaffinity="${CONAFFINITY.world}"/>
    ${tableXml()}
    ${trayXml()}
    ${pumpkin()}
    ${[0, 1, 2].map(bowlXml).join('\n    ')}
    ${candies.join('\n    ')}
    ${handXml()}
  </worldbody>
</mujoco>
`;
}
