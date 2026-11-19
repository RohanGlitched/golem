import { describe, expect, it } from 'vitest';
import * as C from '../constants';
import * as S from '../scripts/lib/consts.mjs';
import { AnchorError, assertNoGripper, patchPanda } from '../scripts/lib/patch.mjs';
import { f, lookAtXyAxes, writeScene } from '../scripts/lib/scene.mjs';
import { stubPandaXml } from './helpers/assetFixtures';

const naming = (file: string, role: string): string => (role === 'collision' ? file.replace(/\.[^.]+$/, '.hull.obj') : file);

describe('scene generator', () => {
  it('gives the same text on two calls', () => {
    expect(writeScene()).toBe(writeScene());
  });
  it('has no exponent notation, NaN or negative zero in numbers', () => {
    const xml = writeScene();
    expect(xml).not.toMatch(/\d[eE][-+]?\d/);
    expect(xml).not.toMatch(/NaN|undefined|Infinity/);
    expect(xml).not.toMatch(/(^|[ "])-0([ "])/);
  });
  it('formats numbers with at most six decimals and no trailing zeros', () => {
    expect(f(1.2345678)).toBe('1.234568');
    expect(f(0.5)).toBe('0.5');
    expect(f(-1e-9)).toBe('0');
  });
  it('declares timestep 0.002 s, nuserdata 24 and the panda include', () => {
    const xml = writeScene();
    expect(xml).toContain('<option timestep="0.002">');
    expect(xml).toContain('<size nuserdata="24"/>');
    expect(xml).toContain('<include file="panda.xml"/>');
  });
  it('names the table, three bowls, six candies, the hand and its two collision geoms', () => {
    const xml = writeScene();
    expect(xml).toContain('<geom name="table" type="box"');
    for (const b of ['bowl_orange', 'bowl_purple', 'bowl_green']) expect(xml).toContain(`<body name="${b}"`);
    for (let i = 0; i < 6; i++) {
      expect(xml).toContain(`<body name="candy_${i}"`);
      expect(xml).toContain(`<freejoint name="candy_${i}_free"/>`);
    }
    expect(xml).toContain('<body name="hand" mocap="true"');
    expect(xml).toContain('name="hand_palm" type="sphere"');
    expect(xml).toContain('name="hand_forearm" type="capsule"');
  });
  it('builds bowls from box and cylinder geoms only', () => {
    const xml = writeScene();
    for (const b of ['bowl_orange', 'bowl_purple', 'bowl_green']) {
      const geoms = [...xml.matchAll(new RegExp(`<geom name="${b}_[^"]*" type="(\\w+)"`, 'g'))].map((m) => m[1]);
      expect(geoms.length).toBe(5);
      for (const g of geoms) expect(['box', 'cylinder']).toContain(g);
    }
  });
  it('colours each candy like exactly one bowl', () => {
    const xml = writeScene();
    const bowl = [...xml.matchAll(/<geom name="(bowl_\w+)_floor"[^>]*rgba="([^"]+)"/g)].map((m) => m[2]);
    expect(new Set(bowl).size).toBe(3);
    for (let i = 0; i < 6; i++) {
      const c = new RegExp(`<geom name="candy_${i}_geom"[^>]*rgba="([^"]+)"`).exec(xml)![1];
      expect(bowl.filter((b) => b === c)).toHaveLength(1);
      expect(bowl.indexOf(c!)).toBe(i % 3);
    }
  });
  it('sets the collision filter of the design table', () => {
    const xml = writeScene();
    expect(xml).toMatch(/name="table"[^>]*contype="1" conaffinity="14"/);
    expect(xml).toMatch(/name="bowl_purple_floor"[^>]*contype="1" conaffinity="14"/);
    expect(xml).toMatch(/name="candy_0_geom"[^>]*contype="4" conaffinity="9"/);
    for (const g of ['hand_palm', 'hand_forearm']) expect(xml).toMatch(new RegExp(`name="${g}"[^>]*contype="0" conaffinity="0"`));
  });
  it('uses wood, felt and halloween colours for the studio look', () => {
    const xml = writeScene();
    for (const m of ['wood_a', 'wood_b', 'wood_c', 'felt', 'candy_orange', 'candy_purple', 'candy_green']) expect(xml).toContain(`<material name="${m}"`);
    expect(xml).toContain('<camera name="studio"');
    expect(xml).toContain('<light name="lantern"');
    expect(xml).toContain('type="skybox"');
  });
  it('keeps the scene constants in step with constants.ts', () => {
    expect(S.TABLE).toEqual(C.TABLE);
    expect(S.TRAY).toEqual(C.TRAY);
    expect(S.BOWLS).toEqual(C.BOWLS);
    expect(S.COLOURS).toEqual(C.COLOURS.map((c) => [...c.rgba]));
    expect(S.HAND_START).toEqual(C.HAND_START);
    expect(S.HAND).toEqual(C.HAND);
    expect(S.CANDY_HALF_HEIGHT).toEqual(C.CANDY_HALF_HEIGHT);
    expect(S.CANDY_MASS).toBe(C.CANDY_MASS);
    expect(S.CONTYPE).toEqual(C.CONTYPE);
    expect(S.CONAFFINITY).toEqual(C.CONAFFINITY);
    expect(S.CUP).toEqual(C.CUP);
    expect(S.SUCTION.tipInset).toBe(C.SUCTION.tipInset);
    expect(S.FLOOR_Z).toBe(C.FLOOR_Z);
    expect(S.SIM_DT).toBe(C.SIM_DT);
    expect(S.NUSERDATA).toBe(C.NUSERDATA);
    expect(S.BOWL.innerHalf).toBe(C.BOWL.innerHalf);
  });
  it('builds orthonormal camera axes', () => {
    const a = lookAtXyAxes([1, -1, 1], [0, 0, 0]);
    expect(Math.hypot(a[0]!, a[1]!, a[2]!)).toBeCloseTo(1, 12);
    expect(Math.hypot(a[3]!, a[4]!, a[5]!)).toBeCloseTo(1, 12);
    expect(a[0]! * a[3]! + a[1]! * a[4]! + a[2]! * a[5]!).toBeCloseTo(0, 12);
  });
});

