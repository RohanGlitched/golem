// Trace to CSV. Numbers are written as the shortest decimal string that parses back to the same value.
import type { Trace } from './sibling-types.js';

/** Shortest round-trip decimal (`String`), with `-0` kept for negative zero. */
export function formatNumber(x: number): string {
  if (Object.is(x, -0)) return '-0';
  return String(x);
}

/** Header `t` then the signals in key order; one row per sample; `\n` line ends. */
export function traceToCsv(trace: Trace): string {
  const names = Object.keys(trace.signals);
  const lines = [['t', ...names].join(',')];
  const n = trace.t.length;
  const cols = names.map((k) => trace.signals[k] as Float64Array);
  for (let i = 0; i < n; i++) {
    const row = [formatNumber(trace.t[i] as number)];
    for (const c of cols) row.push(formatNumber(c[i] as number));
    lines.push(row.join(','));
  }
  return `${lines.join('\n')}\n`;
}
