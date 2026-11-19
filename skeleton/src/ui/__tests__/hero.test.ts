// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import { DIVERGED_TEXT, HeroSim } from '../hero/hero-sim.js';
import type { HeroDeps } from '../hero/hero-sim.js';
import { copyModel, loadHero } from '../hero/load-hero.js';
import { ShoveController } from '../hero/shove.js';
import { RenderScheduler } from '../core/scheduler.js';
import { FakeClock, FakeMj, FakeRaf } from './fakes.js';
import type { RobotApp } from '../types.js';

class ResettableMj extends FakeMj {
  mj_resetData = (_m: unknown, d: any): void => { d.qpos.fill(0); };
}

function app(over: Partial<RobotApp> = {}): RobotApp {
  return {
    id: 'fake', name: 'Fake robot', files: async () => ({ 'scene.xml': new Uint8Array(1) }), sceneFile: 'scene.xml',
    simDt: 0.002, controlDt: 0.02, warmup: 0.2,
    lexicon: { robotNames: ['robot'], predicates: [], perturbations: [] },
    makeController: () => ({ step() {} }), signals() {}, ...over,
  };
}

function hero(over: Partial<HeroDeps> = {}, a = app(), mj = new ResettableMj(3)) {
  const raf = new FakeRaf();
  const clock = new FakeClock();
  const sched = new RenderScheduler({ raf: raf.raf, caf: raf.caf }, () => {});
  const said: string[] = [];
  const h = new HeroSim({
    mj, model: mj.model, data: mj.data, ctx: { mj, model: mj.model, data: mj.data, ids: {} }, app: a, rng: () => 0.5,
    stepCap: 40, idleSleepMs: 10000, scheduler: sched, now: clock.now, onDiverged: () => said.push(DIVERGED_TEXT), ...over,
  });
  return { h, mj, sched, clock, said, raf };
}

