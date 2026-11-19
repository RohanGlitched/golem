// The only file-system touch of the falsifier is this injected interface (no node: imports here).

export interface FileSystem {
  /** Throws an error with code 'ENOENT' when the file is missing. */
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string, opts: { recursive: true }): Promise<void>;
  /** Ignores a missing file. */
  remove(path: string): Promise<void>;
}

export type FsMethod = 'readFile' | 'writeFile' | 'rename' | 'mkdir' | 'remove';

export interface FsCall { method: FsMethod; args: string[] }

export interface MemoryFileSystem extends FileSystem {
  readonly files: Map<string, string>;
  readonly log: FsCall[];
  /** Fails the `nth` (1-based, counted from now) call of `method` with `error`. */
  failOn(method: FsMethod, nth: number, error?: Error): void;
  /** Number of calls of the given kinds so far. */
  count(...methods: FsMethod[]): number;
}

export function enoent(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' });
}

export function memoryFileSystem(initial: Record<string, string> = {}): MemoryFileSystem {
  const files = new Map<string, string>(Object.entries(initial));
  const log: FsCall[] = [];
  const faults: { method: FsMethod; remaining: number; error: Error }[] = [];

  const enter = (method: FsMethod, ...args: string[]): void => {
    log.push({ method, args });
    for (let i = 0; i < faults.length; i++) {
      const f = faults[i] as (typeof faults)[number];
      if (f.method !== method) continue;
      f.remaining -= 1;
      if (f.remaining === 0) {
        faults.splice(i, 1);
        throw f.error;
      }
    }
  };

  return {
    files,
    log,
    failOn(method, nth, error = new Error(`injected ${method} failure`)) {
      faults.push({ method, remaining: nth, error });
    },
    count(...methods) {
      return log.filter((c) => methods.includes(c.method)).length;
    },
    async readFile(path) {
      enter('readFile', path);
      const v = files.get(path);
      if (v === undefined) throw enoent(path);
      return v;
    },
    async writeFile(path, data) {
      enter('writeFile', path);
      files.set(path, data);
    },
    async rename(from, to) {
      enter('rename', from, to);
      const v = files.get(from);
      if (v === undefined) throw enoent(from);
      files.delete(from);
      files.set(to, v);
    },
    async mkdir(path) {
      enter('mkdir', path);
    },
    async remove(path) {
      enter('remove', path);
      files.delete(path);
    },
  };
}
