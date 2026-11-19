// Loads the guard script (a plain .mjs with no type declarations) and runs it as a child process.
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const GUARD_PATH = fileURLToPath(new URL('../../kiro-pack/hooks/golem-guard-requirements.mjs', import.meta.url));

export interface Guard {
  decide(stdin: string): { code: 0 | 2; stderr?: string };
  normalise(p: string): string;
  isRequirementsPath(p: string): boolean;
  targetsOf(payload: unknown): string[];
  BLOCK_MESSAGE: string;
}

export const loadGuard = async (): Promise<Guard> => (await import(/* @vite-ignore */ pathToFileURL(GUARD_PATH).href)) as Guard;

export function runGuard(stdin: string, env: Record<string, string>): Promise<{ code: number | null; stderr: string; ms: number }> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [GUARD_PATH], { env, stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr, ms: performance.now() - t0 }));
    child.stdin.end(stdin);
  });
}
