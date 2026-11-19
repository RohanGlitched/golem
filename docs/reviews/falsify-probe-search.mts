// Probes 1-3: needle search CEM vs random-only, wrap-around, shrink accuracy.
import { falsify } from '../../skeleton/src/falsify/index.ts';
import { InProcessPool } from '../../skeleton/src/pool/in-process.ts';
import type { Scenario, TrialSpec } from '../../skeleton/src/falsify/contract.ts';

type Fn = (s: Scenario, seed: number) => number;
const angDist = (a: number, lo: number, hi: number): number => {
  // signed circular distance (degrees) outside [lo,hi] (negative inside), circle 360
  const mid = (lo + hi) / 2; const half = (hi - lo) / 2;
  let d = Math.abs(((a - mid) % 360 + 540) % 360 - 180);
  return d - half;
};
function needle(lo: number, hi: number, fth: number, flat: boolean, extra = 0): Fn {
  return (s) => {
    const dA = angDist(s['angle']!, lo, hi) / 360;
    const dF = (fth - s['force']!) / 250;
    let r = Math.max(dA, dF);
    for (let i = 0; i < extra; i++) r = Math.max(r, Math.abs(s[`x${i}`]! - 0.5) - 0.35); // irrelevant-ish: needs |x-0.5|<0.35
    return flat ? (r < 0 ? -0.01 : 1) : r;
  };
}
function space(extra = 0) {
  return { dims: [
    { name: 'force', kind: 'force' as const, min: 0, max: 250, severity: 'up' as const },
    { name: 'angle', kind: 'angle' as const, min: 0, max: 360, severity: 'none' as const, wrap: true },
    ...Array.from({ length: extra }, (_, i) => ({ name: `x${i}`, kind: 'ratio' as const, min: 0, max: 1, severity: 'none' as const })),
  ] };
}
const pool = (fn: Fn) => new InProcessPool((spec: TrialSpec) => ({ spec, robustness: fn(spec.scenario, spec.seed), worstAt: 0, unit: 'u', wallMs: 0 }), { yieldEvery: 100000 });
const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const n = a.length; return n % 2 ? a[(n - 1) / 2]! : (a[n / 2 - 1]! + a[n / 2]!) / 2; };

async function campaign(label: string, fn: Fn, sp: ReturnType<typeof space>, T: number, extra: object = {}) {
  for (const mode of ['random-only', 'full'] as const) {
    const fa: number[] = []; let found = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = await falsify({ id: 'R1', space: sp }, pool(fn), { appId: 'a', budget: { maxTrials: T }, searchSeed: seed * 7919, mode, ...extra });
      if (r.verdict.status === 'broken') { found++; fa.push(r.verdict.counterexample!.foundAfter); } else fa.push(Infinity);
    }
    console.log(`${label} T=${T} ${mode.padEnd(11)} found ${found}/30 median foundAfter=${med(fa)}`);
  }
}

// (1) needle
console.log('--- (1) needle: angle [130,140], force>180 (p=0.78%)');
await campaign('graded', needle(130, 140, 180, false), space(), 200);
await campaign('graded', needle(130, 140, 180, false), space(), 400);
await campaign('flat  ', needle(130, 140, 180, true), space(), 400);
console.log('--- (1b) harder needle: angle [130,135], force>230 (p=0.11%)');
await campaign('graded', needle(130, 135, 230, false), space(), 400);
await campaign('graded', needle(130, 135, 230, false), space(), 1000);
await campaign('flat  ', needle(130, 135, 230, true), space(), 1000);
console.log('--- (1c) needle + 4 extra dims each needing |x-.5|<.35 (p=0.78%*0.24)');
await campaign('graded', needle(130, 140, 180, false, 4), space(4), 1000);
console.log('--- (1d) phase1Fraction 0.2 / cem gen 32');
await campaign('graded f1=.2', needle(130, 135, 230, false), space(), 400, { phase1Fraction: 0.2 });
await campaign('graded g=32', needle(130, 135, 230, false), space(), 400, { cem: { generationSize: 32 } });
await campaign('graded a=.7', needle(130, 135, 230, false), space(), 400, { cem: { smoothing: 0.7 } });

