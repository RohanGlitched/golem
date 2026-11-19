// Anchored edits of Menagerie's panda_nohand.xml. Every edit names its anchor and throws when the anchor is
// missing, so an upstream change fails loudly instead of producing a silently different robot.
import { CONAFFINITY, CONTYPE, CUP, SUCTION } from './consts.mjs';

/** An expected failure: the message names the anchor and the file. */
export class AnchorError extends Error {}

/** @param {number} x @returns {string} */
const n = (x) => String(Number(x.toFixed(6)));

/**
 * @param {string} xml @param {RegExp} re @param {string | ((m: string, ...g: string[]) => string)} replacement
 * @param {string} anchor description of what the regular expression looks for
 */
function edit(xml, re, replacement, anchor) {
  if (!re.test(xml)) throw new AnchorError(`patch anchor not found in panda_nohand.xml: ${anchor}`);
  return xml.replace(re, /** @type {any} */ (replacement));
}

/**
 * Cup body: the collision cylinder, a visual bellows, and the `tip` site 8 mm beyond the cup face, on the side of
 * the candy. A candy that rests against the face is then 0 to 4 mm from the site (h - 8 mm for a candy of
 * half-height h), inside the 0.01 m engage radius.
 */
export function cupXml() {
  const half = CUP.length / 2;
  const tip = CUP.length + SUCTION.tipInset;
  return `<body name="cup" pos="0 0 0.107" quat="0.9238795 0 0 -0.3826834">
                      <geom name="cup_collision" type="cylinder" size="${n(CUP.radius)} ${n(half)}" pos="0 0 ${n(half)}" mass="0.1" group="3" contype="${CONTYPE.cup}" conaffinity="${CONAFFINITY.cup}" rgba="0.1 0.1 0.12 1"/>
                      <geom name="cup_stem" type="cylinder" size="0.014 0.040" pos="0 0 0.040" group="2" contype="0" conaffinity="0" rgba="0.16 0.16 0.19 1"/>
                      <geom name="cup_bellows" type="cylinder" size="0.022 0.012" pos="0 0 0.088" group="2" contype="0" conaffinity="0" rgba="0.07 0.07 0.09 1"/>
                      <geom name="cup_lip" type="cylinder" size="0.026 0.003" pos="0 0 0.0985" group="2" contype="0" conaffinity="0" rgba="0.05 0.05 0.06 1"/>
                      <site name="tip" pos="0 0 ${n(tip)}" size="0.004" rgba="1 0.45 0.05 0.9" group="1"/>
                    </body>`;
}

/**
 * Patches panda_nohand.xml into the candy Panda: collision defaults, suction cup with the `tip` site, convex
 * hull collision meshes, no gripper, no keyframe.
 * @param {string} xml upstream panda_nohand.xml
 * @param {(upstreamFile: string, role: 'collision' | 'visual') => string} meshFile maps an upstream mesh file to its output file name
 * @returns {string}
 */
export function patchPanda(xml, meshFile) {
  let out = xml;
  out = edit(out, /<compiler angle="radian" meshdir="assets" autolimits="true"\/>/, (m) => m, 'the <compiler> line with meshdir="assets"');
  // Collision class: links collide with the world only.
  out = edit(
    out,
    /(<default class="panda\/collision">\s*<geom type="mesh" group="3")(\/>)/,
    `$1 contype="${CONTYPE.arm}" conaffinity="${CONAFFINITY.arm}"$2`,
    '<default class="panda/collision"> with <geom type="mesh" group="3"/>',
  );
  // Collision geoms use hull meshes; find them first so that the mesh edit can tell roles apart.
  /** @type {Set<string>} */ const collisionMeshes = new Set();
  for (const g of out.matchAll(/<geom\b[^>]*\bclass="panda\/collision"[^>]*\/>/g)) {
    const m = /\bmesh="([^"]+)"/.exec(g[0]);
    if (m) collisionMeshes.add(/** @type {string} */ (m[1]));
  }
  if (collisionMeshes.size === 0) throw new AnchorError('patch anchor not found in panda_nohand.xml: geoms with class="panda/collision"');
  out = out.replace(/<mesh\b[^>]*\/>/g, (tag) => {
    const file = /\bfile="([^"]+)"/.exec(tag)?.[1];
    if (file === undefined) return tag;
    const name = /\bname="([^"]+)"/.exec(tag)?.[1] ?? file.replace(/\.[^.]+$/, '');
    const role = collisionMeshes.has(name) ? 'collision' : 'visual';
    return tag.replace(`file="${file}"`, `file="${meshFile(file, role)}"`);
  });
  // The flange attachment becomes the suction cup.
  out = edit(
    out,
    /<body name="attachment"[^>]*>\s*<site name="attachment_site"\/>\s*<\/body>/,
    cupXml(),
    '<body name="attachment"> holding <site name="attachment_site"/>',
  );
  // A keyframe with 7 values would not fit the scene (candies add free joints).
  out = edit(out, /\s*<keyframe>[\s\S]*?<\/keyframe>/, '', '<keyframe> block');
  assertNoGripper(out);
  return out;
}

/** Throws when the model still contains the Menagerie hand or fingers. @param {string} xml */
export function assertNoGripper(xml) {
  if (/name="(hand|left_finger|right_finger|finger[^"]*)"/.test(xml) || /file="(hand|finger)[^"]*"/.test(xml)) {
    throw new AnchorError('panda.xml still contains the Menagerie gripper');
  }
}

/** Mesh files that a patched model references, sorted. @param {string} xml @returns {string[]} */
export function meshFiles(xml) {
  return [...new Set([...xml.matchAll(/<mesh\b[^>]*\bfile="([^"]+)"/g)].map((m) => /** @type {string} */ (m[1])))].sort();
}

/**
 * The upstream mesh files and their roles, from the unpatched model.
 * @param {string} xml upstream panda_nohand.xml
 * @returns {{ file: string, role: 'collision' | 'visual' }[]} sorted by file
 */
export function upstreamMeshes(xml) {
  /** @type {Set<string>} */ const collision = new Set();
  for (const g of xml.matchAll(/<geom\b[^>]*\bclass="panda\/collision"[^>]*\/>/g)) {
    const m = /\bmesh="([^"]+)"/.exec(g[0]);
    if (m) collision.add(/** @type {string} */ (m[1]));
  }
  /** @type {Map<string, 'collision' | 'visual'>} */ const byFile = new Map();
  for (const tag of xml.matchAll(/<mesh\b[^>]*\/>/g)) {
    const file = /\bfile="([^"]+)"/.exec(tag[0])?.[1];
    if (file === undefined) continue;
    const name = /\bname="([^"]+)"/.exec(tag[0])?.[1] ?? file.replace(/\.[^.]+$/, '');
    byFile.set(file, collision.has(name) ? 'collision' : 'visual');
  }
  return [...byFile.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([file, role]) => ({ file, role }));
}
