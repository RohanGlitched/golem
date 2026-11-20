// Builds apps/yard/robots/<id>/robot/: one MuJoCo Menagerie model at the commit pinned in robots.json, plus our scene.xml.
//
//   node scripts/fetch-assets.mjs [id ...]      download what is missing or changed (all robots when no id is given)
//   node scripts/fetch-assets.mjs --check [id]  report the state of robot/ without network access (exit 1 when not current)
//
// Only the files that the model XML names are fetched (its meshes and textures), plus the folder's LICENSE. Upstream files
// are kept byte for byte. The first fetch records every SHA-256 in robots/<id>/robot/SOURCE.json, which is committed; the
// meshes are not (see .gitignore), so a later fetch must reproduce the recorded hashes or it fails.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const YARD = resolve(here, '..');
const META = JSON.parse(await readFile(join(YARD, 'robots.json'), 'utf8'));
export const SIM_DT = 0.002;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const raw = (folder, path) => `https://raw.githubusercontent.com/${META.repository}/${META.commit}/${folder}/${path}`;

/** The files a model XML names: every file="..." attribute, under its compiler's meshdir / texturedir / assetdir. */
export function referencedFiles(xml) {
  const comp = /<compiler\b[^>]*>/.exec(xml)?.[0] ?? '';
  const attr = (name) => new RegExp(`\\b${name}="([^"]*)"`).exec(comp)?.[1];
  const assetdir = attr('assetdir');
  const meshdir = attr('meshdir') ?? assetdir ?? '';
  const texturedir = attr('texturedir') ?? assetdir ?? '';
  const out = new Set();
  const re = /<(mesh|texture|hfield|skin)\b[^>]*\bfile="([^"]+)"/g;
  for (let m; (m = re.exec(xml)) !== null;) {
    const dir = m[1] === 'texture' ? texturedir : meshdir;
    out.add(dir ? `${dir.replace(/\/$/, '')}/${m[2]}` : m[2]);
  }
  return [...out].sort();
}

/** The `<contact>` block of an upstream scene.xml (some models declare their floor contacts there), or '. */
export function contactBlock(sceneText) {
  return /<contact\b[\s\S]*?<\/contact>/.exec(sceneText)?.[0] ?? '';
}

/**
 * scene.xml: the upstream model, our timestep, and a floor in geom group 2 (the group the studio draws). `contact` is the
 * upstream scene's `<contact>` block, copied verbatim: a model whose geoms all have contype 0 (the Apollo) only touches the
 * floor through the pairs declared there, and they name the geom "floor".
 */
export function sceneXml(robot, contact = '') {
  return `<mujoco model="${robot.name} in the GOLEM yard">
  <include file="${robot.model}"/>

  <option timestep="${SIM_DT}"/>

  <visual>
    <headlight diffuse="0.6 0.6 0.6" ambient="0.3 0.3 0.3" specular="0 0 0"/>
  </visual>

  <worldbody>
    <geom name="floor" type="plane" size="0 0 0.05" group="2" rgba="0.55 0.5 0.45 1"/>
  </worldbody>${contact ? `\n\n  ${contact}` : ''}
</mujoco>
`;
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function build(robot, check) {
  const dir = join(YARD, 'robots', robot.id, 'robot');
  const manifestPath = join(dir, 'SOURCE.json');
  const old = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : undefined;
  const pinned = old?.commit === META.commit ? old.sources : undefined;
  // Upstream scene.xml's <contact> block: read from the manifest when one is pinned (so a rebuild needs no network), else fetched.
  let sceneContact = pinned ? old.sceneContact : undefined;
  if (!pinned && !check) {
    const upstream = await fetchBytes(raw(robot.folder, 'scene.xml')).catch((e) => (String(e).includes('HTTP 404') ? undefined : Promise.reject(e)));
    const xml = upstream ? contactBlock(new TextDecoder().decode(upstream)) : '';
    if (xml) sceneContact = { from: 'scene.xml', sha256: sha256(upstream), xml };
  }
  const scene = new TextEncoder().encode(sceneXml(robot, sceneContact?.xml));

  if (check) {
    if (!pinned) return `${robot.id}: no SOURCE.json for the pinned commit`;
    for (const [path, hash] of Object.entries({ ...pinned, 'scene.xml': sha256(scene) })) {
      const p = join(dir, path);
      if (!existsSync(p)) return `${robot.id}: ${path} is missing`;
      if (sha256(await readFile(p)) !== hash) return `${robot.id}: ${path} differs from SOURCE.json`;
    }
    return undefined;
  }

  const model = existsSync(join(dir, robot.model)) && pinned?.[robot.model] === sha256(await readFile(join(dir, robot.model)))
    ? new Uint8Array(await readFile(join(dir, robot.model)))
    : await fetchBytes(raw(robot.folder, robot.model));
  const paths = [robot.model, 'LICENSE', ...referencedFiles(new TextDecoder().decode(model))];
  const sources = {};
  let fetched = 0;
  for (const path of paths) {
    const p = join(dir, path);
    let bytes = path === robot.model ? model : undefined;
    if (!bytes && existsSync(p) && pinned?.[path] === sha256(await readFile(p))) bytes = new Uint8Array(await readFile(p));
    if (!bytes) { bytes = await fetchBytes(raw(robot.folder, path)); fetched++; }
    const h = sha256(bytes);
    if (pinned?.[path] !== undefined && pinned[path] !== h) throw new Error(`${robot.id}: ${path} does not match SOURCE.json`);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
    sources[path] = h;
  }
  await writeFile(join(dir, 'scene.xml'), scene);
  const manifest = {
    commit: META.commit,
    repository: `https://github.com/${META.repository}`,
    folder: robot.folder,
    licence: 'see robot/LICENSE (unchanged from the upstream folder)',
    sources: Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))),
    generated: { 'scene.xml': 'scripts/fetch-assets.mjs (sceneXml)' },
    ...(sceneContact ? { sceneContact } : {}),
    outputs: Object.fromEntries(Object.entries({ ...sources, 'scene.xml': sha256(scene) }).sort(([a], [b]) => a.localeCompare(b))),
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return `${robot.id}: ${paths.length} files (${fetched} downloaded)`;
}

const args = process.argv.slice(2);
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/').replace(/^\//, '')}` || process.argv[1]?.endsWith('fetch-assets.mjs')) {
  const check = args.includes('--check');
  const ids = args.filter((a) => !a.startsWith('--'));
  const robots = META.robots.filter((r) => ids.length === 0 || ids.includes(r.id));
  if (ids.length && robots.length !== ids.length) { console.error(`unknown robot; known: ${META.robots.map((r) => r.id).join(', ')}`); process.exit(2); }
  let bad = 0;
  for (const r of robots) {
    const msg = await build(r, check);
    if (check) { if (msg) { bad++; console.log(msg); } else console.log(`${r.id}: current`); } else console.log(msg);
  }
  process.exit(bad ? 1 : 0);
}
