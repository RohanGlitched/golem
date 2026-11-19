// Physical core count (Node only). MuJoCo trials are compute-bound, so the second hardware thread of a
// core adds little (audit: 1 -> 8 workers gave x3.2 trials/s); the default pool uses one worker per core.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { platform } from 'node:os';

/** Distinct (physical id, core id) pairs in /proc/cpuinfo; undefined when the file has no core ids. */
export function parseCpuinfoCores(text: string): number | undefined {
  const pairs = new Set<string>();
  for (const block of text.split(/\n\s*\n/)) {
    const phys = /^physical id\s*:\s*(\d+)/m.exec(block)?.[1] ?? '0';
    const core = /^core id\s*:\s*(\d+)/m.exec(block)?.[1];
    if (core !== undefined) pairs.add(`${phys}:${core}`);
  }
  return pairs.size > 0 ? pairs.size : undefined;
}

/** A positive integer printed by `sysctl` or PowerShell, else undefined. */
export function parseCount(out: string): number | undefined {
  const t = out.trim();
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 1 ? n : undefined;
}

function probe(): number | undefined {
  try {
    switch (platform()) {
      case 'linux':
        return parseCpuinfoCores(readFileSync('/proc/cpuinfo', 'utf8'));
      case 'darwin':
        return parseCount(execFileSync('sysctl', ['-n', 'hw.physicalcpu'], { encoding: 'utf8', timeout: 5000 }));
      case 'win32':
        return parseCount(execFileSync('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-Command',
          '(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum',
        ], { encoding: 'utf8', timeout: 5000, windowsHide: true }));
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

let cached: { n: number | undefined } | undefined;

/** Physical cores of this machine, probed once and cached; undefined when the probe fails. */
export function physicalCoreCount(): number | undefined {
  cached ??= { n: probe() };
  return cached.n;
}
