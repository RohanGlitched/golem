import { availableParallelism } from 'node:os';
import { describe, expect, it } from 'vitest';
import { parseCpuinfoCores, parseCount, physicalCoreCount } from './cores.js';
import { defaultNodePoolSize } from './node.js';

// golem-falsify-hardening defect 8: size the Node pool by physical cores, not logical cores minus one.
const cpuinfo = (pairs: [number, number][]): string =>
  pairs.map(([p, c], i) => `processor\t: ${i}\nphysical id\t: ${p}\ncore id\t\t: ${c}\nmodel name\t: X\n`).join('\n');

describe('physical cores', () => {
  it('counts distinct (physical id, core id) pairs in /proc/cpuinfo', () => {
    // 2 sockets x 4 cores x 2 threads
    const pairs: [number, number][] = [];
    for (const p of [0, 1]) for (const c of [0, 1, 2, 3]) pairs.push([p, c], [p, c]);
    expect(parseCpuinfoCores(cpuinfo(pairs))).toBe(8);
    expect(parseCpuinfoCores(cpuinfo([[0, 0], [0, 1], [0, 2]]))).toBe(3);
  });
  it('returns undefined for cpuinfo without core ids (some ARM and VM kernels)', () => {
    expect(parseCpuinfoCores('processor\t: 0\nprocessor\t: 1\n')).toBeUndefined();
  });
  it('parses a positive integer from sysctl or PowerShell output and rejects anything else', () => {
    expect(parseCount('6\r\n')).toBe(6);
    expect(parseCount(' 12 ')).toBe(12);
    expect(parseCount('')).toBeUndefined();
    expect(parseCount('0')).toBeUndefined();
    expect(parseCount('n/a')).toBeUndefined();
  });
  it('sizes the default Node pool by the physical core count of this machine', () => {
    const n = physicalCoreCount();
    if (n !== undefined) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(availableParallelism());
      expect(defaultNodePoolSize()).toBe(n);
    } else {
      expect(defaultNodePoolSize()).toBe(Math.max(1, availableParallelism() - 1));
    }
    expect(physicalCoreCount()).toBe(n); // cached
  }, 20000);
});
