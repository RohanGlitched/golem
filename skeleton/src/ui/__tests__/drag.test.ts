// @vitest-environment jsdom
// The per-app pointer hook: `dragBody` carries a mocap body (a hand) with the pointer, on the plane it was grabbed on.
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import { act } from '@testing-library/react';
import { DragController } from '../hero/drag.js';
import { HeroSim } from '../hero/hero-sim.js';
import { RenderScheduler } from '../core/scheduler.js';
import { mountStudio } from '../index.js';
import { FakeMj, FakeRaf, FakeStorage } from './fakes.js';
import { GOOD_LINE, lexApp } from './generators/lexicon.js';
import type { RobotApp, V3 } from '../types.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.innerHTML = ''; });

const app: RobotApp = { ...lexApp, names: {}, initState: () => {}, makeController: () => ({ step() {} }) };

/** A hero over a fake model with one mocap row, at (0.5, 1.1, 0.3). */
function rig(constrain?: (p: V3) => V3) {
  const raf = new FakeRaf();
  const sched = new RenderScheduler({ raf: raf.raf, caf: raf.caf }, () => {});
  const mj = new FakeMj(3);
  mj.data.mocap_pos = new Float64Array([0.5, 1.1, 0.3]);
  let now = 0;
  const hero = new HeroSim({
    mj, model: mj.model, data: mj.data, ctx: { mj, model: mj.model, data: mj.data, ids: {} }, app, rng: () => 0.5,
    stepCap: 1000, idleSleepMs: 1000, scheduler: sched, now: () => now,
  });
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  const said: string[] = [];
  let over = true;
  // The pointer looks straight down from 5 m: clientX, clientY are the x and y of the plane point.
  const drag = new DragController({
    THREE, canvas, camera, hero, meshes: [], mocapRow: 0, scheduler: sched, announce: (m) => said.push(m), noun: 'hand',
    ...(constrain ? { constrain } : {}),
    hit: () => over, ray: (e) => ({ origin: [e.clientX, e.clientY, 5], dir: [0, 0, -1] }),
  });
  return { drag, hero, mj, sched, said, canvas, setOver: (b: boolean) => { over = b; }, setNow: (t: number) => { now = t; } };
}

const pos = (mj: FakeMj): number[] => Array.from(mj.data.mocap_pos as Float64Array);

