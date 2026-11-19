// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildStage } from '../stage/stage-builder.js';
import {
  CLAY_FRAG, CLAY_VERT, FILL_INTENSITY, GRAIN_AMPLITUDE, KEY_ELEVATION_DEG, KEY_INTENSITY, createClayMaterial,
} from '../stage/clay-material.js';
import { createFloor } from '../stage/floor.js';
import { LOST_TEXT, PUSH_INSTRUCTIONS, Stage } from '../stage/stage.js';
import type { Renderer } from '../stage/stage.js';
import { RenderScheduler } from '../core/scheduler.js';
import { TOKENS } from '../core/theme-tokens.js';
import { FakeRaf } from './fakes.js';
import { modelFrom } from './generators/model.js';

const mat = new THREE.MeshBasicMaterial();

describe('buildStage', () => {
  it('warns once with the geom id and type for an unsupported type', () => {
    const p = buildStage(modelFrom(1, [{ type: 1, group: 2, body: 0, mesh: 0, size: [1, 1, 1] }, { type: 6, group: 2, body: 0, mesh: 0, size: [1, 1, 1] }]), THREE, mat);
    expect(p.warnings).toEqual(['Skipped geom 0: geom type 1 is not supported by the stage']);
    expect(p.skipped).toEqual([{ geom: 0, reason: 'type', type: 1 }]);
    expect(p.meshCount).toBe(1);
  });
  it('warns once with the geom id for a zero-face mesh', () => {
    const p = buildStage(modelFrom(1, [{ type: 7, group: 2, body: 0, mesh: 1, size: [1, 1, 1] }]), THREE, mat);
    expect(p.warnings).toEqual(['Skipped geom 0: its mesh has no faces']);
    expect(p.meshCount).toBe(0);
  });
  it('reports meshCount equal to meshes.length and parents meshes to their body group', () => {
    const p = buildStage(modelFrom(3, [
      { type: 6, group: 2, body: 1, mesh: 0, size: [1, 1, 1] },
      { type: 2, group: 0, body: 1, mesh: 0, size: [1, 1, 1] },
      { type: 7, group: 2, body: 2, mesh: 0, size: [1, 1, 1] },
      { type: 0, group: 2, body: 0, mesh: 0, size: [3, 4, 1] },
    ]), THREE, mat);
    expect(p.meshCount).toBe(p.meshes.length);
    expect(p.meshCount).toBe(2);
    expect(p.meshes[0]!.parent).toBe(p.bodyGroups[1]);
    expect(p.meshes[1]!.parent).toBe(p.bodyGroups[2]);
    expect(p.floor).toMatchObject({ geom: 3, halfExtent: 20 });
    expect(p.skipped).toEqual([{ geom: 1, reason: 'group' }]);
  });
});

describe('clay material', () => {
  it('has no texture sampler and no time uniform', () => {
    for (const src of [CLAY_VERT, CLAY_FRAG]) {
      expect(src).not.toMatch(/sampler2D/);
      expect(src).not.toMatch(/uTime|time/i);
    }
    const m = createClayMaterial(THREE, TOKENS.dark);
    expect(Object.keys(m.uniforms).some((k) => /time/i.test(k))).toBe(false);
  });
  it('keeps the key light at most 20 deg up, the fill at most 35% of the key and grain at most 6%', () => {
    expect(KEY_ELEVATION_DEG).toBeLessThanOrEqual(20);
    expect(FILL_INTENSITY / KEY_INTENSITY).toBeLessThanOrEqual(0.35);
    expect(GRAIN_AMPLITUDE).toBeLessThanOrEqual(0.06);
    const m = createClayMaterial(THREE, TOKENS.dark);
    const kd = m.uniforms['uKeyDir']!.value as THREE.Vector3;
    expect((Math.asin(kd.z) * 180) / Math.PI).toBeCloseTo(KEY_ELEVATION_DEG, 9);
  });
});

describe('floor', () => {
  it('extends a small plane to 20 m and uses the --ground colour', () => {
    const f = createFloor(THREE, { geom: 0, halfExtent: 5, pos: [0, 0, 0] }, TOKENS.dark);
    expect(f.halfExtent).toBe(20);
    expect(f.material.color.getHexString()).toBe(new THREE.Color(TOKENS.dark.ground).getHexString());
    expect(f.material.map).toBeNull();
    expect(f.fog.color.getHexString()).toBe(new THREE.Color(TOKENS.dark.ground).getHexString());
  });
});

