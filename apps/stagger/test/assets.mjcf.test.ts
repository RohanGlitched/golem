import { describe, expect, it } from 'vitest';
import { rewriteMjcf, writeScene, referencedMeshFiles } from '../scripts/lib/mjcf.mjs';
import { LEG_JOINTS, smallMjcf } from './helpers/assetFixtures';

const attr = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

describe('rewriteMjcf', () => {
  const out = rewriteMjcf(smallMjcf());
  const geoms = [...out.matchAll(/<geom\b[^>]*\/>/g)].map((m) => m[0]);

  it('points collision mesh geoms at hull meshes in group 3', () => {
    const hulls = geoms.filter((g) => attr(g, 'group') === '3');
    expect(hulls.length).toBe(13);
    for (const g of hulls) expect(attr(g, 'mesh')).toMatch(/_hull$/);
  });
  it('makes visual geoms group 2 without contacts', () => {
    const vis = geoms.filter((g) => attr(g, 'group') === '2');
    expect(vis.length).toBe(13);
    for (const g of vis) { expect(attr(g, 'contype')).toBe('0'); expect(attr(g, 'conaffinity')).toBe('0'); }
  });
  it('leaves primitive geoms alone', () => {
    expect(geoms.some((g) => g.includes('size="0.005"') && attr(g, 'group') === undefined)).toBe(true);
  });
  it('references hull and visual files with different names', () => {
    const { vis, hull } = referencedMeshFiles(out);
    expect(vis.length).toBe(13);
    expect(hull.length).toBe(13);
    expect(vis.filter((v) => hull.includes(v))).toEqual([]);
  });
  it('keeps the pelvis free joint and the 12 leg joints in order', () => {
    expect(out).toMatch(/<body name="pelvis"/);
    expect(out).toMatch(/<joint name="floating_base_joint" type="free"/);
    const joints = [...out.matchAll(/<joint name="([a-z_]+)_joint" axis/g)].map((m) => m[1]);
    const expected = ['left', 'right'].flatMap((s) => LEG_JOINTS.map((j) => `${s}_${j}`));
    expect(joints).toEqual(expected);
  });
  it('turns each motor into a PD actuator with the same name and joint', () => {
    const acts = [...out.matchAll(/<general\b[^>]*\/>/g)].map((m) => m[0]);
    expect(acts.length).toBe(12);
    expect(attr(acts[3]!, 'name')).toBe('left_knee_joint');
    expect(attr(acts[3]!, 'gainprm')).toBe('150');
    expect(attr(acts[3]!, 'biasprm')).toBe('0 -150 -4');
    expect(attr(acts[5]!, 'biasprm')).toBe('0 -40 -2');
    expect(out).not.toMatch(/<motor/);
  });
  it('is idempotent', () => {
    expect(rewriteMjcf(out)).toBe(out);
  });
});

describe('writeScene', () => {
  const scene = writeScene('g1_12dof.xml');
  it('includes the robot MJCF, a floor geom and a 0.002 s timestep', () => {
    expect(scene).toContain('<include file="g1_12dof.xml"/>');
    expect(scene).toMatch(/<geom name="floor"/);
    expect(scene).toContain('<option timestep="0.002"/>');
  });
});