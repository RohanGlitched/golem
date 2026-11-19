// Probes 4-6 and 8: classification under noise, Clopper-Pearson vs exact binomial, budgets, abort, progress.
const R = 'file:///I:/Programs/ListofHackathon/hackathons/39-kiroween/golem-wt-earsfix/skeleton/src';
const { falsify, clopperPearsonUpper, failureRateUpper95 } = await import(`${R}/falsify/index.ts`);
const { InProcessPool } = await import(`${R}/pool/in-process.ts`);
const { fmix32 } = await import(`${R}/falsify/prng.ts`);

type Sc = Record<string, number>;
const space = { dims: [
  { name: 'force', kind: 'force', min: 0, max: 250, severity: 'up' },
  { name: 'angle', kind: 'angle', min: 0, max: 360, severity: 'none', wrap: true },
] };
// deterministic standard-normal noise from the seed
const gauss = (seed: number) => { const u1 = (fmix32(seed) + 0.5) / 4294967296; const u2 = (fmix32(seed ^ 0x5bd1e995) + 0.5) / 4294967296; return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); };
const mk = (fn: (s: Sc, seed: number) => number, delayMs = 0) => new InProcessPool((spec: any) => {
  if (delayMs) { const t = performance.now(); while (performance.now() - t < delayMs) { /* spin */ } }
  return { spec, robustness: fn(spec.scenario, spec.seed), worstAt: 0, unit: 'u', wallMs: delayMs };
});

// (4) classification
console.log('--- (4) classification');
for (const [label, sd] of [['noise sd 0.02', 0.02], ['noise sd 0.05', 0.05]] as const) {
  const fn = (s: Sc, seed: number) => (150 - s['force']!) / 250 + sd * gauss(seed); // deep failures at force 250 have base -0.4 = 8-20 sd
  const counts: Record<string, number> = {}; let deepRobust = 0;
  for (let k = 1; k <= 30; k++) {
    const r = await falsify({ id: 'R1', space }, mk(fn), { appId: 'a', budget: { maxTrials: 200 }, searchSeed: k });
    counts[r.meta.classification ?? 'none'] = (counts[r.meta.classification ?? 'none'] ?? 0) + 1;
    // what would verification at the ORIGINAL (unshrunk) failing point say?
    void deepRobust;
  }
  console.log(`${label}: failure is robust in the interior (base margin to -0.4); classifications at shrunk point: ${JSON.stringify(counts)}`);
}
{
  // genuinely seed-sensitive: fails only when noise is strongly negative (about 10% of seeds) anywhere force>200
  const fn = (s: Sc, seed: number) => (s['force']! > 200 ? 0.05 + 0.04 * gauss(seed) : 1);
  const counts: Record<string, number> = {};
  for (let k = 1; k <= 30; k++) {
    const r = await falsify({ id: 'R1', space }, mk(fn), { appId: 'a', budget: { maxTrials: 400 }, searchSeed: k });
    const c = r.meta.classification ?? (r.verdict.status === 'held' ? 'held' : 'none');
    counts[c] = (counts[c] ?? 0) + 1;
  }
  console.log(`seed-sensitive truth (P(fail|force>200)~11%): ${JSON.stringify(counts)}`);
}

// (5) Clopper-Pearson vs exact binomial inversion
console.log('--- (5) Clopper-Pearson');
const lchoose = (n: number, k: number) => { let s = 0; for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i); return s; };
const binomCdf = (k: number, n: number, p: number) => { let s = 0; for (let i = 0; i <= k; i++) s += Math.exp(lchoose(n, i) + i * Math.log(p) + (n - i) * Math.log1p(-p)); return s; };
const exactUpper = (n: number, k: number) => { let lo = 0, hi = 1; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (binomCdf(k, n, m) > 0.05) lo = m; else hi = m; } return (lo + hi) / 2; };
let maxRel = 0;
for (const [n, k] of [[59, 0], [100, 0], [30, 0], [10, 0], [100, 1], [100, 5], [1000, 3], [20, 10], [5000, 2], [12, 11], [200, 199]] as const) {
  const cp = clopperPearsonUpper(n, k); const ref = exactUpper(n, k); const fr = failureRateUpper95(n, k);
  maxRel = Math.max(maxRel, Math.abs(cp - ref) / ref);
  console.log(`n=${n} k=${k}: clopperPearsonUpper=${cp.toFixed(6)} exact=${ref.toFixed(6)} failureRateUpper95=${fr?.toFixed(6)}`);
}
console.log(`max rel err CP vs exact: ${maxRel.toExponential(2)}`);

