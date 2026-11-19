import { buildContext, compileRequirement, lintLexicon } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import { BOWLS, CANDY_HALF_HEIGHT, CANDY_MASS, CANDY_SPAWN, HAND_ENTRY_FALLBACK, HAND_START, UD } from '../constants';
import { CANDY_NAMES, candyIds } from '../controller/ids';
import { lexicon } from '../lexicon';
import {
  candiesLand, candiesWeigh, handReaches, trackerLags, trackerLagsAndHandReaches, vacuumWeakens,
} from '../perturbations';
import { gcCount } from './helpers/alloc';
import { compileRobot } from './helpers/mujoco';

const { mj, model } = await compileRobot();
const data = new mj.MjData(model);
const ctx = buildContext(mj, model, data, CANDY_NAMES as never);
const ids = candyIds(ctx);
afterAll(() => { data.delete(); model.delete(); });

const quantity = (si: number, kind: any, text: string) => ({ kind, si, text });
const mass0 = Float64Array.from({ length: 6 }, (_, i) => model.body_mass[ids.candyBody[i]!]);
const inertia0 = Float64Array.from(model.body_inertia);
const restore = () => {
  for (let i = 0; i < 6; i++) model.body_mass[ids.candyBody[i]!] = mass0[i]!;
  model.body_inertia.set(inertia0);
  const scratch = new mj.MjData(model);
  mj.mj_setConst(model, scratch);
  scratch.delete();
};

describe('defaults', () => {
  it('has candies of 0.020 kg in the scene', () => {
    for (let i = 0; i < 6; i++) expect(mass0[i]).toBeCloseTo(CANDY_MASS, 9);
  });
});

const LINES = {
  hand: 'R1. WHEN a hand reaches in from any direction at up to 1.5 m/s THE arm SHALL keep every link at least 0.10 m from the hand',
  lag: 'R2. WHEN the hand tracker lags by up to 0.3 s and a hand reaches in from any direction at up to 1.5 m/s THE arm SHALL keep every link at least 0.10 m from the hand',
  land: 'R3. WHEN candies land anywhere on the tray THE arm SHALL drop every candy into the bowl of its colour within 45 s',
  weigh: 'R4. WHEN the candies weigh 0.005 kg to 0.060 kg THE arm SHALL drop every candy into the bowl of its colour within 45 s',
  vacuum: 'R5. WHEN the vacuum weakens to 50% to 100% THE arm SHALL not drop a candy outside the bowls',
};
const compile = (line: string) => {
  const r = compileRequirement(line, lexicon);
  expect(r.diagnostics).toEqual([]);
  return r.requirement!;
};

describe('dimensions', () => {
  it('builds hand.angle (wrapped for any direction), hand.speed (up) from the line and hand.entry, hand.height from the lexicon', () => {
    const dims = compile(LINES.hand).space.dims;
    expect(dims).toEqual([
      { name: 'hand.angle', kind: 'angle', min: 0, max: 2 * Math.PI, severity: 'none', wrap: true },
      { name: 'hand.speed', kind: 'speed', min: 0, max: 1.5, severity: 'up' },
      { name: 'hand.entry', kind: 'duration', min: 0, max: HAND_ENTRY_FALLBACK, severity: 'none' },
      { name: 'hand.height', kind: 'length', min: 0.05, max: 0.25, severity: 'none' },
    ]);
  });
  it('takes the speed range from the line: a different line gives a different hand.speed', () => {
    const r = compileRequirement('R1. WHEN a hand reaches in from any direction at 0.2 m/s to 0.9 m/s THE arm SHALL keep every link at least 0.10 m from the hand', lexicon);
    expect(r.diagnostics).toEqual([]);
    expect(r.requirement!.space.dims.find((d) => d.name === 'hand.speed')).toMatchObject({ min: 0.2, max: 0.9 });
  });
  it('fixes the angle for a direction given as an angle', () => {
    const r = compileRequirement('R1. WHEN a hand reaches in from 90 deg at 0.8 m/s THE arm SHALL keep every link at least 0.10 m from the hand', lexicon);
    expect(r.diagnostics).toEqual([]);
    expect(r.requirement!.perturbations[0]!.params).toMatchObject({ direction: Math.PI / 2, speed: 0.8 });
    expect(r.requirement!.space.dims.find((d) => d.name === 'hand.angle')).toMatchObject({ min: Math.PI / 2, max: Math.PI / 2 });
  });
  it('rejects a direction it does not know, with a diagnostic and no requirement', () => {
    const r = compileRequirement('R1. WHEN a hand reaches in from sideways at 0.8 m/s THE arm SHALL keep every link at least 0.10 m from the hand', lexicon);
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics.length).toBeGreaterThan(0);
  });
  it('builds candy.mass (up), vacuum.ratio (down), tracker.lag (up) and the twelve candy placement dimensions', () => {
    expect(compile(LINES.weigh).space.dims[0]).toMatchObject({ name: 'candy.mass', kind: 'mass', severity: 'up', min: 0.005, max: 0.06 });
    expect(compile(LINES.vacuum).space.dims[0]).toMatchObject({ name: 'vacuum.ratio', kind: 'ratio', severity: 'down', min: 0.5, max: 1 });
    expect(compile(LINES.lag).space.dims.find((d) => d.name === 'tracker.lag')).toMatchObject({ kind: 'duration', severity: 'up', min: 0, max: 0.3 });
    const dims = compile(LINES.land).space.dims;
    expect(dims).toHaveLength(12);
    expect(dims.every((d) => d.kind === 'length' && d.severity === 'none')).toBe(true);
    expect(dims[0]).toMatchObject({ name: 'candy.0.x', min: 0.35, max: 0.39 });
    expect(dims[1]).toMatchObject({ name: 'candy.0.y', min: -0.13, max: 0.13 });
  });
  it('declares slots on every template and no deprecated dims()', () => {
    for (const p of lexicon.perturbations) {
      expect(p.slots, p.phrase).toBeDefined();
      expect(p.dims, p.phrase).toBeUndefined();
    }
  });
  it('lints every perturbation template without a finding', () => {
    const phrases = new Set(lexicon.perturbations.map((p) => p.phrase));
    expect(lintLexicon(lexicon).filter((f) => f.template !== undefined && phrases.has(f.template))).toEqual([]);
  });
});

