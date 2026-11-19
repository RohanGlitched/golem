// Builds apps/hover/robot/: the Skydio X2 files of MuJoCo Menagerie at a pinned commit, plus our scene.xml.
//
//   node scripts/fetch-assets.mjs            download what is missing or changed, verify every hash, write robot/
//   node scripts/fetch-assets.mjs --check    report the state of robot/ without network access (exit 1 when not current)
//   node scripts/fetch-assets.mjs --resolve  print the hashes of the pinned commit, for a maintainer who moves the pin
//
// Only the files of the model that MuJoCo needs are fetched (not the README, the changelog or the 1.5 MB photograph).
// Upstream files are kept byte for byte. The scene is the only file we write, and it is written from `SCENE_XML`.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMMIT = '370c43965323c0944b433b202aac5058b5f907a9';
export const MODEL_DIR = 'skydio_x2';
export const REPO = 'google-deepmind/mujoco_menagerie';
export const SCRIPT_VERSION = 1;

/** Files fetched from `skydio_x2/` (path inside robot/ equals the path inside the folder) with their SHA-256. */
export const SOURCES = {
  'x2.xml': 'b1cc5d68eb8ff154ab93a9958b58f69210865e1793eb96b30a32f46c68cc7e71',
  'LICENSE': 'd42cae9a0f292b7a713597ba26e1e1e23d50df906c488f0d36fd3538af200bc1',
  'assets/X2_lowpoly.obj': '4d6df3d7b26676a6ade8cbc320599961321ac3e3c52474d7c98dd7adc8152411',
  'assets/X2_lowpoly_texture_SpinningProps_1024.png': '24153733dd01f9ddd37a3c79fad5e24ac876228812e3a8e95f60ccd8cedb66e1',
};

/** Hover point (m). constants.ts repeats it; test/assets.test.ts checks that both agree. */
export const HOVER_POINT = { x: 0, y: 0, z: 1.0 };
/** Sim timestep (s). constants.ts repeats it. The upstream file uses 0.01 s, which is too coarse for a 13 N thrust loop. */
export const SIM_DT = 0.002;

/**
 * scene.xml: the upstream model, a finer timestep, a floor and the hover marker. Everything visible is in geom group 2,
 * because the studio draws that group only. The marker and its post collide with nothing.
 */
export function sceneXml() {
  const { x, y, z } = HOVER_POINT;
  return `<mujoco model="Skydio X2 hover">
  <include file="x2.xml"/>

  <option timestep="${SIM_DT}"/>

  <statistic meansize=".05"/>

  <visual>
    <headlight diffuse="0.6 0.6 0.6" ambient="0.3 0.3 0.3" specular="0 0 0"/>
    <global ellipsoidinertia="true"/>
  </visual>

  <worldbody>
    <geom name="floor" type="plane" size="0 0 0.05" group="2" rgba="0.55 0.5 0.45 1"/>
    <geom name="hover_post" type="capsule" fromto="${x} ${y} 0 ${x} ${y} ${z - 0.04}" size="0.004" group="2" contype="0" conaffinity="0" rgba="0.84 0.95 0.95 0.5"/>
    <geom name="hover_marker" type="sphere" pos="${x} ${y} ${z}" size="0.03" group="2" contype="0" conaffinity="0" rgba="0.84 0.95 0.95 0.6"/>
  </worldbody>
</mujoco>
`;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const here = dirname(fileURLToPath(import.meta.url));
export const ROBOT_DIR = resolve(here, '..', 'robot');
const rawUrl = (path, commit = COMMIT) => `https://raw.githubusercontent.com/${REPO}/${commit}/${MODEL_DIR}/${path}`;

async function download(path, commit = COMMIT) {
  const res = await fetch(rawUrl(path, commit));
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${rawUrl(path, commit)}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function readIfPresent(path) {
  try { return new Uint8Array(await readFile(path)); } catch { return undefined; }
}

/** The manifest that robot/SOURCE.json holds. `outputs` lists every file of robot/ except SOURCE.json itself. */
export function manifest(sourceHashes, sceneBytes) {
  const outputs = { ...sourceHashes, 'scene.xml': sha256(sceneBytes) };
  return {
    commit: COMMIT,
    repository: `https://github.com/${REPO}`,
    folder: MODEL_DIR,
    licence: 'Apache-2.0 (robot/LICENSE, unchanged)',
    scriptVersion: SCRIPT_VERSION,
    sources: Object.fromEntries(Object.entries(sourceHashes).sort(([a], [b]) => (a < b ? -1 : 1))),
    generated: { 'scene.xml': 'scripts/fetch-assets.mjs (sceneXml)' },
    outputs: Object.fromEntries(Object.entries(outputs).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

async function check() {
  let ok = true;
  for (const [path, want] of Object.entries(SOURCES)) {
    const bytes = await readIfPresent(join(ROBOT_DIR, path));
    const got = bytes === undefined ? 'missing' : sha256(bytes);
    if (got !== want) { ok = false; console.log(`${path}: ${got === 'missing' ? 'missing' : 'hash differs'}`); }
  }
  const scene = await readIfPresent(join(ROBOT_DIR, 'scene.xml'));
  if (scene === undefined || Buffer.compare(Buffer.from(scene), Buffer.from(sceneXml())) !== 0) { ok = false; console.log('scene.xml: differs from the generator'); }
  const src = await readIfPresent(join(ROBOT_DIR, 'SOURCE.json'));
  if (src === undefined) { ok = false; console.log('SOURCE.json: missing'); }
  console.log(ok ? 'Assets are current.' : 'Assets are not current: run node scripts/fetch-assets.mjs.');
  return ok ? 0 : 1;
}

async function resolveHashes() {
  const out = {};
  for (const path of Object.keys(SOURCES)) out[path] = sha256(await download(path));
  console.log(JSON.stringify(out, null, 2));
  return 0;
}

async function main(argv) {
  if (argv.includes('--check')) return check();
  if (argv.includes('--resolve')) return resolveHashes();
  if ((await check().then((c) => c, () => 1)) === 0) return 0;
  await mkdir(ROBOT_DIR, { recursive: true });
  const written = new Map();
  for (const [path, want] of Object.entries(SOURCES)) {
    let bytes = await readIfPresent(join(ROBOT_DIR, path));
    if (bytes === undefined || sha256(bytes) !== want) {
      bytes = await download(path);
      const got = sha256(bytes);
      if (got !== want) throw new Error(`${path}: expected sha256 ${want}, got ${got}. Upstream changed, or the pin moved.`);
    }
    written.set(path, bytes);
  }
  const scene = Buffer.from(sceneXml());
  await rm(join(ROBOT_DIR, 'assets'), { recursive: true, force: true });
  for (const [path, bytes] of written) {
    await mkdir(dirname(join(ROBOT_DIR, path)), { recursive: true });
    await writeFile(join(ROBOT_DIR, path), bytes);
  }
  await writeFile(join(ROBOT_DIR, 'scene.xml'), scene);
  await writeFile(join(ROBOT_DIR, 'SOURCE.json'), `${JSON.stringify(manifest(SOURCES, scene), null, 2)}\n`);
  console.log(`robot folder: ${written.size + 2} files written to ${ROBOT_DIR}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : String(e)); return 1; });
}