describe('DragController', () => {
  it('moves the mocap row to the pointer and keeps the height it had at the grab', () => {
    const { drag, mj } = rig();
    drag.down({ pointerId: 1, clientX: 0.5, clientY: 1.1 });
    drag.move({ pointerId: 1, clientX: 0.7, clientY: 0.4 });
    expect(pos(mj)).toEqual([0.7, 0.4, 0.3]);
  });
  it('does not jump to the pointer: it keeps the offset of the grab point', () => {
    const { drag, mj } = rig();
    drag.down({ pointerId: 1, clientX: 0.55, clientY: 1.0 });
    drag.move({ pointerId: 1, clientX: 0.55, clientY: 1.0 });
    expect(pos(mj)[0]).toBeCloseTo(0.5, 12);
    expect(pos(mj)[1]).toBeCloseTo(1.1, 12);
    drag.move({ pointerId: 1, clientX: 0.65, clientY: 0.9 });
    expect(pos(mj)[0]).toBeCloseTo(0.6, 12);
    expect(pos(mj)[1]).toBeCloseTo(1.0, 12);
  });
  it('holds `dragging` from the grab to the release and announces the end position', () => {
    const { drag, sched, said } = rig();
    expect(sched.has('dragging')).toBe(false);
    drag.down({ pointerId: 1, clientX: 0.5, clientY: 1.1 });
    expect(sched.has('dragging')).toBe(true);
    drag.move({ pointerId: 1, clientX: 0.8, clientY: 0.2 });
    drag.up({ pointerId: 1 });
    expect(sched.has('dragging')).toBe(false);
    expect(said).toEqual(['Moved the hand to x 0.80 m, y 0.20 m, z 0.30 m']);
  });
  it('does nothing when the pointer is not over the body', () => {
    const { drag, mj, setOver, sched } = rig();
    setOver(false);
    drag.down({ pointerId: 1, clientX: 0, clientY: 0 });
    drag.move({ pointerId: 1, clientX: 0.9, clientY: 0.9 });
    expect(drag.active).toBe(false);
    expect(sched.has('dragging')).toBe(false);
    expect(pos(mj)).toEqual([0.5, 1.1, 0.3]);
  });
  it('ignores a second pointer and a pointer that did not grab', () => {
    const { drag, mj, said } = rig();
    drag.down({ pointerId: 1, clientX: 0.5, clientY: 1.1 });
    drag.down({ pointerId: 2, clientX: 0.5, clientY: 1.1 });
    drag.move({ pointerId: 2, clientX: 0.9, clientY: 0.9 });
    drag.up({ pointerId: 2 });
    expect(drag.active).toBe(true);
    expect(pos(mj)).toEqual([0.5, 1.1, 0.3]);
    expect(said).toEqual([]);
  });
  it('ignores the secondary mouse button', () => {
    const { drag } = rig();
    drag.down({ pointerId: 1, clientX: 0.5, clientY: 1.1, button: 2 });
    expect(drag.active).toBe(false);
  });
  it('does not grab while disabled, and cancel ends a drag without an announcement, leaving the body where it is', () => {
    const { drag, mj, said, sched } = rig();
    drag.disabled = true;
    drag.down({ pointerId: 1, clientX: 0.5, clientY: 1.1 });
    expect(drag.active).toBe(false);
    expect(drag.isOnBody({ clientX: 0, clientY: 0 })).toBe(false);
    drag.disabled = false;
    drag.down({ pointerId: 1, clientX: 0.5, clientY: 1.1 });
    drag.move({ pointerId: 1, clientX: 0.6, clientY: 1.0 });
    drag.cancel();
    expect(sched.has('dragging')).toBe(false);
    expect(said).toEqual([]);
    expect(pos(mj)[0]).toBeCloseTo(0.6, 12);
  });
  it('wakes a sleeping hero when the body is moved', () => {
    const { drag, hero, setNow } = rig();
    setNow(5000);
    expect(hero.advance(0.01, 5000).steps).toBe(0);
    expect(hero.sleeping).toBe(true);
    drag.down({ pointerId: 1, clientX: 0.5, clientY: 1.1 });
    expect(hero.sleeping).toBe(false);
  });
  it('removes its listeners on dispose', () => {
    const { drag, canvas, mj } = rig();
    drag.dispose();
    canvas.dispatchEvent(new Event('pointerdown'));
    expect(drag.active).toBe(false);
    expect(pos(mj)).toEqual([0.5, 1.1, 0.3]);
  });

  // Feature: candy-app, pointer hook: the written position always satisfies the app's rule and keeps the grab height
  it('property: every position written is the constrain of the pointer point, and z never changes', () => {
    const clampBox = (p: V3): V3 => [Math.min(0.9, Math.max(0.15, p[0])), Math.min(0.6, Math.max(-0.6, p[1])), p[2]];
    fc.assert(fc.property(
      fc.array(fc.tuple(fc.double({ min: -3, max: 3, noNaN: true }), fc.double({ min: -3, max: 3, noNaN: true })), { minLength: 1, maxLength: 20 }),
      (moves) => {
        const { drag, mj } = rig(clampBox);
        drag.down({ pointerId: 1, clientX: 0.5, clientY: 1.1 });
        for (const [x, y] of moves) {
          drag.move({ pointerId: 1, clientX: x, clientY: y });
          const p = pos(mj);
          const want = clampBox([x, y, 0.3]);
          expect(p[0]).toBeCloseTo(want[0], 9);
          expect(p[1]).toBeCloseTo(want[1], 9);
          expect(p[2]).toBe(0.3);
          expect(p[0]).toBeGreaterThanOrEqual(0.15);
          expect(p[0]).toBeLessThanOrEqual(0.9);
        }
        drag.dispose();
      },
    ), { numRuns: 60 });
  });
});

describe('HeroSim mocap access', () => {
  it('reads and writes a mocap row on the current array, also after the WASM buffer was replaced', () => {
    const { hero, mj } = rig();
    const out = new Float64Array(3);
    hero.mocapPos(0, out);
    expect(Array.from(out)).toEqual([0.5, 1.1, 0.3]);
    mj.data.mocap_pos = new Float64Array([9, 9, 9, 0, 0, 0]);
    hero.setMocapPos(1, 0.1, 0.2, 0.3);
    expect(Array.from(mj.data.mocap_pos as Float64Array)).toEqual([9, 9, 9, 0.1, 0.2, 0.3]);
  });
});

describe('mountStudio dragBody', () => {
  it('warns, and still mounts, when the named body is not a mocap body', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const raf = new FakeRaf();
    const mj = new FakeMj(3);
    let h!: ReturnType<typeof mountStudio>;
    await act(async () => {
      h = mountStudio(el, app, `# R\n\n### Requirement 1: Bob\n\n#### Acceptance Criteria\n\n1. ${GOOD_LINE}\n`, {
        dragBody: { body: 'hand', noun: 'hand' },
        testHooks: {
          raf: raf.raf, caf: raf.caf, storage: new FakeStorage(), webgl: true,
          createRenderer: () => ({ setPixelRatio() {}, setSize() {}, render() {}, dispose() {}, info: { render: { calls: 0 } } }),
          loadHero: async () => ({
            FS: { mkdirTree() {}, writeFile() {} }, MjModel: { from_xml_path: () => mj.model },
            MjData: function MjData() { return mj.data; }, mj_name2id: () => -1, mjtObj: {},
          }),
        },
      });
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const s = h.getState();
    expect(s.hero).toBe('running');
    expect(s.messages.some((m) => m.kind === 'warning' && m.text.includes('The drag body "hand" is not a mocap body'))).toBe(true);
    act(() => h.dispose());
  });
});