describe('HeroSim', () => {
  it('zeroes xfrc_applied before every step', () => {
    const { h, mj } = hero();
    h.setForce('shove', (v) => { v.xfrc[0] = (v.xfrc[0] as number) + 1; return true; });
    h.advance(0.02, 0);
    expect(mj.steps).toBe(10);
    expect(mj.stepLog).toEqual(Array(10).fill(1));
  });

  it('refreshes its views when the WASM buffer changes', () => {
    const { h, mj } = hero();
    const fresh = new Float64Array(18);
    mj.data.xfrc_applied = fresh;
    h.setForce('key', (v) => { v.xfrc[0] = 7; return true; });
    h.advance(0.002, 0);
    expect(h.views.xfrc).toBe(fresh);
    expect(mj.stepLog[0]).toBe(7);
  });

  it('syncs from fresh views when the controller grew the WASM heap while it was built', () => {
    const mj = new ResettableMj(3);
    const seen: number[] = [];
    const a = app({
      makeController: (ctx) => {
        // a second MjData for IK grows the heap: every typed-array view taken before is detached and a new one replaces it
        ctx.data.xfrc_applied = new Float64Array(18);
        ctx.data.xpos = new Float64Array(9).fill(4);
        return { step() {} };
      },
    });
    const { h } = hero({ sync: (xpos) => { seen.push(xpos[0] as number); } }, a, mj);
    expect(seen.at(-1)).toBe(4);
    h.sync();
    expect(seen.at(-1)).toBe(4);
    mj.data.xpos = new Float64Array(9).fill(7);
    mj.data.xfrc_applied = new Float64Array(18);
    h.sync();
    expect(seen.at(-1)).toBe(7);
  });

  it('calls the controller once per control interval', () => {
    let calls = 0;
    const { h } = hero({}, app({ makeController: () => ({ step: () => { calls++; } }) }));
    h.advance(0.05, 0); // 25 steps, nCtrl = 10
    expect(h.nCtrl).toBe(10);
    expect(calls).toBe(3);
  });

  it('resets and announces when the state diverges', () => {
    const { h, mj, said } = hero({}, app({ makeController: (ctx) => ({ step: () => { ctx.data.qpos[0] = Number.NaN; } }) }));
    const r = h.advance(0.004, 0);
    expect(r.diverged).toBe(true);
    expect(said).toEqual([DIVERGED_TEXT]);
    expect(Number.isFinite(mj.data.qpos[0])).toBe(true);
  });

  it('deletes MjData and MjModel once each', () => {
    const { h, mj } = hero();
    h.dispose(); h.dispose();
    expect(mj.deleted).toBe(2);
  });

  it('sleeps after idleSleepMs and releases simulating, and wakes on activity', () => {
    const sleeps: boolean[] = [];
    const { h, sched, clock } = hero({ onSleepChange: (s) => sleeps.push(s) });
    expect(sched.has('simulating')).toBe(true);
    clock.advance(10001);
    expect(h.advance(0.016, clock.now()).steps).toBe(0);
    expect(h.sleeping).toBe(true);
    expect(sched.has('simulating')).toBe(false);
    h.wake();
    expect(sched.has('simulating')).toBe(true);
    expect(h.advance(0, clock.now()).steps).toBe(0);
    expect(sleeps).toEqual([true, false]);
  });

  it('holds still while ghosts run, without stepping or sleeping, and walks on when released', () => {
    const holds: boolean[] = [];
    const sleeps: boolean[] = [];
    const { h, mj, sched, clock } = hero({ onHoldChange: (x) => holds.push(x), onSleepChange: (s) => sleeps.push(s) });
    h.setHeld(true);
    expect(sched.has('simulating')).toBe(false);
    clock.advance(60000); // far longer than idleSleepMs
    expect(h.advance(5, clock.now()).steps).toBe(0);
    expect(mj.steps).toBe(0);
    expect(h.sleeping).toBe(false);
    h.setHeld(true); // no second announcement
    h.setHeld(false);
    expect(sched.has('simulating')).toBe(true);
    expect(h.sleeping).toBe(false);
    expect(h.advance(0.02, clock.now()).steps).toBe(10); // the hidden time is not stepped, the next 20 ms is
    expect(holds).toEqual([true, false]);
    expect(sleeps).toEqual([]);
  });

  it('ends the hold when the user shoves or resets the robot', () => {
    const { h, mj } = hero();
    h.setHeld(true);
    h.setForce('shove', () => true);
    expect(h.held).toBe(false);
    h.setHeld(true);
    h.reset();
    expect(h.held).toBe(false);
    expect(h.advance(0.002, 0).steps).toBe(1);
    expect(mj.steps).toBe(1);
  });

  it('does not step for hidden time after a pause', () => {
    const { h, mj } = hero();
    h.advance(0.001, 0);
    h.pause();
    expect(h.advance(5, 0).steps).toBe(0);
    h.resume();
    h.advance(0, 0);
    expect(mj.steps).toBe(0);
  });

  it('restores the snapshot', () => {
    const { h, mj } = hero();
    mj.data.qpos[0] = 0.25;
    h.snapshot();
    mj.data.qpos[0] = 9;
    h.restore();
    expect(mj.data.qpos[0]).toBe(0.25);
  });

  it('flags running slower than real time when the step cap is hit', () => {
    const slow: boolean[] = [];
    const { h } = hero({ stepCap: 5, onSlowChange: (s) => slow.push(s) });
    h.advance(1, 0);
    h.advance(0.002, 0);
    expect(slow).toEqual([true, false]);
  });

  // Feature: golem-studio-ui, Property 7: Control decimation
  it('calls the controller ceil(S / n) times at steps 0, n, 2n', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 400 }), (n, S) => {
      const at: number[] = [];
      let step = 0;
      const simDt = 0.001;
      const mj = new ResettableMj(1);
      const orig = mj.mj_step;
      mj.mj_step = (m, d) => { orig(m, d); step++; };
      const { h } = hero({ stepCap: 1e9 }, app({ simDt, controlDt: n * simDt, makeController: () => ({ step: () => { at.push(step); } }) }), mj);
      h.advance(S * simDt + simDt / 4, 0);
      expect(mj.steps).toBe(S);
      expect(at.length).toBe(Math.ceil(S / n));
      at.forEach((s, i) => expect(s).toBe(i * n));
    }), { numRuns: 100 });
  });
});

