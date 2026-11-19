// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as THREE from 'three';
import { RequirementLine } from '../tablet/requirement-line.js';
import { LiveSentence } from '../signature/live-sentence.js';
import { HeroSim } from '../hero/hero-sim.js';
import { ShoveController } from '../hero/shove.js';
import { RenderScheduler } from '../core/scheduler.js';
import { compiledLine, fakeActions } from './generators/actions.js';
import { FakeMj, FakeRaf } from './fakes.js';
import type { LineModel, RobotApp } from '../types.js';

afterEach(cleanup);

if (typeof window !== 'undefined' && !('PointerEvent' in window)) {
  class PE extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PE;
}

const LINE = 'WHEN the bob is pushed with up to 20 N for 0.2 s from any direction THE robot SHALL keep the bob upright for 3 s';

function broken(over: Partial<LineModel> = {}): LineModel {
  return {
    ...compiledLine('1.1', 'WHEN the bob is pushed with up to 20 N for 0.2 s from any direction THE robot SHALL keep the bob within 0.3 rad'),
    status: 'broken', unit: 'rad',
    counterexample: { reqId: '1.1', scenario: {}, seed: 3, robustness: -0.07, shrunk: true, foundAfter: 10 }, ...over,
  };
}

describe('RequirementLine living sentence', () => {
  it('wraps the response clause and binds the tilt word, the fuse and the force', () => {
    const line = { ...compiledLine('1.1', LINE), status: 'untested' as const };
    const { container } = render(<ul><RequirementLine line={line} selected running={false} canSummon actions={fakeActions()} /></ul>);
    const resp = container.querySelector('.golem-response');
    expect(resp?.textContent).toBe(' keep the bob upright for 3 s');
    expect(container.querySelector('[data-golem-bind="tilt"]')?.textContent).toBe('upright');
    expect(container.querySelector('[data-golem-bind="fuse"]')?.textContent).toBe('3 s');
    expect(container.querySelector('[data-golem-bind="force"]')?.textContent).toBe('20 N');
  });
  it('fractures at the first response word with the line margin until the per-signal margins arrive', () => {
    const { container } = render(<ul><RequirementLine line={broken()} selected running={false} canSummon actions={fakeActions()} /></ul>);
    expect(container.querySelectorAll('.golem-fracture')).toHaveLength(1);
    expect(container.querySelector('.golem-fracture-word')?.textContent).toBe('keep');
    expect(container.querySelector('.golem-fracture-margin')?.textContent).toBe(' \u22120.07 rad');
  });
  it('fractures at the word of the signal that broke first, with its margin', () => {
    const line = broken();
    const start = line.text.indexOf('bob', line.text.indexOf('SHALL'));
    const { container } = render(<ul><RequirementLine
      line={{ ...line, fracture: { start, end: start + 3, margin: -0.12, unit: 'rad', signal: 'bob.angle' } }}
      selected running={false} canSummon actions={fakeActions()} /></ul>);
    const w = container.querySelector('.golem-fracture-word') as HTMLElement;
    expect(w.textContent).toBe('bob');
    expect(w.dataset['golemFracture']).toBe('bob.angle');
    expect(container.querySelector('.golem-fracture-margin')?.textContent).toBe(' \u22120.12 rad');
  });
  it('asks the studio to draw the push while a quantity is stepped', () => {
    const seen: string[] = [];
    const line = { ...compiledLine('1.1', LINE), status: 'untested' as const };
    render(<ul><RequirementLine line={line} selected running={false} canSummon actions={fakeActions({ previewQuantity: (_id, t) => seen.push(t) })} /></ul>);
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Force in line 1.1' }), { key: 'ArrowUp' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/with up to 21\.0+ N for 0\.2 s/);
  });
});

describe('LiveSentence', () => {
  function rig() {
    const root = document.createElement('div');
    root.innerHTML = '<ul><li class="golem-line golem-line-selected"><p class="golem-sentence">x</p></li></ul>';
    document.body.appendChild(root);
    return { root, p: root.querySelector('.golem-sentence') as HTMLElement, live: new LiveSentence(root) };
  }
  it('writes the three variables on the selected sentence and clears them at rest', () => {
    const { p, live } = rig();
    live.write(4.26, 0.5, 0.25);
    expect(p.style.getPropertyValue('--golem-tilt')).toBe('4.3');
    expect(p.style.getPropertyValue('--golem-fuse')).toBe('0.500');
    expect(p.style.getPropertyValue('--golem-force')).toBe('0.250');
    expect(p.dataset['golemLive']).toBe('1');
    live.rest();
    expect(p.style.getPropertyValue('--golem-tilt')).toBe('');
    expect(p.dataset['golemLive']).toBeUndefined();
  });
  it('does not rewrite a value that moved less than a display step', () => {
    const { p, live } = rig();
    live.write(4, 0.5, 0.25);
    p.style.setProperty('--golem-tilt', 'mark');
    live.write(4.04, 0.501, 0.251);
    expect(p.style.getPropertyValue('--golem-tilt')).toBe('mark');
  });
});

describe('ShoveController preview', () => {
  function rig() {
    const raf = new FakeRaf();
    const sched = new RenderScheduler({ raf: raf.raf, caf: raf.caf }, () => {});
    const mj = new FakeMj(3);
    mj.data.xipos.set([0, 0, 0, 1, 2, 0.7, 0, 0, 0]);
    const app: RobotApp = {
      id: 'f', name: 'F', files: async () => ({}), sceneFile: 's.xml', simDt: 0.002, controlDt: 0.02, warmup: 0.2,
      lexicon: { robotNames: ['robot'], predicates: [], perturbations: [] }, makeController: () => ({ step() {} }), signals() {},
    };
    const h = new HeroSim({ mj, model: mj.model, data: mj.data, ctx: { mj, model: mj.model, data: mj.data, ids: {} }, app, rng: () => 0.5,
      stepCap: 100, idleSleepMs: 1e9, scheduler: sched, now: () => 0 });
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    document.body.appendChild(host);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    const s = new ShoveController({ THREE, canvas, camera, scene: new THREE.Scene(), hero: h, bodyGroups: [], meshes: [], scheduler: sched,
      announce: () => {}, stiffness: 600, primaryBody: 1, simDt: 0.002, inkColor: '#fff' });
    return { s, raf };
  }
  it('draws the arrow ending at the pushed body, labelled with the force, and hides it on clear', () => {
    const { s, raf } = rig();
    s.preview(1, 250, 0, 0, 0.75);
    expect(raf.pending).toBe(1);
    s.update();
    expect(s.arrow.visible).toBe(true);
    expect(s.label).toBe('250 N');
    expect(s.arrow.position.x).toBeCloseTo(1 - 0.75, 9);
    expect(s.arrow.position.y).toBeCloseTo(2, 9);
    s.clearPreview();
    expect(s.arrow.visible).toBe(false);
    expect(s.liveForce).toBe(0);
  });
});
