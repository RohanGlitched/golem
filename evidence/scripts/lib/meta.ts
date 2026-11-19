import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
export const evidenceDir = `${repoRoot}/evidence`;
export const defaultResultsDir = `${evidenceDir}/results`;

export function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function gitDirty(): boolean {
  try {
    return execFileSync('git', ['status', '--porcelain', '--', 'skeleton/src', 'apps'], { cwd: repoRoot, encoding: 'utf8' }).trim() !== '';
  } catch {
    return false;
  }
}