function fakeMjModule(model: any, data: any) {
  return {
    FS: { mkdirTree() {}, writeFile() {} },
    MjModel: { from_xml_path: () => model },
    MjData: function MjData() { return data; },
    mj_name2id: () => 0, mjtObj: {},
  };
}

describe('loadHero', () => {
  it('copies the model arrays so they do not alias the source', async () => {
    const f = new FakeMj(2);
    Object.assign(f.model, { ngeom: 1, geom_size: new Float64Array([1, 2, 3]), geom_type: new Int32Array([6]) });
    const h = await loadHero(app(), { load: async () => fakeMjModule(f.model, f.data) });
    expect(h.modelLike.geom_size).not.toBe(f.model.geom_size);
    expect((h.modelLike.geom_size as Float64Array).buffer).not.toBe(f.model.geom_size.buffer);
    expect(Array.from(h.modelLike.geom_size)).toEqual([1, 2, 3]);
    f.model.geom_size[0] = 99;
    expect(h.modelLike.geom_size[0]).toBe(1);
    expect(copyModel(f.model).nbody).toBe(2);
  });
  it('names the app and the failure when files() rejects', async () => {
    const f = new FakeMj(2);
    const a = app({ files: async () => { throw new Error('404 scene.xml'); } });
    await expect(loadHero(a, { load: async () => fakeMjModule(f.model, f.data) })).rejects.toThrow(
      'Could not load the files of Fake robot: 404 scene.xml. Check that the robot files are served from the same origin.',
    );
  });
  it('names the failure and says to reload when MuJoCo fails to load', async () => {
    await expect(loadHero(app(), { load: async () => { throw new Error('wasm fetch failed'); } })).rejects.toThrow(
      'Could not load MuJoCo for Fake robot: wasm fetch failed. Reload the page to try again.',
    );
  });
});

function shoveRig(simDt = 0.002) {
  const raf = new FakeRaf();
  const sched = new RenderScheduler({ raf: raf.raf, caf: raf.caf }, () => {});
  const mj = new ResettableMj(3);
  const said: string[] = [];
  const h = new HeroSim({
    mj, model: mj.model, data: mj.data, ctx: { mj, model: mj.model, data: mj.data, ids: {} }, app: app({ simDt }), rng: () => 0.5,
    stepCap: 1000, idleSleepMs: 1e9, scheduler: sched, now: () => 0,
  });
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  document.body.appendChild(host);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  camera.up.set(0, 0, 1);
  camera.position.set(0, -3, 1);
  camera.lookAt(0, 0, 1);
  const groups = [0, 1, 2].map(() => new THREE.Group());
  let hit: { body: number; point: [number, number, number] } | undefined = { body: 1, point: [0, 0, 1] };
  let rayTo: [number, number, number] = [0, 0, 1];
  const s = new ShoveController({
    THREE, canvas, camera, scene: new THREE.Scene(), hero: h, bodyGroups: groups, meshes: [], scheduler: sched,
    announce: (m) => said.push(m), stiffness: 600, primaryBody: 1, simDt, inkColor: '#ffffff',
    pick: () => hit, ray: () => ({ origin: [rayTo[0], -3, rayTo[2]], dir: [0, 1, 0] }),
  });
  return { s, h, mj, sched, said, setHit: (x: typeof hit) => { hit = x; }, setRay: (p: [number, number, number]) => { rayTo = p; } };
}