describe('panda patch', () => {
  it('patches the stub: collision bits, cup with tip site, hull meshes, no keyframe', () => {
    const out = patchPanda(stubPandaXml(), naming);
    expect(out).toContain('<geom type="mesh" group="3" contype="2" conaffinity="1"/>');
    expect(out).toContain('<body name="cup"');
    expect(out).toContain('<site name="tip" pos="0 0 0.092"');
    expect(out).not.toContain('attachment');
    expect(out).not.toContain('<keyframe>');
    expect(out).toContain('<mesh name="link0_c" file="link0.hull.obj"/>');
    expect(out).toContain('<mesh file="link0_0.obj"/>');
  });
  it('puts the tip 8 mm inside the 0.100 m cup face and gives the cup collision cylinder its bits', () => {
    const out = patchPanda(stubPandaXml(), naming);
    expect(out).toMatch(/name="cup_collision" type="cylinder" size="0.02 0.05" pos="0 0 0.05" mass="0.1" group="3" contype="8" conaffinity="5"/);
  });
  it('adds no actuator for the cup', () => {
    const out = patchPanda(stubPandaXml(), naming);
    expect((out.match(/<general /g) ?? []).length).toBe(1);
    expect(out).not.toMatch(/<(general|motor|position)[^>]*cup/);
  });
  it.each([
    ['the collision default class', (x: string) => x.replace('<default class="panda/collision">', '<default class="other">'), 'panda/collision'],
    ['the attachment body', (x: string) => x.replace('name="attachment"', 'name="flange"'), 'attachment'],
    ['the keyframe block', (x: string) => x.replace('<keyframe>', '<keyfrm>').replace('</keyframe>', '</keyfrm>'), 'keyframe'],
    ['the compiler line', (x: string) => x.replace('meshdir="assets"', 'meshdir="meshes"'), 'compiler'],
  ])('throws an AnchorError that names the anchor when %s is missing', (_label, mutate, word) => {
    expect(() => patchPanda(mutate(stubPandaXml()), naming)).toThrow(AnchorError);
    expect(() => patchPanda(mutate(stubPandaXml()), naming)).toThrow(new RegExp(word));
  });
  it('refuses a model that still holds the Menagerie gripper', () => {
    expect(() => assertNoGripper('<body name="hand"/>')).toThrow(/gripper/);
    expect(() => assertNoGripper('<mesh file="finger_0.obj"/>')).toThrow(/gripper/);
    expect(() => assertNoGripper(stubPandaXml())).not.toThrow();
  });
});
