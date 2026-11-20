// The yard's stand app: pure helpers, the robot list, the shared requirements on every robot's lexicon, and (when the
// robot files have been fetched) a real trial per robot.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileRequirementsFile } from 'golem-spec';
import { ModelCache, runTrial } from 'golem-spec';
import {
  ROBOTS, SIM_DT, UPRIGHT_HEIGHT_RATIO, UPRIGHT_TILT_LIMIT, TILT_TO_M, headingOf, pushDirection, robotById, robotFileList,
  standApp, tiltDeg, uprightMargin,
} from '../stand';
import { referencedFiles, sceneXml, SIM_DT as SCRIPT_DT } from '../scripts/fetch-assets.mjs';

const REQ = readFileSync(new URL('../.kiro/specs/stand-push/requirements.md', import.meta.url), 'utf8');
const robotDir = (id: string): URL => new URL(`../robots/${id}/robot/`, import.meta.url);
const fetched = (id: string): boolean => existsSync(new URL('scene.xml', robotDir(id))) && existsSync(new URL(robotById(id).model, robotDir(id)));

describe('helpers', () => {
  it('tilt is 0 upright, 90 on its side, 180 upside down', () => {
    expect(tiltDeg([1, 0, 0, 0])).toBeCloseTo(0);
    expect(tiltDeg([Math.SQRT1_2, Math.SQRT1_2, 0, 0])).toBeCloseTo(90);
    expect(tiltDeg([0, 1, 0, 0])).toBeCloseTo(180);
    expect(tiltDeg([0, 0, 0, 0])).toBeNaN();
  });

  it('heading follows a yaw and ignores roll', () => {
    const out = new Float64Array(2);
    headingOf([Math.cos(Math.PI / 4), 0, 0, Math.sin(Math.PI / 4)], 0, out); // 90 deg yaw
    expect(out[0]).toBeCloseTo(0); expect(out[1]).toBeCloseTo(1);
    headingOf([0, 0, 0, 1], 0, out); // 180 deg yaw, as ANYmal C's base is written
    expect(out[0]).toBeCloseTo(-1); expect(out[1]).toBeCloseTo(0);
  });

  it('a push from the front points backward, from the left points right, in the robot frame', () => {
    const out = new Float64Array(2);
    pushDirection(0, 1, 0, out);
    expect(out[0]).toBeCloseTo(-1); expect(out[1]).toBeCloseTo(0);
    pushDirection(Math.PI / 2, 1, 0, out);
    expect(out[0]).toBeCloseTo(0); expect(out[1]).toBeCloseTo(-1);
    pushDirection(0, -1, 0, out); // robot facing -x: a push from its front points +x
    expect(out[0]).toBeCloseTo(1);
  });

  it('the upright margin is zero exactly at either limit and is the smaller part', () => {
    expect(uprightMargin(UPRIGHT_HEIGHT_RATIO, 0, 0.5)).toBeCloseTo(0);
    expect(uprightMargin(1, UPRIGHT_TILT_LIMIT, 0.5)).toBeCloseTo(0);
    expect(uprightMargin(1, 0, 0.5)).toBeCloseTo(Math.min(0.4 * 0.5, UPRIGHT_TILT_LIMIT * TILT_TO_M));
    expect(uprightMargin(Number.NaN, 0, 0.5)).toBe(-Infinity);
  });
});

describe('robots.json and the asset script', () => {
  it('lists seven robots with unique ids and a free-base body each', () => {
    expect(ROBOTS).toHaveLength(7);
    expect(new Set(ROBOTS.map((r) => r.id)).size).toBe(ROBOTS.length);
    for (const r of ROBOTS) expect(r.base).toMatch(/^\w+$/);
    expect(() => robotById('nope')).toThrow(/known: go1/);
  });

  it('the scene uses the same timestep as the app and includes the model', () => {
    expect(SCRIPT_DT).toBe(SIM_DT);
    const xml = sceneXml(robotById('spot')) as string;
    expect(xml).toContain('<include file="spot.xml"/>');
    expect(xml).toContain(`timestep="${SIM_DT}"`);
    expect(xml).toMatch(/name="floor"[^>]*group="2"/);
  });

  it('finds mesh and texture files under their compiler directories', () => {
    const xml = '<mujoco><compiler meshdir="assets" texturedir="tex"/><asset><mesh file="a.obj"/><texture name="t" file="b.png"/><mesh name="x" file="a.obj"/></asset></mujoco>';
    expect(referencedFiles(xml)).toEqual(['assets/a.obj', 'tex/b.png']);
    expect(referencedFiles('<mujoco><asset><mesh file="m.stl"/></asset></mujoco>')).toEqual(['m.stl']);
  });

  it('every committed manifest pins the commit of robots.json and lists its scene', () => {
    for (const r of ROBOTS) {
      const m = JSON.parse(readFileSync(new URL('SOURCE.json', robotDir(r.id)), 'utf8'));
      expect(m.folder).toBe(r.folder);
      expect(robotFileList(new TextEncoder().encode(JSON.stringify(m)))).toContain('scene.xml');
      expect(m.sources[r.model]).toMatch(/^[0-9a-f]{64}$/);
      expect(m.sources['LICENSE']).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('the shared requirements', () => {
  it('compile on every robot with no diagnostics', () => {
    for (const r of ROBOTS) {
      const app = standApp(r.id, robotDir(r.id));
      const { requirements, diagnostics } = compileRequirementsFile(REQ, app.lexicon as never);
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(requirements.map((q) => q.id)).toEqual(['1.1', '1.2', '1.3', '1.4', '2.1']);
    }
  });
});

describe('a real trial per fetched robot', () => {
  const cache = new ModelCache();
  for (const r of ROBOTS) {
    it.skipIf(!fetched(r.id))(`${r.id}: no push is a finite margin, and a push of its full weight from its left topples it`, async () => {
      const app = standApp(r.id, robotDir(r.id));
      const req = compileRequirementsFile(REQ, app.lexicon as never).requirements.find((q) => q.id === '1.4')!;
      const run = (ratio: number) => runTrial(app as never, req, { app: app.id, reqId: '1.4', scenario: { 'push.weight': ratio, 'push.angle': Math.PI / 2 }, seed: 1 }, { cache });
      const calm = await run(0);
      expect(Number.isFinite(calm.robustness)).toBe(true);
      const hard = await run(1);
      expect(hard.robustness).toBeLessThan(0);
    });
  }
});