function fakeRenderer(): Renderer & { renders: number; ratio: number; disposed: number } {
  return {
    renders: 0, ratio: 0, disposed: 0,
    setPixelRatio(r) { this.ratio = r; }, setSize() {}, render() { this.renders++; }, dispose() { this.disposed++; },
  };
}

function makeStage(dpr = 2) {
  const raf = new FakeRaf();
  const r = fakeRenderer();
  let stage: Stage | undefined;
  const sched = new RenderScheduler({ raf: raf.raf, caf: raf.caf }, () => { stage?.orbit.update(); stage?.render(); });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const vis: boolean[] = [];
  stage = new Stage(host, {
    THREE, scheduler: sched, tokens: TOKENS.dark, createRenderer: () => r, devicePixelRatio: () => dpr,
    reduced: () => true, onVisibility: (v) => vis.push(v),
  });
  while (raf.runNext()) { /* settle */ }
  return { raf, r, sched, stage, host, vis };
}

describe('Stage', () => {
  it('caps the pixel ratio at 1.5', () => {
    expect(makeStage(3).r.ratio).toBe(1.5);
    expect(makeStage(1).r.ratio).toBe(1);
  });
  it('updates tokens and requests one render on a theme change', () => {
    const { raf, r, stage } = makeStage();
    const before = r.renders;
    stage.setTheme(TOKENS.light);
    expect(raf.pending).toBe(1);
    while (raf.runNext()) { /* run */ }
    expect(r.renders).toBe(before + 1);
    expect((stage.scene.background as THREE.Color).getHexString()).toBe(new THREE.Color(TOKENS.light.ground).getHexString());
    expect(stage.floor.material.color.getHexString()).toBe(new THREE.Color(TOKENS.light.ground).getHexString());
  });
  it('requests one render on resize', () => {
    const { raf, r, stage } = makeStage();
    const before = r.renders;
    stage.resize();
    while (raf.runNext()) { /* run */ }
    expect(r.renders).toBe(before + 1);
  });
  it('stops frames while hidden and tells the hero', () => {
    const { raf, sched, stage, vis } = makeStage();
    stage.setGate(false);
    sched.acquire('simulating');
    expect(raf.pending).toBe(0);
    expect(vis).toEqual([false]);
    stage.setGate(true);
    expect(raf.pending).toBe(1);
    expect(vis).toEqual([false, true]);
  });
  it('shows "The 3D view was lost" on context loss', () => {
    const { stage } = makeStage();
    const ev = new Event('webglcontextlost', { cancelable: true });
    stage.canvas.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(stage.message).toBe(LOST_TEXT);
    stage.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(stage.message).toBe('');
  });
  it('makes the canvas a focusable application with the push instructions', () => {
    const { stage } = makeStage();
    expect(stage.canvas.getAttribute('tabindex')).toBe('0');
    expect(stage.canvas.getAttribute('role')).toBe('application');
    expect(stage.canvas.getAttribute('aria-label')).toBeTruthy();
    const help = document.getElementById(stage.canvas.getAttribute('aria-describedby')!);
    expect(help?.textContent).toBe(PUSH_INSTRUCTIONS);
    expect(stage.message).toBe('Loading the robot');
  });
  it('rotates the camera 5 deg about the vertical on Shift + ArrowLeft and releases transition after settling', () => {
    const { raf, sched, stage } = makeStage();
    const p0 = stage.camera.position.clone().sub(stage.orbit.controls.target);
    stage.orbit.key({ key: 'ArrowLeft', shiftKey: true });
    const p1 = stage.camera.position.clone().sub(stage.orbit.controls.target);
    const a0 = Math.atan2(p0.y, p0.x), a1 = Math.atan2(p1.y, p1.x);
    expect(Math.abs(((a1 - a0) * 180) / Math.PI)).toBeCloseTo(5, 6);
    expect(sched.has('transition')).toBe(true);
    for (let i = 0; i < 10 && raf.runNext(); i++) { /* frames */ }
    expect(sched.has('transition')).toBe(false);
    expect(raf.pending).toBe(0);
  });
  it('removes its element and disposes the renderer', () => {
    const { stage, host, r } = makeStage();
    stage.dispose();
    expect(host.children).toHaveLength(0);
    expect(r.disposed).toBe(1);
  });
});
