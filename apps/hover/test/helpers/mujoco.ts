// Loads @mujoco/mujoco once per test file and compiles the committed robot folder.
import load from '@mujoco/mujoco';
import { readFileSync, readdirSync, statSync } from 'node:fs';

let mjp: Promise<any> | undefined;
export function getMj(): Promise<any> { return (mjp ??= load()); }

const ROOT = new URL('../../robot/', import.meta.url);

/** Every file under robot/, keyed by its path below robot/. */
export function robotFiles(): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const walk = (rel: string): void => {
    for (const f of readdirSync(new URL(rel, ROOT))) {
      const p = rel === '' ? f : `${rel}${f}`;
      if (statSync(new URL(p, ROOT)).isDirectory()) walk(`${p}/`);
      else out[p] = readFileSync(new URL(p, ROOT));
    }
  };
  walk('');
  return out;
}

export function writeRobot(mj: any, files: Record<string, Uint8Array>): void {
  for (const [p, b] of Object.entries(files)) {
    mj.FS.mkdirTree(p.includes('/') ? `/robot/${p.slice(0, p.lastIndexOf('/'))}` : '/robot');
    mj.FS.writeFile(`/robot/${p}`, b);
  }
}

export async function compileRobot(): Promise<{ mj: any; model: any }> {
  const mj = await getMj();
  writeRobot(mj, robotFiles());
  return { mj, model: mj.MjModel.from_xml_path('/robot/scene.xml') };
}

/** Compiles an inline MJCF (for fixtures). */
export async function compileXml(xml: string, path = '/fixture.xml'): Promise<{ mj: any; model: any }> {
  const mj = await getMj();
  mj.FS.writeFile(path, xml);
  return { mj, model: mj.MjModel.from_xml_path(path) };
}
