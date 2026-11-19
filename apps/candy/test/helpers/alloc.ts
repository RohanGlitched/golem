// Allocation probe: counts V8 garbage collections during a loop. A loop that allocates nothing triggers none.
import v8 from 'node:v8';
import vm from 'node:vm';
import { PerformanceObserver } from 'node:perf_hooks';

v8.setFlagsFromString('--expose-gc');
const gc: () => void = vm.runInNewContext('gc');

export async function gcCount(iterations: number, fn: (i: number) => void): Promise<number> {
  for (let i = 0; i < 50000; i++) fn(i);   // warm up the JIT and any lazy caches
  gc();
  let n = 0;
  let t0 = 0;
  let t1 = Infinity;
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.startTime >= t0 && e.startTime <= t1) n++;
  });
  obs.observe({ entryTypes: ['gc'] });
  t0 = performance.now();
  for (let i = 0; i < iterations; i++) fn(i);
  t1 = performance.now();
  await new Promise((r) => setTimeout(r, 50));
  obs.disconnect();
  return n;
}

/** Bytes of heap that survive a forced GC after the loop (leaks, not garbage). */
export function retained(iterations: number, fn: (i: number) => void): number {
  gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < iterations; i++) fn(i);
  gc();
  return process.memoryUsage().heapUsed - before;
}
