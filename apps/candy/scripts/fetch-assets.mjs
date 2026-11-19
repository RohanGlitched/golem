#!/usr/bin/env node
// Asset pipeline for the Candy app: downloads the Franka Panda from MuJoCo Menagerie at a pinned commit,
// simplifies its meshes, patches in the suction cup and writes robot/ (panda.xml, scene.xml, assets/*.obj, LICENSE).
//
//   node scripts/fetch-assets.mjs                run (no-op when robot/ is current)
//   node scripts/fetch-assets.mjs --check        report whether robot/ is current; no network
//   node scripts/fetch-assets.mjs --resolve      print the sha256 of every source file at the pinned commit
//   node scripts/fetch-assets.mjs --resolve --head   the same for the current head of Menagerie
//
// Network access: raw.githubusercontent.com (and api.github.com for --resolve --head), only in an explicit run.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './lib/hash.mjs';
import { collisionMesh, visualMesh } from './lib/mesh.mjs';
import { parseBinaryStl, parseObj, writeObj } from './lib/obj.mjs';
import { patchPanda, upstreamMeshes } from './lib/patch.mjs';
import { writeScene } from './lib/scene.mjs';
import { headUrl, isAllowedHost, pandaUrl } from './lib/urls.mjs';

/** mujoco_menagerie at the commit pinned in .kiro/steering/interfaces.md. */
export const MENAGERIE_COMMIT = '370c43965323c0944b433b202aac5058b5f907a9';

/**
 * sha256 of every upstream file the script downloads, by path inside franka_emika_panda.
 * `null` until `node scripts/fetch-assets.mjs --resolve` has been run once and its output pasted here.
 * @type {Record<string, string> | null}
 */