describe('ShoveController', () => {
  it('shows a live label in whole newtons and clears arrow and label on release', () => {
    const { s, h, sched, said, setRay } = shoveRig();
    s.down({ pointerId: 1, clientX: 0, clientY: 0 });
    expect(sched.has('dragging')).toBe(true);
    setRay([0.2004, 0, 1]);
    s.move({ pointerId: 1, clientX: 5, clientY: 0 });
    h.advance(0.002, 0);
    s.update();
    expect(s.label).toBe('120 N');
    expect(s.arrow.visible).toBe(true);
    s.up({ pointerId: 1 });
    expect(s.label).toBe('');
    expect(s.arrow.visible).toBe(false);
    expect(s.labelEl.hidden).toBe(true);
    expect(sched.has('dragging')).toBe(false);
    expect(said).toEqual(['Pushed with a peak of 120 N']);
  });
  it('caps the spring force at 400 N and applies torque about the centre of mass', () => {
    const { s, h, mj, setRay } = shoveRig();
    s.down({ pointerId: 1, clientX: 0, clientY: 0 });
    setRay([5, 0, 1]);
    s.move({ pointerId: 1, clientX: 0, clientY: 0 });
    let fx = 0;
    mj.mj_step = (_m, d) => { fx = d.xfrc_applied[6]; };
    h.advance(0.002, 0);
    expect(fx).toBeCloseTo(400, 9);
  });
  it('ignores a second pointer during a shove', () => {
    const { s, said } = shoveRig();
    s.down({ pointerId: 1, clientX: 0, clientY: 0 });
    s.down({ pointerId: 2, clientX: 0, clientY: 0 });
    s.up({ pointerId: 2 });
    expect(s.active).toBe(true);
    expect(said).toEqual([]);
  });
  it('clears the arrow and label on cancel', () => {
    const { s, h } = shoveRig();
    s.down({ pointerId: 1, clientX: 0, clientY: 0 });
    s.cancel();
    expect(s.label).toBe('');
    expect(h.hasForce('shove')).toBe(false);
  });
  it('pushes 100 N for round(0.2 / simDt) steps and announces the direction at the end', () => {
    const { s, h, mj, said, sched } = shoveRig(0.01);
    const log: number[] = [];
    mj.mj_step = (_m, d) => { log.push(Math.hypot(d.xfrc_applied[6], d.xfrc_applied[7], d.xfrc_applied[8])); };
    s.key({ key: 'ArrowUp', shiftKey: false, preventDefault() {} });
    expect(s.label).toBe('100 N');
    expect(sched.has('dragging')).toBe(true);
    h.advance(0.5, 0);
    expect(log.filter((f) => f > 0)).toHaveLength(20);
    expect(log.filter((f) => f > 0).every((f) => Math.abs(f - 100) < 1e-9)).toBe(true);
    expect(said).toEqual(['Pushed 100 N toward the far side']);
    expect(s.label).toBe('');
    expect(sched.has('dragging')).toBe(false);
  });
  it('restarts with a new direction on a second arrow key', () => {
    const { s, h, mj, said } = shoveRig(0.01);
    const xs: number[] = [];
    mj.mj_step = (_m, d) => { xs.push(d.xfrc_applied[6]); };
    s.key({ key: 'ArrowUp', shiftKey: false, preventDefault() {} });
    h.advance(0.05, 0);
    s.key({ key: 'ArrowRight', shiftKey: false, preventDefault() {} });
    h.advance(0.5, 0);
    expect(xs.slice(0, 5).every((x) => Math.abs(x) < 1e-9)).toBe(true);
    expect(xs.slice(5, 25).every((x) => Math.abs(x - 100) < 1e-9)).toBe(true);
    expect(said).toEqual(['Pushed 100 N toward the right']);
  });
  it('cancels a key push on Escape and clears the arrow', () => {
    const { s, h, said } = shoveRig(0.01);
    s.key({ key: 'ArrowLeft', shiftKey: false, preventDefault() {} });
    s.key({ key: 'Escape', shiftKey: false, preventDefault() {} });
    expect(h.hasForce('key')).toBe(false);
    expect(s.label).toBe('');
    expect(s.arrow.visible).toBe(false);
    expect(said).toEqual([]);
  });
});
