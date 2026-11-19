// Search-efficiency benchmark (golem-falsify-hardening item E). Run from skeleton/: npx tsx ../docs/reviews/falsify-bench.mts [runs]
// For each case and mode: found / runs with a two-sided 95% Clopper-Pearson interval, and the median
// foundAfter (trials until the first failing trial; "-" when fewer than half the runs found it).
import { falsify } from '../../skeleton/src/falsify/index.ts';
import { clopperPearsonUpper } from '../../skeleton/src/falsify/beta.ts';
import { directPool, syntheticTrialFn } from '../../skeleton/src/falsify/testing.ts';
import type { Scenario, ScenarioSpace } from '../../skeleton/src/falsify/contract.ts';

const RUNS = Number(process.argv[2] ?? 100);
const angOut = (a: number, lo: number, hi: number): number => Math.abs((((a - (lo + hi) / 2) % 360) + 540) % 360 - 180) - (hi - lo) / 2;
function needle(lo: number, hi: number, fmin: number, flat: boolean, extra = 0) {
  return (s: Scenario): number => {
    let r = Math.max(angOut(s['angle']!, lo, hi) / 360, (fmin - s['force']!) / 250);
    for (let i = 0; i < extra; i++) r = Math.max(r, Math.abs(s[`x${i}`]! - 0.5) - 0.35);
    return flat ? (r < 0 ? -0.01 : 1) : r;
  };
}
const space = (extra = 0): ScenarioSpace => ({ dims: [
  { name: 'force', kind: 'force', min: 0, max: 250, severity: 'up' },
  { name: 'angle', kind: 'angle', min: 0, max: 360, severity: 'none', wrap: true },
  ...Array.from({ length: extra }, (_, i) => ({ name: `x${i}`, kind: 'ratio' as const, min: 0, max: 1, severity: 'none' as const })),
] });

const cases = [
  { name: 'graded 0.11% (130-135 deg, >230 N)', fn: needle(130, 135, 230, false), sp: space(), T: 400 },
  { name: 'graded 0.11%', fn: needle(130, 135, 230, false), sp: space(), T: 1000 },
  { name: 'flat 0.11%', fn: needle(130, 135, 230, true), sp: space(), T: 1000 },
  { name: 'graded 0.78% (130-140 deg, >180 N)', fn: needle(130, 140, 180, false), sp: space(), T: 200 },
  { name: 'flat 0.78%', fn: needle(130, 140, 180, true), sp: space(), T: 400 },
  { name: '0.78% + 4 extra dims (0.19%)', fn: needle(130, 140, 180, false, 4), sp: space(4), T: 1000 },
  { name: 'wrap 355-5 deg, >230 N (0.22%)', fn: needle(355, 365, 230, false), sp: space(), T: 400 },
];
const modes = [
  { label: 'random-only', opts: { mode: 'random-only' as const } },
  { label: 'full f1=0.4', opts: { mode: 'full' as const, phase1Fraction: 0.4 } },
  { label: 'full f1=0.2', opts: { mode: 'full' as const, phase1Fraction: 0.2 } },
];
const ci = (k: number, n: number): [number, number] => [k === 0 ? 0 : 1 - clopperPearsonUpper(n, n - k, 0.975), k === n ? 1 : clopperPearsonUpper(n, k, 0.975)];
const median = (xs: number[]): number => { const a = [...xs].sort((x, y) => x - y); const n = a.length; return n % 2 ? a[(n - 1) / 2]! : (a[n / 2 - 1]! + a[n / 2]!) / 2; };
const pct = (x: number): string => `${(100 * x).toFixed(0)}%`;

console.log(`| Case | Budget | Mode | Found / ${RUNS} | 95% CI | Median foundAfter |`);
console.log('|---|---|---|---|---|---|');
for (const c of cases) {
  for (const m of modes) {
    const fa: number[] = [];
    let found = 0;
    for (let i = 1; i <= RUNS; i++) {
      const r = await falsify({ id: 'R1', space: c.sp }, directPool(syntheticTrialFn(c.fn, 'u')), {
        appId: 'bench', budget: { maxTrials: c.T }, searchSeed: (i * 7919) >>> 0, ...m.opts,
        shrink: { maxTrials: 1, reserveMin: 0, reserveFraction: 0 },
      });
      if (r.verdict.status === 'broken') { found++; fa.push(r.verdict.counterexample!.foundAfter); } else fa.push(Infinity);
    }
    const [lo, hi] = ci(found, RUNS);
    const med = median(fa);
    console.log(`| ${c.name} | ${c.T} | ${m.label} | ${found} | ${pct(lo)}–${pct(hi)} | ${Number.isFinite(med) ? med : '-'} |`);
  }
}
