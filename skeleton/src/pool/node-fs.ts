// Node implementation of the injected FileSystem (exported from golem-spec/node only, never from golem-spec).
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { FileSystem } from '../falsify/fs.js';

export function nodeFileSystem(): FileSystem {
  return {
    readFile: (path) => readFile(path, 'utf8'),
    writeFile: (path, data) => writeFile(path, data, 'utf8'),
    rename: (from, to) => rename(from, to),
    mkdir: async (path, opts) => { await mkdir(path, opts); },
    remove: (path) => rm(path, { force: true }),
  };
}