describe('compiled calls', () => {
  // Every searched Dimension must reach apply or begin: the name of each of them is a value of the call's params.
  const searched = (line: string) => {
    const q = compile(line);
    const params = q.perturbations[0]!.params;
    return { q, params, names: Object.values(params).filter((v): v is string => typeof v === 'string') };
  };
  it.each(Object.entries(LINES))('passes every searched dimension of the %s line to the perturbation', (_name, line) => {
    const { q, names } = searched(line);
    for (const d of q.space.dims) if (d.min < d.max) expect(names, d.name).toContain(d.name);
    expect(new Set(names).size).toBe(names.length);
  });
  it('keys the hand parameters by slot name: direction, speed, entry and height', () => {
    expect(searched(LINES.hand).params).toEqual({ direction: 'hand.angle', speed: 'hand.speed', entry: 'hand.entry', height: 'hand.height' });
  });
  it('passes the lag with the hand, and every placement coordinate to begin', () => {
    expect(searched(LINES.lag).params).toMatchObject({ duration: 'tracker.lag', direction: 'hand.angle', entry: 'hand.entry' });
    const land = searched(LINES.land);
    expect(land.params['candy.3.y']).toBe('candy.3.y');
    expect(Object.keys(land.params)).toHaveLength(12);
    expect(land.q.horizon).toBe(90);
  });
  it('matches the vacuum line with percentages', () => {
    expect(searched(LINES.vacuum).params).toEqual({ ratio: 'vacuum.ratio' });
  });
  it('reaches apply: a scenario value of every searched dimension changes what apply does', () => {
    const q = compile(LINES.hand);
    const call = q.perturbations[0]!.params;
    const run = (scenario: Record<string, number>) => {
      const values: Record<string, number> = {};
      for (const [k, v] of Object.entries(call)) values[k] = typeof v === 'string' ? scenario[v]! : v;
      handReaches.apply(ctx, 1.6, 1, values);
      return Array.from((data.mocap_pos as Float64Array).slice(3 * ids.handMocap, 3 * ids.handMocap + 3));
    };
    const base = { 'hand.angle': 1, 'hand.speed': 0.5, 'hand.entry': 0.2, 'hand.height': 0.1 };
    const at = run(base);
    expect(run({ ...base, 'hand.angle': 4 })).not.toEqual(at);
    expect(run({ ...base, 'hand.speed': 1.4 })).not.toEqual(at);
    expect(run({ ...base, 'hand.entry': 1.9 })).not.toEqual(at);
    expect(run({ ...base, 'hand.height': 0.2 })[2]).not.toBe(at[2]);
    handReaches.apply(ctx, 1.0, 1.0, { direction: 0, speed: 0, entry: 5, height: 0.1 });
  });
});
describe('hand perturbation', () => {
  const values = { direction: Math.PI / 2, speed: 0.8, entry: 0.5, height: 0.15 };
  const mocap = () => Array.from((data.mocap_pos as Float64Array).slice(3 * ids.handMocap, 3 * ids.handMocap + 3));
  it('keeps the hand at its start pose before the entry time', () => {
    handReaches.apply(ctx, 1.2, 1.0, values);
    expect(mocap()).toEqual([HAND_START.x, HAND_START.y, HAND_START.z]);
  });
  it('moves the hand from the table edge at the entry time and writes a unit quaternion for the yaw', () => {
    handReaches.apply(ctx, 1.5, 1.0, values);
    expect(mocap()[1]).toBeCloseTo(0.6, 9);
    handReaches.apply(ctx, 1.75, 1.0, values);
    // 0.2 m along the line from the edge (0.55, 0.6) to the green bowl centre (0.611, 0.382)
    const len = Math.hypot(0.611 - 0.55, 0.382 - 0.6);
    expect(mocap()[0]).toBeCloseTo(0.55 + 0.2 * (0.611 - 0.55) / len, 9);
    expect(mocap()[1]).toBeCloseTo(0.6 + 0.2 * (0.382 - 0.6) / len, 9);
    const q = Array.from((data.mocap_quat as Float64Array).slice(4 * ids.handMocap, 4 * ids.handMocap + 4));
    expect(Math.hypot(...q)).toBeCloseTo(1, 12);
    expect(2 * Math.atan2(q[3]!, q[0]!)).toBeCloseTo(Math.PI / 2, 12);
  });
  it('holds the hand at the nearest bowl centre after arrival', () => {
    handReaches.apply(ctx, 30, 1.0, values);
    expect(mocap()[0]).toBeCloseTo(BOWLS[2]!.x, 9);
    expect(mocap()[1]).toBeCloseTo(BOWLS[2]!.y, 9);
    expect(mocap()[2]).toBeCloseTo(0.15, 12);
    handReaches.apply(ctx, 1.0, 1.0, values);
  });
  it('allocates nothing in apply', async () => {
    const n = await gcCount(100_000, (i) => handReaches.apply(ctx, 1 + (i % 400) * 0.002, 1.0, values));
    expect(n).toBe(0);
  });
  it('leaves the true hand alone when only the tracker lag applies', () => {
    const before = mocap();
    trackerLags.begin!(ctx, { duration: 0.2 });
    expect(mocap()).toEqual(before);
    expect(data.userdata[UD.lag]).toBeCloseTo(0.2, 12);
    trackerLags.begin!(ctx, { duration: 0 });
  });
});

