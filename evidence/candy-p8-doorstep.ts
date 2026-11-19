// Proposal P8 measurement: the v1 candy controller against a hand that enters from the doorstep half.
//
//   node ../node_modules/vite-node/vite-node.mjs --config vite.config.ts candy-p8-doorstep.ts   (from evidence/)
//
// It runs the real Episode_Runner on the real compiled line 1.1 with an instrumented copy of the candy app. The copy is
// the same app plus two extra signals in the trace: the link that is closest to the hand, and the tip-to-hand
// separation that SSM_v1 reads. Two sweeps, both at a hand speed of 0.8 m/s:
//   grid:   the two ends and the middle of the doorstep arc x three heights x three entry times x four seeds
//   random: 120 draws of (hand.angle, hand.entry, hand.height, seed) from mulberry32(12345)
// Raw results go to results/candy-p8-doorstep.jsonl, one line per trial and a last line with the summary.
import { mkdirSync, writeFileSync } from 'node:fs';
import { ModelCache, compileRequirement, mulberry32, runTrial } from 'golem-spec';
import candy from '../apps/candy/app';
import { DISTMAX, SSM } from '../apps/candy/constants';
import { candyIds } from '../apps/candy/controller/ids';
import { separation } from '../apps/candy/controller/ssm';
import { doorstepAzimuth } from '../apps/candy/geometry';
import { lexicon } from '../apps/candy/lexicon';
import { writeSignals } from '../apps/candy/signals';

const LINE = 'R1. WHEN a hand reaches in from any direction at up to 1.5 m/s THE arm SHALL keep every link at least 0.10 m from the hand';
const NAMES = ['link0', 'link1', 'link2', 'link3', 'link4', 'link5', 'link6', 'link7', 'cup'];
const SPEED = 0.8;
const LIMIT = 0.10;

const instrumented = {
  ...candy,
  signals(ctx: any, out: Record<string, number>) {
    writeSignals(ctx, out);
    const { mj, model, data } = ctx;
    const ids = candyIds(ctx);
    const geomBody: Int32Array = model.geom_bodyid;
    const buf = new mj.DoubleBuffer(6);
    let min = DISTMAX, link = -1;
    for (let i = 0; i < ids.armGeoms.length; i++) {
      const g = ids.armGeoms[i] as number;
      const b = geomBody[g] as number;
      const li = b === ids.cupBody ? 8 : ids.linkBody.indexOf(b);
      for (const h of [ids.palmGeom, ids.forearmGeom]) {
        const d = mj.mj_geomDistance(model, data, g, h, DISTMAX, buf) as number;
        if (d < min) { min = d; link = li; }
      }
    }
    buf.delete();
    const m = ids.handMocap;
    const mp: Float64Array = data.mocap_pos, mq: Float64Array = data.mocap_quat;
    const hand = [mp[3 * m]!, mp[3 * m + 1]!, mp[3 * m + 2]!, 2 * Math.atan2(mq[4 * m + 3]!, mq[4 * m]!)];
    const sx: Float64Array = data.site_xpos;
    out['closest_link'] = link;
    out['tip_hand_distance'] = separation([sx[3 * ids.tipSite]!, sx[3 * ids.tipSite + 1]!, sx[3 * ids.tipSite + 2]!], hand);
  },
};

interface Row {
  kind: 'grid' | 'random'; angle: number; azimuthDeg: number; entry: number; height: number; seed: number; speed: number;
  minDistance: number; link: string; tipDistance: number; at: number;
  /** Smallest link-hand distance while the tip was at least 0.40 m away (SSM_v1 not yet slowing) and the hand was in play. */
  minDistanceWhileTipFar: number | null; linkWhileTipFar: string | null;
  broken: boolean;
}

async function trial(cache: ModelCache, kind: Row['kind'], angle: number, entry: number, height: number, seed: number): Promise<Row> {
  const req = compileRequirement(LINE, lexicon).requirement!;
  let trace: any;
  await runTrial(instrumented as never, req, {
    app: 'candy', reqId: 'R1', seed, scenario: { 'hand.angle': angle, 'hand.speed': SPEED, 'hand.entry': entry, 'hand.height': height },
  }, { cache, earlyStop: (tr: any) => { trace = tr; return undefined; } });
  const d: Float64Array = trace.signals['min_link_hand_distance'];
  const l: Float64Array = trace.signals['closest_link'];
  const tp: Float64Array = trace.signals['tip_hand_distance'];
  let best = Infinity, bi = 0, far = Infinity, fi = -1;
  for (let i = 0; i < d.length; i++) {
    if (d[i]! < best) { best = d[i]!; bi = i; }
    if (tp[i]! >= SSM.slowdown && d[i]! < DISTMAX && d[i]! < far) { far = d[i]!; fi = i; }
  }
  return {
    kind, angle, azimuthDeg: (doorstepAzimuth(angle) * 180) / Math.PI, entry, height, seed, speed: SPEED,
    minDistance: best, link: NAMES[l[bi]!] ?? '?', tipDistance: tp[bi]!, at: trace.t[bi]!,
    minDistanceWhileTipFar: fi >= 0 ? far : null, linkWhileTipFar: fi >= 0 ? (NAMES[l[fi]!] ?? '?') : null,
    broken: best < LIMIT,
  };
}

const cache = new ModelCache();
const rows: Row[] = [];
for (const a of [0, Math.PI / 2, Math.PI]) for (const h of [0.05, 0.15, 0.25]) for (const e of [0, 1.5, 3]) for (const seed of [1, 2, 3, 4]) {
  rows.push(await trial(cache, 'grid', a, e, h, seed));
}
const rnd = mulberry32(12345);
for (let n = 0; n < 120; n++) {
  const a = rnd() * 2 * Math.PI, e = rnd() * 3, h = 0.05 + 0.2 * rnd(), seed = 1 + Math.floor(rnd() * 1000);
  rows.push(await trial(cache, 'random', a, e, h, seed));
}
cache.dispose();

const summarise = (rs: Row[]) => {
  const broken = rs.filter((r) => r.broken);
  const byLink: Record<string, number> = {};
  for (const r of broken) byLink[r.link] = (byLink[r.link] ?? 0) + 1;
  const worst = rs.reduce((p, c) => (c.minDistance < p.minDistance ? c : p));
  const far = rs.filter((r) => r.minDistanceWhileTipFar !== null);
  const farWorst = far.length > 0 ? far.reduce((p, c) => (c.minDistanceWhileTipFar! < p.minDistanceWhileTipFar! ? c : p)) : null;
  return {
    trials: rs.length, broken: broken.length, brokenByLink: byLink,
    brokenTipDistance: broken.length > 0 ? { min: Math.min(...broken.map((r) => r.tipDistance)), max: Math.max(...broken.map((r) => r.tipDistance)) } : null,
    worst, worstWhileTipFar: farWorst,
  };
};
const summary = { limit: LIMIT, speed: SPEED, grid: summarise(rows.filter((r) => r.kind === 'grid')), random: summarise(rows.filter((r) => r.kind === 'random')), all: summarise(rows) };
mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(new URL('./results/candy-p8-doorstep.jsonl', import.meta.url), [...rows, { summary }].map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify(summary, null, 1));
