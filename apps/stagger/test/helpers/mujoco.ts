// Loads @mujoco/mujoco once per test file and compiles the committed robot folder.
import load from '@mujoco/mujoco';
import { readFileSync, readdirSync } from 'node:fs';

let mjp: Promise<any> | undefined;
export function getMj(): Promise<any> { return (mjp ??= load()); }

export function robotFiles(): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const root = new URL('../../robot/', import.meta.url);
  for (const f of readdirSync(root)) if (f.endsWith('.xml')) out[f] = readFileSync(new URL(f, root));
  for (const f of readdirSync(new URL('meshes/', root))) out[`meshes/${f}`] = readFileSync(new URL(`meshes/${f}`, root));
  return out;
}

export async function compileRobot(): Promise<{ mj: any; model: any }> {
  const mj = await getMj();
  mj.FS.mkdirTree('/robot/meshes');
  for (const [p, b] of Object.entries(robotFiles())) mj.FS.writeFile(`/robot/${p}`, b);
  return { mj, model: mj.MjModel.from_xml_path('/robot/scene.xml') };
}