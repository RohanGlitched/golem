// Small synthetic upstream inputs for the asset pipeline tests.
import { writeBinaryStl } from '../../scripts/lib/stl.mjs';
import { writeZip } from '../../scripts/lib/zip.mjs';
import { WEIGHT_SPECS, ZIP_ENTRY_FOR } from '../../scripts/lib/pack.mjs';

export const LEG_JOINTS = ['hip_pitch', 'hip_roll', 'hip_yaw', 'knee', 'ankle_pitch', 'ankle_roll'];

/** A tetrahedron as a triangle soup. */
export function tetra(scale = 1): Float32Array {
  const p = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => v.map((x) => x * scale));
  const f = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
  const out = new Float32Array(36);
  f.forEach((t, i) => t.forEach((v, k) => out.set(p[v] as number[], 9 * i + 3 * k)));
  return out;
}

/** A G1-like MJCF: a pelvis with a free joint, 12 leg joints in order, collision and visual meshes. */
export function smallMjcf(): string {
  const names: string[] = [];
  for (const side of ['left', 'right']) for (const j of LEG_JOINTS) names.push(`${side}_${j}`);
  const bodies = names.map((n) => `
      <body name="${n}_link" pos="0 0 -0.1">
        <inertial pos="0 0 0" mass="1" diaginertia="0.01 0.01 0.01"/>
        <joint name="${n}_joint" axis="0 1 0" range="-1 1"/>
        <geom type="mesh" contype="0" conaffinity="0" group="1" density="0" rgba="0.2 0.2 0.2 1" mesh="${n}_mesh"/>
        <geom type="mesh" rgba="0.2 0.2 0.2 1" mesh="${n}_mesh"/>
      </body>`).join('');
  const meshes = ['pelvis', ...names.map((n) => `${n}_mesh`)];
  return `<mujoco model="g1_12dof">
  <compiler angle="radian" meshdir="meshes/"/>
  <asset>
${meshes.map((m) => `    <mesh name="${m}" file="${m}.STL"/>`).join('\n')}
  </asset>
  <worldbody>
    <body name="pelvis" pos="0 0 0.793">
      <inertial pos="0 0 0" mass="10" diaginertia="0.5 0.5 0.2"/>
      <joint name="floating_base_joint" type="free"/>
      <geom type="mesh" contype="0" conaffinity="0" group="1" density="0" mesh="pelvis"/>
      <geom type="mesh" mesh="pelvis"/>
      <geom size="0.005" pos="0 0 0" rgba="0.2 0.2 0.2 1"/>${bodies}
    </body>
  </worldbody>
  <actuator>
${names.map((n) => `    <motor name="${n}_joint" joint="${n}_joint"/>`).join('\n')}
  </actuator>
</mujoco>`;
}

export function smallMeshes(): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>();
  m.set('pelvis.STL', writeBinaryStl(tetra()));
  for (const side of ['left', 'right']) for (const j of LEG_JOINTS) m.set(`${side}_${j}_mesh.STL`, writeBinaryStl(tetra(2)));
  return m;
}

/** A torch-like zip with entries data/0..9 whose float values are the entry index. */
export function policyZip(opts: { deflate?: boolean; drop?: string; shortEntry?: string } = {}): Uint8Array {
  const entries: Array<{ name: string; data: Uint8Array; deflate?: boolean }> = [];
  for (const s of WEIGHT_SPECS) {
    const name = ZIP_ENTRY_FOR[s.name] as string;
    if (name === opts.drop) continue;
    const n = s.shape.reduce((a, b) => a * b, 1);
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = Number(name.split('/').pop()) + i / 1000;
    let bytes = new Uint8Array(f.buffer);
    if (name === opts.shortEntry) bytes = bytes.subarray(0, bytes.length - 4);
    entries.push({ name, data: bytes, deflate: opts.deflate });
  }
  entries.push({ name: 'policy_lstm_1/data.pkl', data: new Uint8Array([1, 2, 3]), deflate: true });
  return writeZip(entries);
}

export const LICENSE_TEXT = 'BSD 3-Clause License\n\nCopyright (c) 2024, Unitree Robotics\n';