describe('setup perturbations', () => {
  it('sets the vacuum ratio and the tracker lag in userdata', () => {
    vacuumWeakens.begin!(ctx, { ratio: 0.5 });
    expect(data.userdata[UD.vacuum]).toBe(0.5);
    trackerLags.begin!(ctx, { duration: 0.3 });
    expect(data.userdata[UD.lag]).toBeCloseTo(0.3, 12);
    vacuumWeakens.begin!(ctx, { ratio: 1 }); trackerLags.begin!(ctx, { duration: 0 });
  });
  it('sets every candy to the given mass and scales the inertia by the same factor, leaving the state alone', () => {
    data.qpos.fill(0.01); data.qvel.fill(0.02);
    const qpos = Float64Array.from(data.qpos), qvel = Float64Array.from(data.qvel);
    candiesWeigh.begin!(ctx, { mass: 0.06 });
    for (let i = 0; i < 6; i++) {
      const b = ids.candyBody[i]!;
      expect(model.body_mass[b]).toBeCloseTo(0.06, 12);
      expect(model.body_inertia[3 * b] / inertia0[3 * b]!).toBeCloseTo(0.06 / mass0[i]!, 9);
    }
    expect(Array.from(data.qpos)).toEqual(Array.from(qpos));
    expect(Array.from(data.qvel)).toEqual(Array.from(qvel));
    restore();
  });
  it('places each candy at its scenario position, upright and at rest, after the overlap rule', () => {
    const values: Record<string, number> = {};
    for (let i = 0; i < 6; i++) { values[`candy.${i}.x`] = CANDY_SPAWN.xMax; values[`candy.${i}.y`] = 0; }
    data.qvel.fill(1);
    candiesLand.begin!(ctx, values);
    const xs = Array.from({ length: 6 }, (_, i) => data.qpos[ids.candyQpos[i]!]);
    expect(xs.map((x) => Number(x.toFixed(2)))).toEqual([0.39, 0.43, 0.47, 0.51, 0.55, 0.59]);
    for (let i = 0; i < 6; i++) {
      expect(data.qpos[ids.candyQpos[i]! + 2]).toBe(CANDY_HALF_HEIGHT[i]);
      expect(data.qpos[ids.candyQpos[i]! + 3]).toBe(1);
      for (let k = 0; k < 6; k++) expect(data.qvel[ids.candyDof[i]! + k]).toBe(0);
    }
  });
});

describe('templates', () => {
  it('has apply on every template and begin on every setup template', () => {
    for (const p of lexicon.perturbations) expect(typeof p.apply).toBe('function');
    for (const p of [candiesWeigh, vacuumWeakens, trackerLags, candiesLand, trackerLagsAndHandReaches]) expect(typeof p.begin).toBe('function');
  });
});
