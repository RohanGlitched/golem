// Writes a RobotApp's files into the MuJoCo virtual file system with FS.mkdirTree + FS.writeFile.
// Never MjVFS.addBuffer: it is about 600x slower for MB-sized meshes.
import { SimError, errorMessage } from './errors.js';
import type { Mj, RobotApp } from './types.js';

type AppRef = Pick<RobotApp, 'id' | 'sceneFile'>;

function invalidReason(path: string): string | undefined {
  if (path === '') return 'is empty';
  if (path.startsWith('/')) return 'is absolute';
  if (/^[A-Za-z]:/.test(path)) return 'starts with a drive letter';
  if (path.includes('\\')) return 'contains a backslash';
  for (const seg of path.split('/')) {
    if (seg === '') return 'contains an empty segment';
    if (seg === '..') return 'contains a ".." segment';
  }
  return undefined;
}

/** Checks every path and the scene file. Throws before anything is written. */
export function validateRobotPaths(app: AppRef, files: Record<string, Uint8Array>): void {
  const keys = Object.keys(files);
  for (const path of keys) {
    const why = invalidReason(path);
    if (why) throw new SimError(`Invalid file path "${path}" for app ${app.id}: path ${why}`);
  }
  if (keys.length === 0) {
    throw new SimError(`App ${app.id} has no files; scene file "${app.sceneFile}" is missing`);
  }
  if (!Object.prototype.hasOwnProperty.call(files, app.sceneFile)) {
    throw new SimError(`Scene file "${app.sceneFile}" of app ${app.id} is missing from its files`);
  }
}

export function writeRobotFiles(
  mj: Mj,
  app: AppRef,
  files: Record<string, Uint8Array>,
  root = '/robot',
): string[] {
  validateRobotPaths(app, files);
  const fs = mj.FS;
  const written: string[] = [];
  for (const path of Object.keys(files)) {
    const full = `${root}/${path}`;
    try {
      const slash = full.lastIndexOf('/');
      fs.mkdirTree(full.slice(0, slash), 0o777);
      fs.writeFile(full, files[path] as Uint8Array);
      written.push(full);
    } catch (cause) {
      throw new SimError(`Writing ${path} for app ${app.id} failed: ${errorMessage(cause)}`, { cause });
    }
  }
  return written;
}

/**
 * Unlinks files written by writeRobotFiles (golem-sim-hardening defect 11). A compiled model holds its own
 * copy of every mesh, so the in-memory FS copies only double the memory of the worker. Errors are ignored.
 */
export function unlinkRobotFiles(mj: Mj, paths: readonly string[]): void {
  const fs = mj.FS as { unlink?: (p: string) => void };
  if (typeof fs.unlink !== 'function') return;
  for (const p of paths) {
    try { fs.unlink(p); } catch { /* already gone */ }
  }
}