export const ASSET_HASHES = {
  'LICENSE': 'a6cba85bc92e0cff7a450b1d873c0eaa2e9fc96bf472df0247a26bec77bf3ff9',
  'assets/link0.stl': 'dfc6d94330de8ddb005b311bfdba9f3b8e1aa7c256b71592ee7ff32cb9a9a5aa',
  'assets/link0_0.obj': '6b9f41a4c203540daaeb7a33cc3d0d6c6a32dc8bba187074eeaf97b3e36b3f9c',
  'assets/link0_1.obj': '57673d2ee2a9db2e10c8986ae57c56a7c39c012b60fd26d7d8549553b664a5ed',
  'assets/link0_10.obj': 'c9198b9d8534d628d097b0f2b239bb30343353182df098ce0d9db6bc13326848',
  'assets/link0_11.obj': 'f0adec78d6677b7799d25121981270e8bfe119b5c18d08a91ee37a54ad75f65c',
  'assets/link0_2.obj': '1ca435a2a87a9608a146a47955724d43dd7ce10fc3dd3018800aa98f8ba86e05',
  'assets/link0_3.obj': '3e9c6334d2b3b47944af3458ee5f20519abc20fe7ee23063bb53405ccab28046',
  'assets/link0_4.obj': '215d25789704936120f119c0bc1cc7f68516dd3f8f1df61457b71acac3873f26',
  'assets/link0_5.obj': '9361b104e93743045107aa5b15fb1a0835ba9c1f355aae71f56403cf6a9c33f6',
  'assets/link0_7.obj': '2dc0b8ebbbc80e4c065d71e195adbc384f673438641fac82b07b801b4d2837cb',
  'assets/link0_8.obj': '3b8c436999db5586b8eb47bed2b0aa7de6993868b2681b4c04246eeac42fdb7a',
  'assets/link0_9.obj': '45178f97d2b5da6bce11f610212c4ef7d08c73db33a4fc38e1b7f66b93d023f5',
  'assets/link1.obj': '51091e776b16babdbe2f3849b5c041f921d1f11dd94ac19a0f1c81abf496fbae',
  'assets/link1.stl': 'e41a39a94108fcf56aacff603fc91ec80541f4c1af17b51a0de5617f5566e6d2',
  'assets/link2.obj': '5c9f8e715de52c3eb71b475de35993b3b96081e02abea9f28c414768877fc59b',
  'assets/link2.stl': '370f7605a0fae3529db169ded50f52f171024aa792d4d773bc84197301f6a039',
  'assets/link3.stl': '0a8d638b9349c6c0eefc4e888636ac4838c4b27170f18a51699321118af709c1',
  'assets/link3_0.obj': 'ce2da87f51708e11b189249d41401065dabe89a06e251185a06cef4d5ff27178',
  'assets/link3_1.obj': '2880b7753a7173f38fa87ee21da4dfc7fa7be46fbe07bac5aef9e128513cb118',
  'assets/link3_2.obj': '670cff81ae84693769ca4ae658c154cf909d81167e7c8d22b70ea977f2504efa',
  'assets/link3_3.obj': '30ede0c812efd0e0b767d134a4eae0b84e0fa407bb6325a5a555e0569b3a3ffd',
  'assets/link4.stl': '0180ebb5772ec9840cb049750cffb29a9ddc90311752a16ea34757782ef9e48d',
  'assets/link4_0.obj': '443bf6d178177cf347951ecf107ccd10ca444e605e375b67304579e5f948806f',
  'assets/link4_1.obj': 'ca935ec7cc8b3f0e86aa079c76b0b3bf593b1e9830bab0fa7131ac51577c74f0',
  'assets/link4_2.obj': 'c89caf26d379c35bb9e191ee2d91d09ab29ecc792b48d8bc10b39e5b38222175',
  'assets/link4_3.obj': '1495d17f45bdb230cf58b0beef9da4e8c9cfe76a3d2d38da89017efe5e093136',
  'assets/link5_0.obj': 'a3238b8f2af0f2eb66d9fe63dc5d41ac52d5d38507241b5ed10e3cb019ab3e71',
  'assets/link5_1.obj': '9d994bbf83ec241e301b5197a6846da13f2a4a0582edb2c0f76962c5549649d6',
  'assets/link5_2.obj': '83b4ffe9f772cd7fe182e98640650eebc899aaf01842656574b0416c90dd40a4',
  'assets/link5_collision_0.obj': '3e5aa75fb13f193555c3dfb999df91d81df25006a5c3af5338297d78137c129b',
  'assets/link5_collision_1.obj': '87cd8f621071df010f774cbde789282b8463840dfe704f8bdfa2e29be0142e15',
  'assets/link5_collision_2.obj': '823ab6c8f7b1d79e0844fa071d82a03499ff68e34fddb1ba3451032c22736040',
  'assets/link6.stl': '20b768e99a0e0440b5754dcca108016434e57937cc356acd9c352ccd3cb27f77',
  'assets/link6_0.obj': '0504c70ebf1b284ee8faae7dcb896b8830bc672a6552015dd5dbd121fa031fb9',
  'assets/link6_1.obj': '45f7ca77695198b6d86ec2417ad4e42e6275044f0f96266699ee8e1057757ac1',
  'assets/link6_10.obj': '365f26c21d10332cab8d8704645cb46930c30b3085956f2d097498c793f24db4',
  'assets/link6_11.obj': '8ae61e08b3ad064f25bbf03b22e59cc15d65883b5a7ce92711aff29df2493901',
  'assets/link6_12.obj': 'f28d1bfd62b0244ffd19fb35fe9edefdf583d3c9167db944e87185d919e1d021',
  'assets/link6_13.obj': '0a55fa92dccb261d07200e6565fca4c850fd17f0c1ecf38821c0b97d51796c7d',
  'assets/link6_14.obj': '750ae3ee4781e62e3a045c662195247b03f6642b05aa93104f08258e5f6eba26',
  'assets/link6_15.obj': '5999c1c2497a004a7c4bbe034cdf13744f839d85ae7a11b1bc386c48a3e642e6',
  'assets/link6_16.obj': '551d7a8b37c53e7a152d008b4e36992e5b5abe74a4be18b57ee6319c27def09f',
  'assets/link6_2.obj': 'e54eee4d8232947ee8af65afd5a067e09dac2da6e7e585cb1dccb65496457da0',
  'assets/link6_3.obj': 'd4f6a25ef32fa1fa4734146981994ee760232cb077c80fea6487d78a077c7f27',
  'assets/link6_4.obj': 'be353480fe71d46f7a96f0a3cbb7e112caaf8d88368826f321a36a253c8749b2',
  'assets/link6_5.obj': '7c87664623c3e1a6cb330db273227a69626dc5e53b4caff1d4ee7911eb3340c6',
  'assets/link6_6.obj': '8fbc031e0d07b795ebf99115c75223141caaba317cab569159f3d477a7821681',
  'assets/link6_7.obj': '7dc5ebb799fe281aab27d6e84e7a4efa0a8e42da2369ec83de3ea3f206f62d73',
  'assets/link6_8.obj': 'e3f77381817a341030f9dcc4c4aa7c559f80411b453fd87eb0fefecca82151bf',
  'assets/link6_9.obj': '25a56ea9b02a03b6cb5a81f31c54f54d0185e1a0b3937c37e4289d896e50215a',
  'assets/link7.stl': '92ac6afcf7574c034d3170d8a68e95ac9048ab9d0dd5bbd8311b86e551b9ab1c',
  'assets/link7_0.obj': '04586b0bde011715cfc22072ac72fe0717eb4d4817bcf665987ce6cd88eb2b93',
  'assets/link7_1.obj': 'c3f72289f394c9d6749a4a327fb11f05b203c37c95032c92f28019b40ebe7e00',
  'assets/link7_2.obj': 'd2faecedb304d0989040d082410378dc949dbbda23bd18c05134f08aae984db5',
  'assets/link7_3.obj': 'b62d87c4d4bdb7b281ed341d347c39dad0e50bf36aed8ac11d050073701d5f70',
  'assets/link7_4.obj': 'cb78ccb61fd4ad6c7bff4c4d2e6cb41e1964a5a3e1a28e67c0c6202371cfc018',
  'assets/link7_5.obj': '099071d3090b51471ba52f4f90814fd3089f4975d196e4d488117073d0bfe491',
  'assets/link7_6.obj': '99469e2d95ab74ce0292f2f16954c87a8a7dc16652e62e970fe37c94330a81bb',
  'assets/link7_7.obj': '426c3db8a19373f3dc73d4bec672e948121b2914c10e2e7b9c7ea80643a19e54',
  'panda_nohand.xml': 'f05c9674dbc6081c8f096133d8537bdd977f87ec8eeb6264a77a9295ae88af09',
};

