#!/usr/bin/env node
// Asset pipeline for the Stagger app: downloads Unitree's G1 model and policy at the pinned commit,
// builds collision hulls and light visual meshes, rewrites the MJCF, packs the policy weights and writes robot/.
// Run with `npm run assets`. Network access: raw.githubusercontent.com and github.com only.
import { mkdtemp, mkdir, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINNED_COMMIT, isAllowedHost, upstreamUrl } from './lib/urls.mjs';
import { readZipEntries } from './lib/zip.mjs';
import { hullName, parseBinaryStl, visualName, writeBinaryStl } from './lib/stl.mjs';
import { buildHull } from './lib/hull.mjs';
import { buildVisual } from './lib/simplify.mjs';
import { referencedMeshFiles, rewriteMjcf, writeScene } from './lib/mjcf.mjs';
import { extractWeights, packPolicy } from './lib/pack.mjs';

export { PINNED_COMMIT };

const MJCF_PATH = 'resources/robots/g1_description/g1_12dof.xml';
const MESH_DIR = 'resources/robots/g1_description/meshes/';
const POLICY_PATH = 'deploy/pre_train/g1/motion.pt';
const LICENSE_PATH = 'LICENSE';
const MJCF_LOCAL = 'g1_12dof.xml';

/** An expected failure: the script prints the message and exits non-zero. */
export class AssetError extends Error {}

/**
 * @typedef {{ mjcf: string, meshes: Map<string, Uint8Array>, license: Uint8Array, policyZip: Uint8Array }} PipelineInputs
 */

/** Pure core: upstream bytes in, Robot_Folder files out (path under robot/ to bytes). No I/O.
 * @param {PipelineInputs} inputs
 * @param {string} [commit]
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function runPipeline(inputs, commit = PINNED_COMMIT) {
  /** @type {Map<string, Uint8Array>} */ const files = new Map();
  /** @type {Array<{ upstream: string, local: string }>} */ const sources = [];

  const mjcf = rewriteMjcf(inputs.mjcf);
  const refs = referencedMeshFiles(mjcf);
  const enc = new TextEncoder();
  files.set(MJCF_LOCAL, enc.encode(mjcf));
  sources.push({ upstream: MJCF_PATH, local: MJCF_LOCAL });

  const sourceOf = (f) => f.replace(/\.(hull|vis)\.stl$/, '');
  for (const f of [...refs.hull, ...refs.vis]) {
    const src = sourceOf(f);
    const bytes = inputs.meshes.get(src);
    if (bytes === undefined) throw new AssetError(`mesh ${src} is missing from the downloaded files`);
    const tris = parseBinaryStl(bytes);
    const isHull = f.endsWith('.hull.stl');
    const out = isHull ? buildHull(tris, src) : await buildVisual(tris);
    files.set(`meshes/${f}`, writeBinaryStl(out));
    sources.push({ upstream: MESH_DIR + src, local: `meshes/${f}` });
  }
  // Names must match hullName/visualName.
  for (const f of [...refs.hull]) if (f !== hullName(sourceOf(f))) throw new AssetError(`unexpected hull name ${f}`);
  for (const f of [...refs.vis]) if (f !== visualName(sourceOf(f))) throw new AssetError(`unexpected visual name ${f}`);

  files.set('scene.xml', enc.encode(writeScene(MJCF_LOCAL)));
  sources.push({ upstream: '(generated)', local: 'scene.xml' });

  const weights = extractWeights(readZipEntries(inputs.policyZip));
  files.set('policy.bin', packPolicy(weights, commit));
  sources.push({ upstream: POLICY_PATH, local: 'policy.bin' });

  files.set('LICENSE', inputs.license.slice());
  sources.push({ upstream: LICENSE_PATH, local: 'LICENSE' });

  sources.sort((a, b) => (a.local < b.local ? -1 : a.local > b.local ? 1 : 0));
  files.set('SOURCE.json', enc.encode(`${JSON.stringify({ commit, files: sources }, null, 2)}\n`));
  return files;
}

/**
 * Downloads every upstream input. Only allowed hosts are requested.
 * @param {typeof fetch} fetchImpl
 * @param {string} [commit]
 * @returns {Promise<PipelineInputs>}
 */
export async function downloadInputs(fetchImpl, commit = PINNED_COMMIT) {
  const get = async (path, what) => {
    const url = upstreamUrl(commit, path);
    if (!isAllowedHost(url)) throw new AssetError(`refusing to request ${url}: host not allowed`);
    const res = await fetchImpl(url);
    if (res.status !== 200) throw new AssetError(`${what ?? 'download'} failed: ${url} returned HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const mjcf = new TextDecoder().decode(await get(MJCF_PATH));
  /** @type {Map<string, Uint8Array>} */ const meshes = new Map();
  const names = [...mjcf.matchAll(/<mesh\b[^>]*\sfile="([^"]+)"/g)].map((m) => /** @type {string} */ (m[1]));
  for (const name of new Set(names)) {
    const url = upstreamUrl(commit, MESH_DIR + name);
    const res = await fetchImpl(url);
    if (res.status !== 200) throw new AssetError(`mesh ${name} could not be downloaded: ${url} returned HTTP ${res.status}`);
    meshes.set(name, new Uint8Array(await res.arrayBuffer()));
  }
  const license = await get(LICENSE_PATH);
  const policyZip = await get(POLICY_PATH);
  return { mjcf, meshes, license, policyZip };
}

/** Writes only below `root` or `tmp`. @param {string} root @param {string} tmp */
export function makeWriter(root, tmp) {
  const roots = [resolve(root), resolve(tmp)];
  return async (path, bytes) => {
    const full = resolve(path);
    if (!roots.some((r) => full === r || full.startsWith(r + sep))) {
      throw new AssetError(`refusing to write ${full}: outside ${roots.join(' and ')}`);
    }
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  };
}

async function dirSize(dir) {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}

/**
 * @param {{ fetchImpl?: typeof fetch, robotDir?: string, log?: (s: string) => void }} [opts]
 * @returns {Promise<number>} process exit code
 */
export async function main(opts = {}) {
  const log = opts.log ?? ((s) => console.log(s));
  const robotDir = opts.robotDir ?? fileURLToPath(new URL('../robot/', import.meta.url));
  const tmp = await mkdtemp(join(tmpdir(), 'stagger-assets-'));
  try {
    const writeInsideRobot = makeWriter(robotDir, tmp);
    const inputs = await downloadInputs(opts.fetchImpl ?? fetch);
    const files = await runPipeline(inputs);
    await rm(join(robotDir, 'meshes'), { recursive: true, force: true });
    for (const [path, bytes] of files) await writeInsideRobot(join(robotDir, path), bytes);
    log(`robot folder: ${files.size} files, ${await dirSize(robotDir)} bytes (${relative(process.cwd(), robotDir) || '.'})`);
    return 0;
  } catch (e) {
    console.error(e instanceof AssetError ? e.message : (e instanceof Error ? `${e.message}` : String(e)));
    return 1;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}