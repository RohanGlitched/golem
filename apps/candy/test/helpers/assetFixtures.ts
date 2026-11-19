// Small synthetic upstream inputs for the asset script tests (no network, no real Menagerie files).
import { sha256 } from '../../scripts/lib/hash.mjs';
import { pandaUrl } from '../../scripts/lib/urls.mjs';

export const COMMIT = '0123456789abcdef0123456789abcdef01234567';
export const LICENSE_TEXT = 'Apache License stub\nVersion 2.0\n';

/** A cube as OBJ text, with normals and texture coordinates that the parser must skip. */
export function cubeObj(scale = 1): string {
  const v: number[][] = [];
  for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) v.push([x * scale, y * scale, z * scale]);
  const lines = ['# cube', 'vn 0 0 1', 'vt 0 0', ...v.map((p) => `v ${p.join(' ')}`)];
  const quads = [[1, 2, 4, 3], [5, 7, 8, 6], [1, 5, 6, 2], [3, 4, 8, 7], [1, 3, 7, 5], [2, 6, 8, 4]];
  for (const q of quads) lines.push(`f ${q.map((i) => `${i}/1/1`).join(' ')}`);
  return `${lines.join('\n')}\n`;
}

/** A tetrahedron as binary STL. */
export function tetraStl(): Uint8Array {
  const p = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const f = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
  const out = new Uint8Array(84 + 50 * f.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(80, f.length, true);
  f.forEach((tri, i) => tri.forEach((v, k) => p[v]!.forEach((c, j) => dv.setFloat32(84 + 50 * i + 12 + 12 * k + 4 * j, c, true))));
  return out;
}

/** A panda_nohand.xml stand-in with every anchor the patch needs. */
export function stubPandaXml(): string {
  return `<mujoco model="panda nohand">
  <compiler angle="radian" meshdir="assets" autolimits="true"/>
  <default>
    <default class="panda">
      <default class="panda/visual">
        <geom type="mesh" contype="0" conaffinity="0" group="2"/>
      </default>
      <default class="panda/collision">
        <geom type="mesh" group="3"/>
      </default>
    </default>
  </default>
  <asset>
    <mesh name="link0_c" file="link0.stl"/>
    <mesh name="link7_c" file="link7_collision.obj"/>
    <mesh file="link0_0.obj"/>
  </asset>
  <worldbody>
    <body name="link0" childclass="panda">
      <geom mesh="link0_0" class="panda/visual"/>
      <geom mesh="link0_c" class="panda/collision"/>
      <body name="link7" pos="0 0 0.3">
        <inertial mass="1" pos="0 0 0" diaginertia="0.01 0.01 0.01"/>
        <joint name="joint7" axis="0 0 1"/>
        <geom mesh="link7_c" class="panda/collision"/>
        <body name="attachment" pos="0 0 0.107" quat="0.3826834 0 0 0.9238795">
          <site name="attachment_site"/>
        </body>
      </body>
    </body>
  </worldbody>
  <actuator>
    <general class="panda" name="actuator7" joint="joint7" gainprm="2000" biasprm="0 -2000 -200"/>
  </actuator>
  <keyframe>
    <key name="home" qpos="0" ctrl="0"/>
  </keyframe>
</mujoco>
`;
}

export interface Stub {
  files: Map<string, Uint8Array>;    // path inside franka_emika_panda -> bytes
  hashes: Record<string, string>;
}

export function stubUpstream(): Stub {
  const enc = new TextEncoder();
  const files = new Map<string, Uint8Array>([
    ['panda_nohand.xml', enc.encode(stubPandaXml())],
    ['LICENSE', enc.encode(LICENSE_TEXT)],
    ['assets/link0.stl', tetraStl()],
    ['assets/link7_collision.obj', enc.encode(cubeObj(0.1))],
    ['assets/link0_0.obj', enc.encode(cubeObj(0.2))],
  ]);
  const hashes: Record<string, string> = {};
  for (const [p, b] of files) hashes[p] = sha256(b);
  return { files, hashes };
}

/** A fetch that serves the stub files; `status` can fail chosen URLs. */
export function stubFetch(stub: Stub, opts: { status?: (url: string) => number; commit?: string } = {}) {
  const commit = opts.commit ?? COMMIT;
  const urls: string[] = [];
  const byUrl = new Map<string, Uint8Array>();
  for (const [p, b] of stub.files) byUrl.set(pandaUrl(commit, p), b);
  const fn = async (url: string): Promise<Response> => {
    urls.push(url);
    const status = opts.status?.(url) ?? 200;
    const body = byUrl.get(url) ?? new Uint8Array();
    return { status, arrayBuffer: async () => body.slice().buffer } as unknown as Response;
  };
  return { fn: fn as unknown as typeof fetch, urls };
}
