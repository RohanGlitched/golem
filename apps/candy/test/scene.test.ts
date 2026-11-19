// The generated scene: compile, structure, Home_Pose tip, hand clearance, load time (Requirements 2.x, 15.12).
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { BOWLS, DISTMAX, HAND, HAND_START, Q_HOME, SIM_DT } from '../constants';
import { compileRobot, getMj, robotFiles } from './helpers/mujoco';

const t0 = performance.now();
const compiled = await compileRobot();
const loadMs = performance.now() - t0;
const { mj, model } = compiled;
afterAll(() => { model.delete(); });

const id = (type: string, name: string): number => mj.mj_name2id(model, mj.mjtObj[`mjOBJ_${type.toUpperCase()}`].value, name);

describe('scene.xml', () => {
  it('compiles with six candies, three bowls, one hand and a site named tip', () => {
    for (let i = 0; i < 6; i++) expect(id('body', `candy_${i}`), `candy_${i}`).toBeGreaterThan(0);
    for (const b of BOWLS) expect(id('body', b.name), b.name).toBeGreaterThan(0);
    expect(id('body', 'hand')).toBeGreaterThan(0);
    expect(model.body_mocapid[id('body', 'hand')]).toBeGreaterThanOrEqual(0);
    expect(id('site', 'tip')).toBeGreaterThanOrEqual(0);
    expect(id('geom', 'table')).toBeGreaterThanOrEqual(0);
    expect(id('geom', 'hand_palm')).toBeGreaterThanOrEqual(0);
    expect(id('geom', 'hand_forearm')).toBeGreaterThanOrEqual(0);
  });
  it('has seven position actuators for the arm and none for the cup', () => {
    expect(model.nu).toBe(7);
    for (let i = 1; i <= 7; i++) expect(id('actuator', `actuator${i}`)).toBe(i - 1);
  });
  it('uses a 2 ms timestep, 24 userdata slots and no gripper', () => {
    expect(model.opt.timestep).toBeCloseTo(SIM_DT, 12);
    expect(model.nuserdata).toBe(24);
    expect(id('body', 'hand')).toBeGreaterThan(0);
    expect(id('body', 'left_finger')).toBe(-1);
    expect(id('body', 'right_finger')).toBe(-1);
  });
  it('loads in under 4 s', () => {
    console.log(`scene load + compile: ${loadMs.toFixed(0)} ms`);
    expect(loadMs).toBeLessThan(4000);
  });
  it('puts the tip near (0.307, 0, 0.482) at the Home_Pose, 8 mm below the cup face, pointing down', () => {
    const data = new mj.MjData(model);
    try {
      for (let i = 0; i < 7; i++) data.qpos[i] = Q_HOME[i];
      mj.mj_forward(model, data);
      const s = id('site', 'tip');
      const p = Array.from(data.site_xpos.slice(3 * s, 3 * s + 3)) as number[];
      console.log(`tip at Home_Pose: ${p.map((x) => x.toFixed(4)).join(', ')}`);
      expect(p[0]).toBeCloseTo(0.307, 1);
      expect(Math.abs(p[1]!)).toBeLessThan(0.01);
      expect(p[2]).toBeCloseTo(0.482, 2);
      const zAxis = data.site_xmat[9 * s + 8];
      expect(zAxis).toBeLessThan(-0.99);   // site z points down
    } finally { data.delete(); }
  });
  it('starts the hand at least 1.0 m from the tip surface at the Home_Pose', () => {
    const data = new mj.MjData(model);
    try {
      for (let i = 0; i < 7; i++) data.qpos[i] = Q_HOME[i];
      mj.mj_forward(model, data);
      const hand = id('body', 'hand');
      const h = Array.from(data.xpos.slice(3 * hand, 3 * hand + 3)) as number[];
      expect(h[0]).toBeCloseTo(HAND_START.x, 6);
      expect(h[1]).toBeCloseTo(HAND_START.y, 6);
      expect(h[2]).toBeCloseTo(HAND_START.z, 6);
      const s = id('site', 'tip');
      const t = Array.from(data.site_xpos.slice(3 * s, 3 * s + 3)) as number[];
      const palmSurface = Math.hypot(h[0]! - t[0]!, h[1]! - t[1]!, h[2]! - t[2]!) - HAND.palmRadius;
      expect(palmSurface).toBeGreaterThanOrEqual(1.0);
    } finally { data.delete(); }
  });
  it('lets the whole arm at the Home_Pose sit at least 0.6 m from the hand (distmax)', () => {
    const data = new mj.MjData(model);
    const buf = new mj.DoubleBuffer(6);
    try {
      for (let i = 0; i < 7; i++) data.qpos[i] = Q_HOME[i];
      mj.mj_forward(model, data);
      let min = Infinity;
      for (let g = 0; g < model.ngeom; g++) {
        if (model.geom_contype[g] !== 2 && model.geom_contype[g] !== 8) continue;
        for (const h of ['hand_palm', 'hand_forearm']) {
          min = Math.min(min, mj.mj_geomDistance(model, data, g, id('geom', h), DISTMAX, buf));
        }
      }
      expect(min).toBe(DISTMAX);
    } finally { buf.delete(); data.delete(); }
  });
  it('is rebuilt byte for byte by a second script run: committed files match SOURCE.json', async () => {
    const files = robotFiles();
    const manifest = JSON.parse(readFileSync(new URL('../robot/SOURCE.json', import.meta.url), 'utf8'));
    const { sha256 } = await import('../scripts/lib/hash.mjs');
    for (const [p, h] of Object.entries(manifest.outputs as Record<string, string>)) {
      expect(sha256(files[p]!), p).toBe(h);
    }
  });
});

describe('mujoco runtime', () => {
  it('is loaded once per file', async () => { expect(await getMj()).toBe(mj); });
});