/** Bump when the generated files change for the same commit. Recorded in robot/SOURCE.json. */
export const SCRIPT_VERSION = 3;

const PANDA_XML = 'panda_nohand.xml';
const LICENSE_PATH = 'LICENSE';

/** An expected failure: the script prints the message and exits non-zero. */
export class AssetError extends Error {}

/**
 * @typedef {{ xml: string, license: Uint8Array, meshes: Map<string, Uint8Array> }} PipelineInputs
 */

/** @param {string} path @param {string} role @param {string} file */
const outputMeshName = (file, role) => {
  const stem = file.replace(/\.[^.]+$/, '');
  return role === 'collision' ? `${stem}.hull.obj` : `${stem}.obj`;
};

/**
 * Pure core: upstream bytes in, robot/ files out (path under robot/ to bytes), SOURCE.json last.
 * @param {PipelineInputs} inputs
 * @param {{ commit?: string, hashes?: Record<string, string> | null }} [opts]
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function runPipeline(inputs, opts = {}) {
  const commit = opts.commit ?? MENAGERIE_COMMIT;
  const enc = new TextEncoder();
  /** @type {Map<string, Uint8Array>} */ const files = new Map();

  files.set('panda.xml', enc.encode(patchPanda(inputs.xml, outputMeshName)));
  for (const { file, role } of upstreamMeshes(inputs.xml)) {
    const bytes = inputs.meshes.get(file);
    if (bytes === undefined) throw new AssetError(`mesh ${file} is missing from the downloaded files`);
    const mesh = file.endsWith('.stl') ? parseBinaryStl(bytes) : parseObj(new TextDecoder().decode(bytes));
    const out = role === 'collision' ? await collisionMesh(mesh, file) : await visualMesh(mesh);
    files.set(`assets/${outputMeshName(file, role)}`, enc.encode(writeObj(out)));
  }
  files.set('scene.xml', enc.encode(writeScene('panda.xml')));
  files.set('LICENSE', inputs.license.slice());

  /** @type {Record<string, string>} */ const outputs = {};
  for (const path of [...files.keys()].sort()) outputs[path] = sha256(/** @type {Uint8Array} */ (files.get(path)));
  /** @type {Record<string, string>} */ const sources = {};
  sources[PANDA_XML] = sha256(enc.encode(inputs.xml));
  sources[LICENSE_PATH] = sha256(inputs.license);
  for (const f of [...inputs.meshes.keys()].sort()) sources[`assets/${f}`] = sha256(/** @type {Uint8Array} */ (inputs.meshes.get(f)));
  const manifest = { commit, scriptVersion: SCRIPT_VERSION, sources, outputs };
  files.set('SOURCE.json', enc.encode(`${JSON.stringify(manifest, null, 2)}\n`));
  return files;
}