// (2) wrap
console.log('--- (2) wrap: angle [355,5] (10 deg across 0), force>230');
await campaign('wrap   ', needle(355, 365, 230, false), space(), 400);
await campaign('control', needle(175, 185, 230, false), space(), 400);
{
  // inspect CEM distribution near 0 for the wrap case without a failure: make it unfindable (force>250) but graded
  const fn = needle(355, 365, 260, false);
  const last: number[] = [];
  await falsify({ id: 'R1', space: space() }, pool(fn), { appId: 'a', budget: { maxTrials: 400 }, searchSeed: 42, onProgress: (e) => { if (e.phase === 2) { last.length = 0; last.push(...e.scenarios.map((s) => s['angle']!)); } } });
  const near = last.filter((a) => a > 340 || a < 20).length;
  console.log(`wrap: last CEM gen angles within 20deg of 0: ${near}/${last.length}; sample: ${last.slice(0, 8).map((a) => a.toFixed(1)).join(', ')}`);
}

// (3) shrink accuracy
console.log('--- (3) shrink: fails iff force>180 (any angle); tolerance 1% of 250 = 2.5');
{
  let worst = 0, over = 0, moreSevere = 0, n = 0, tr: number[] = [];
  for (let seed = 1; seed <= 30; seed++) {
    const fn: Fn = (s) => (180 - s['force']!) / 250;
    let first: Scenario | undefined;
    const r = await falsify({ id: 'R1', space: space() }, pool(fn), { appId: 'a', budget: { maxTrials: 200 }, searchSeed: seed, mode: 'random-only' });
    const cx = r.verdict.counterexample!; n++;
    const f = cx.scenario['force']!;
    const err = f - 180; worst = Math.max(worst, err); if (err > 2.5 || err < 0) over++;
    tr.push(r.meta.p3Detail.shrink);
    void first; void moreSevere;
  }
  console.log(`halfspace: max(force-180)=${worst.toFixed(3)}, outside [0,2.5]: ${over}/${n}, shrink trials median ${med(tr)}`);
  // non-monotone: fails for force in [100,120] or force>200
  let landed: string[] = [];
  for (let seed = 1; seed <= 10; seed++) {
    const fn: Fn = (s) => { const f = s['force']!; return Math.min(Math.max(100 - f, f - 120), 200 - f) / 250; };
    const r = await falsify({ id: 'R1', space: space() }, pool(fn), { appId: 'a', budget: { maxTrials: 200 }, searchSeed: seed, mode: 'random-only' });
    landed.push(r.verdict.counterexample!.scenario['force']!.toFixed(1));
  }
  console.log(`non-monotone (fail [100,120] or >200): shrunk forces ${landed.join(', ')} (mildest true = 100)`);
  // two severity dims with interaction: fails iff force*mass > 9000 (force [0,250], mass [0,100] up)
  const sp2 = { dims: [
    { name: 'force', kind: 'force' as const, min: 0, max: 250, severity: 'up' as const },
    { name: 'mass', kind: 'mass' as const, min: 0, max: 100, severity: 'up' as const },
  ] };
  const res: string[] = [];
  for (let seed = 1; seed <= 6; seed++) {
    const fn: Fn = (s) => (9000 - s['force']! * s['mass']!) / 25000;
    const r = await falsify({ id: 'R1', space: sp2 }, pool(fn), { appId: 'a', budget: { maxTrials: 200 }, searchSeed: seed, mode: 'random-only' });
    const c = r.verdict.counterexample!.scenario; res.push(`(${c['force']!.toFixed(1)},${c['mass']!.toFixed(1)} p=${(c['force']! * c['mass']!).toFixed(0)} r=${r.verdict.counterexample!.robustness.toFixed(4)})`);
  }
  console.log(`interaction f*m>9000: ${res.join(' ')}`);
}
