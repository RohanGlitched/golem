// A fake `kiro-cli` that works on real files in a temp directory, for the build script tests.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunResult } from '../../scripts/build-pack.js';
import { fakeUpgrade } from './test-deps.js';

export interface DiskKiro {
  run: (cmd: string, args: readonly string[]) => Promise<RunResult | 'missing'>;
  calls: string[][];
  missing: boolean;
  failNext(kind: 'upgrade' | 'validate', code: number, stderr: string): void;
}

export function createDiskKiro(): DiskKiro {
  const fails: { kind: string; code: number; stderr: string }[] = [];
  const k: DiskKiro = {
    calls: [], missing: false,
    failNext: (kind, code, stderr) => { fails.push({ kind, code, stderr }); },
    async run(cmd, args) {
      k.calls.push([cmd, ...args]);
      if (k.missing) return 'missing';
      const action = args[1];
      const i = fails.findIndex((f) => f.kind === action);
      if (i >= 0) { const [f] = fails.splice(i, 1); const x = f as (typeof fails)[number]; return { code: x.code, stdout: '', stderr: x.stderr }; }
      if (action === 'upgrade') {
        const dir = args[2] as string;
        for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
          const text = readFileSync(join(dir, f), 'utf8');
          if (text.charCodeAt(0) === 0xfeff) return { code: 1, stdout: '', stderr: `${f}: Invalid JSON: expected value at line 1 column 1` };
          const j = JSON.parse(text) as Record<string, unknown>;
          if (j['permissions'] !== undefined) continue;
          writeFileSync(join(dir, f), `${JSON.stringify(fakeUpgrade(j), null, 2)}\n`);
        }
        return { code: 0, stdout: '', stderr: '' };
      }
      if (action === 'validate') {
        const p = args[args.indexOf('--path') + 1] as string;
        const j = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
        return j['permissions'] === undefined ? { code: 1, stdout: '', stderr: 'no permissions' } : { code: 0, stdout: '', stderr: '' };
      }
      return { code: 2, stdout: '', stderr: 'unknown' };
    },
  };
  return k;
}