/**
 * Downloads one file. Throws an AssetError that names the URL, the status and the file path.
 * @param {typeof fetch} fetchImpl @param {string} commit @param {string} path
 * @returns {Promise<Uint8Array>}
 */
async function get(fetchImpl, commit, path) {
  const url = pandaUrl(commit, path);
  if (!isAllowedHost(url)) throw new AssetError(`refusing to request ${url}: host not allowed`);
  let res;
  try {
    res = await fetchImpl(url);
  } catch (e) {
    throw new AssetError(`download failed for ${path}: ${url} gave no response (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!(res.status >= 200 && res.status < 300)) {
    throw new AssetError(`download failed for ${path}: ${url} returned HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Downloads every upstream input of the pipeline. With `hashes`, each file must match its recorded sha256.
 * @param {typeof fetch} fetchImpl
 * @param {{ commit?: string, hashes?: Record<string, string> | null, verify?: boolean }} [opts]
 * @returns {Promise<{ inputs: PipelineInputs, digests: Record<string, string> }>}
 */
export async function downloadInputs(fetchImpl, opts = {}) {
  const commit = opts.commit ?? MENAGERIE_COMMIT;
  const verify = opts.verify ?? true;
  const hashes = opts.hashes === undefined ? ASSET_HASHES : opts.hashes;
  if (verify && hashes === null) {
    throw new AssetError('Run --resolve once and paste the printed commit and hashes into scripts/fetch-assets.mjs.');
  }
  /** @type {Record<string, string>} */ const digests = {};
  const fetchChecked = async (path) => {
    const bytes = await get(fetchImpl, commit, path);
    const actual = sha256(bytes);
    digests[path] = actual;
    if (verify) {
      const expected = /** @type {Record<string, string>} */ (hashes)[path];
      if (expected === undefined) throw new AssetError(`no recorded hash for ${path}; run --resolve and paste the new hashes`);
      if (expected !== actual) throw new AssetError(`hash mismatch for ${path}: expected ${expected}, got ${actual}`);
    }
    return bytes;
  };
  const xmlBytes = await fetchChecked(PANDA_XML);
  const xml = new TextDecoder().decode(xmlBytes);
  /** @type {Map<string, Uint8Array>} */ const meshes = new Map();
  for (const { file } of upstreamMeshes(xml)) meshes.set(file, await fetchChecked(`assets/${file}`));
  const license = await fetchChecked(LICENSE_PATH);
  return { inputs: { xml, license, meshes }, digests };
}

/** Writes only below `root`. @param {string} root */
export function makeWriter(root) {
  const base = resolve(root);
  return async (path, bytes) => {
    const full = resolve(path);
    if (!(full === base || full.startsWith(base + sep))) throw new AssetError(`refusing to write ${full}: outside ${base}`);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  };
}

/**
 * @param {string} robotDir
 * @returns {Promise<{ current: boolean, reason: string, manifest?: any }>}
 */
export async function checkCurrent(robotDir, commit = MENAGERIE_COMMIT) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(robotDir, 'SOURCE.json'), 'utf8'));
  } catch {
    return { current: false, reason: 'robot/SOURCE.json is missing or unreadable' };
  }
  if (manifest.commit !== commit) return { current: false, reason: `robot/ was built from commit ${manifest.commit}, not ${commit}`, manifest };
  if (manifest.scriptVersion !== SCRIPT_VERSION) {
    return { current: false, reason: `robot/ was built by script version ${manifest.scriptVersion}, not ${SCRIPT_VERSION}`, manifest };
  }
  for (const [path, expected] of Object.entries(manifest.outputs ?? {})) {
    let bytes;
    try { bytes = await readFile(join(robotDir, path)); } catch { return { current: false, reason: `robot/${path} is missing`, manifest }; }
    const actual = sha256(new Uint8Array(bytes));
    if (actual !== expected) return { current: false, reason: `robot/${path} has hash ${actual}, expected ${expected}`, manifest };
  }
  return { current: true, reason: 'every file has the expected hash', manifest };
}