// (6) budgets
console.log('--- (6) budgets');
{
  const fn = (s: Sc) => (300 - s['force']!) / 250; // never fails
  const r = await falsify({ id: 'R1', space }, mk(fn, 5), { appId: 'a', budget: { maxWallMs: 300 }, searchSeed: 1 });
  console.log(`held, 5ms trials, maxWallMs 300: ms=${r.verdict.ms.toFixed(0)} trials=${r.verdict.trials} phases=${JSON.stringify(r.meta.phaseTrials)} stop=${r.meta.stopReason}`);
  const r2 = await falsify({ id: 'R1', space }, mk(fn, 5), { appId: 'a', budget: { maxWallMs: 300 }, searchSeed: 1, phase1GenerationSize: 64, cem: { generationSize: 64 } });
  console.log(`held, gen 64: ms=${r2.verdict.ms.toFixed(0)} trials=${r2.verdict.trials} stop=${r2.meta.stopReason}`);
  // failure found late: force>240 fails; wall 300 ms
  const fn3 = (s: Sc) => (240 - s['force']!) / 250;
  const r3 = await falsify({ id: 'R1', space }, mk(fn3, 5), { appId: 'a', budget: { maxWallMs: 300 }, searchSeed: 3 });
  console.log(`broken, wall 300: ms=${r3.verdict.ms.toFixed(0)} trials=${r3.verdict.trials} p3=${JSON.stringify(r3.meta.p3Detail)} foundAfter=${r3.verdict.counterexample?.foundAfter}`);
  // trial cap
  let maxOver = 0;
  for (let k = 1; k <= 40; k++) {
    const T = 10 + k * 7;
    const fn4 = (s: Sc) => (200 - s['force']!) / 250;
    const r4 = await falsify({ id: 'R1', space }, mk(fn4), { appId: 'a', budget: { maxTrials: T }, searchSeed: k });
    const search = r4.meta.phaseTrials.p0 + r4.meta.phaseTrials.p1 + r4.meta.phaseTrials.p2;
    if (search > T) console.log(`!! search trials ${search} > T ${T}`);
    maxOver = Math.max(maxOver, r4.verdict.trials - T);
    if (r4.meta.p3Detail.shrink > (r4.meta.shrinkReserve ?? Infinity)) console.log('!! shrink over reserve');
  }
  console.log(`trial cap: verdict.trials - maxTrials max = ${maxOver} (shrink reserve + 3 verification allowed)`);
  // abort
  const ac = new AbortController();
  let after = 0; let ran = 0;
  const t0 = performance.now();
  setTimeout(() => ac.abort(), 50);
  const p = falsify({ id: 'R1', space }, new InProcessPool((spec: any) => { ran++; if (ac.signal.aborted) after++; const t = performance.now(); while (performance.now() - t < 2); return { spec, robustness: 1, worstAt: 0, unit: 'u', wallMs: 2 }; }), { appId: 'a', budget: { maxTrials: 100000 }, searchSeed: 1, signal: ac.signal });
  try { await p; console.log('abort: resolved?!'); } catch (e: any) { console.log(`abort: rejected ${e.name} after ${(performance.now() - t0).toFixed(0)} ms; trials ran=${ran}, started after abort=${after}`); }
  await new Promise((r) => setTimeout(r, 50));
  console.log(`abort: trials after settle: ${ran}`);
}

// (8) progress events
console.log('--- (8) progress');
{
  const fn = (s: Sc) => (240 - s['force']!) / 250;
  const ev: string[] = []; let results = 0; let firstEventAt = 0; const t0 = performance.now();
  const r = await falsify({ id: 'R1', space }, mk(fn, 1), { appId: 'a', budget: { maxTrials: 300 }, searchSeed: 5, onProgress: (e: any) => { if (!firstEventAt) firstEventAt = performance.now() - t0; ev.push(`p${e.phase}g${e.generation}:${e.scenarios.length}/${e.trialsRemaining}`); }, onResult: () => { results++; } });
  console.log(`events: ${ev.join(' ')}`);
  console.log(`onResult calls=${results}, verdict.trials=${r.verdict.trials}, first event at ${firstEventAt.toFixed(0)} ms (phase-0 event even with no seed DB)`);
}
