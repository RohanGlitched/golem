// Builds the home page's hero pack: the G1's visual meshes at ghost detail plus a recorded campaign of
// real trials (no physics runs in the browser for the hero). Usage: npx tsx site/scripts/hero-pack.mts
// Writes site/public/hero/pack.json (index) and site/public/hero/pack.bin (Float32 / Uint16 payload).
import load from '@mujoco/mujoco';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ModelCache, compileRequirement, runTrial } from 'golem-spec';
import stagger, { setReflex } from '../../apps/stagger/app.ts';
import { lexicon } from '../../apps/stagger/lexicon.ts';
import { clusterSimplify, ghostCell } from '../../skeleton/src/ui/ghosts/ghost-lod.ts';

const OUT = fileURLToPath(new URL('../public/hero/', import.meta.url));
const ROBOT = new URL('../../apps/stagger/robot/', import.meta.url);
const VISUAL_GROUP = 2;
const N_DIRS = 24;           // one ghost per 15 degrees around the robot
const FORCE = Number(process.argv[2] ?? 150);   // N, the line the circle inscribes
const PHASE = 0.2;           // the weakest stride phase in the stability map
const FPS = 30;
const REFLEX = (process.argv[3] ?? 'none') as 'none' | 'kiro';
setReflex(REFLEX);
const NAME = REFLEX === 'kiro' ? 'pack-kiro' : 'pack';

// ---- meshes at ghost detail, straight from the compiled model
const mj = await load();
mj.FS.mkdirTree('/robot/meshes');
for (const f of readdirSync(ROBOT)) if (f.endsWith('.xml')) mj.FS.writeFile(`/robot/${f}`, readFileSync(new URL(f, ROBOT)));
for (const f of readdirSync(new URL('meshes/', ROBOT))) mj.FS.writeFile(`/robot/meshes/${f}`, readFileSync(new URL(`meshes/${f}`, ROBOT)));
const m = mj.MjModel.from_xml_path('/robot/scene.xml');
const chunks: ArrayBuffer[] = [];
let offset = 0;
const push = (a: Float32Array | Uint16Array | Uint32Array): { off: number; len: number } => {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { chunks.push(new ArrayBuffer(pad)); offset += pad; }
  const r = { off: offset, len: a.length };
  chunks.push(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer); offset += a.byteLength;
  return r;
};
const geoms: unknown[] = [];
let tris = 0;
for (let g = 0; g < m.ngeom; g++) {
  if (m.geom_group[g] !== VISUAL_GROUP || m.geom_type[g] !== 7) continue; // visual meshes only
  const id = m.geom_dataid[g];
  const va = m.mesh_vertadr[id], vn = m.mesh_vertnum[id], fa = m.mesh_faceadr[id], fn = m.mesh_facenum[id];
  const pos = new Float32Array(m.mesh_vert.subarray(3 * va, 3 * (va + vn)));
  const idx = new Uint32Array(m.mesh_face.subarray(3 * fa, 3 * (fa + fn)));
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity, minz = Infinity, maxz = -Infinity;
  for (let i = 0; i < vn; i++) { const x = pos[3 * i]!, y = pos[3 * i + 1]!, z = pos[3 * i + 2]!; minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
  const lod = clusterSimplify(pos, idx, ghostCell(Math.hypot(maxx - minx, maxy - miny, maxz - minz)));
  tris += lod.index.length / 3;
  geoms.push({
    body: m.geom_bodyid[g],
    pos: Array.from(m.geom_pos.subarray(3 * g, 3 * g + 3)),
    quat: Array.from(m.geom_quat.subarray(4 * g, 4 * g + 4)),   // w x y z
    verts: push(lod.positions), index: push(Uint16Array.from(lod.index)),
  });
}
const nbody = m.nbody as number;
m.delete();

// ---- recorded trials: an idle walk and a ring of pushes at the circle's force
const cache = new ModelCache();
const req = (line: string) => {
  const c = compileRequirement(line, lexicon);
  if (!c.requirement) throw new Error(JSON.stringify(c.diagnostics));
  return c.requirement;
};
const pushReq = req(`R1. WHEN the pelvis is pushed with up to ${FORCE} N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s`);
const trials: unknown[] = [];
for (let i = 0; i < N_DIRS; i++) {
  const angle = (2 * Math.PI * i) / N_DIRS;
  const r = await runTrial(stagger, pushReq, { app: 'stagger', reqId: 'R1', seed: 7 + i, scenario: { 'push.force': FORCE, 'push.angle': angle, 'push.phase': PHASE }, record: 'poses' }, { cache });
  const p = r.poses!;
  trials.push({ angleDeg: (360 * i) / N_DIRS, force: FORCE, robustness: r.robustness, worstAt: r.worstAt, fell: r.robustness < 0, frames: p.frames.length / (p.nbody * 7), fps: p.fps, poses: push(p.frames) });
  process.stdout.write(`${(360 * i) / N_DIRS}deg ${r.robustness < 0 ? 'fell' : 'held'} (${r.robustness.toFixed(3)} m)  `);
}
// an idle walk (no push) for the hero standing in the circle
{
  const r = await runTrial(stagger, pushReq, { app: 'stagger', reqId: 'R1', seed: 3, scenario: { 'push.force': 0, 'push.angle': 0, 'push.phase': PHASE }, record: 'poses' }, { cache });
  const p = r.poses!;
  trials.push({ idle: true, angleDeg: 0, force: 0, robustness: r.robustness, worstAt: r.worstAt, fell: false, frames: p.frames.length / (p.nbody * 7), fps: p.fps, poses: push(p.frames) });
}
cache.dispose();

mkdirSync(OUT, { recursive: true });
const bin = new Uint8Array(offset);
let o = 0;
for (const c of chunks) { bin.set(new Uint8Array(c), o); o += c.byteLength; }
writeFileSync(OUT + NAME + '.bin', bin);
writeFileSync(OUT + NAME + '.json', JSON.stringify({
  reflex: REFLEX,
  note: 'Pose frames start at the trigger (t = warmup). Recorded real trials of Unitree\'s published G1 walking policy in MuJoCo (golem-spec), with visual meshes at ghost detail. Poses per frame: nbody x (x y z qw qx qy qz).',
  nbody, fps: FPS, warmup: stagger.warmup, force: FORCE, phase: PHASE, triangles: tris, geoms, trials,
}));
console.log(`\nwrote ${(offset / 1e6).toFixed(2)} MB, ${tris} triangles, ${trials.length} trials`);