/** Text to paste into this script after `--resolve`. @param {string} commit @param {Record<string, string>} digests */
export function resolveSnippet(commit, digests) {
  const lines = Object.keys(digests).sort().map((p) => `  '${p}': '${digests[p]}',`);
  return [
    '// Paste into scripts/fetch-assets.mjs',
    `export const MENAGERIE_COMMIT = '${commit}';`,
    'export const ASSET_HASHES = {',
    ...lines,
    '};',
    '',
  ].join('\n');
}

/**
 * @param {{ argv?: string[], fetchImpl?: typeof fetch, robotDir?: string, log?: (s: string) => void,
 *           commit?: string, hashes?: Record<string, string> | null }} [opts]
 * @returns {Promise<number>} process exit code
 */
export async function main(opts = {}) {
  const argv = opts.argv ?? process.argv.slice(2);
  const log = opts.log ?? ((s) => console.log(s));
  const fetchImpl = opts.fetchImpl ?? fetch;
  const robotDir = opts.robotDir ?? fileURLToPath(new URL('../robot/', import.meta.url));
  let commit = opts.commit ?? MENAGERIE_COMMIT;
  const hashes = opts.hashes === undefined ? ASSET_HASHES : opts.hashes;
  try {
    if (argv.includes('--check')) {
      const r = await checkCurrent(robotDir, commit);
      log(r.current ? 'Assets are current.' : `Assets are not current: ${r.reason}.`);
      return r.current ? 0 : 1;
    }
    if (argv.includes('--resolve')) {
      if (argv.includes('--head')) {
        const url = headUrl();
        const res = await fetchImpl(url);
        if (res.status !== 200) throw new AssetError(`could not read the Menagerie head: ${url} returned HTTP ${res.status}`);
        commit = /** @type {{ sha: string }} */ (await res.json()).sha;
      }
      const { digests } = await downloadInputs(fetchImpl, { commit, hashes: null, verify: false });
      log(resolveSnippet(commit, digests));
      return 0;
    }
    const current = await checkCurrent(robotDir, commit);
    if (current.current) { log('Assets are current.'); return 0; }
    const { inputs } = await downloadInputs(fetchImpl, { commit, hashes });
    const files = await runPipeline(inputs, { commit, hashes });
    // Nothing is written until every file has been downloaded, verified and processed.
    const write = makeWriter(robotDir);
    const previous = new Set(Object.keys(current.manifest?.outputs ?? {}));
    for (const path of previous) if (!files.has(path)) await rm(join(robotDir, path), { force: true });
    for (const [path, bytes] of [...files.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) await write(join(robotDir, path), bytes);
    log(`robot folder: ${files.size} files written to ${robotDir}`);
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
