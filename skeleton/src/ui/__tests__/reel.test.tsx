// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as THREE from 'three';
import { FilmstripRenderer, filmstripFrames, frameLabel } from '../reel/filmstrip.js';
import { NO_CE_TEXT, Reel } from '../reel/reel.js';
import { PinnedSeedStore } from '../run/pins.js';
import { FakeRaf, FakeStorage, synthPoses } from './fakes.js';
import { compiledLine, fakeActions, syncStore } from './generators/actions.js';
import { GOOD_LINE } from './generators/lexicon.js';
import type { ReelData } from '../tablet/actions.js';
import type { Counterexample, LineModel } from '../types.js';

afterEach(cleanup);
// jsdom has no 2D canvas; the filmstrip skips drawing when getContext returns null.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

describe('FilmstripRenderer', () => {
  function rig() {
    const raf = new FakeRaf();
    const renders: (THREE.WebGLRenderTarget | null)[] = [];
    let current: THREE.WebGLRenderTarget | null = null;
    const renderer = {
      render: () => { renders.push(current); },
      setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { current = t; },
      getRenderTarget: () => current,
      readRenderTargetPixels: () => {},
    };
    const groups = [new THREE.Group(), new THREE.Group(), new THREE.Group()];
    groups[1]!.position.set(9, 9, 9);
    const ghosts = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
    camera.position.set(3, -3, 2);
    let restored = 0;
    const fr = new FilmstripRenderer({
      THREE, renderer, scene: new THREE.Scene(), mainCamera: camera, bodyGroups: groups, hide: [ghosts],
      restoreLive: () => { restored++; groups[1]!.position.set(9, 9, 9); }, raf: raf.raf, caf: raf.caf, focusBody: 1,
    });
    return { raf, renders, groups, ghosts, camera, fr, restored: () => restored, current: () => current };
  }
  const canvases = () => Array.from({ length: 8 }, () => document.createElement('canvas'));

  it('renders one frame per animation frame into the offscreen target', () => {
    const r = rig();
    const p = synthPoses(3, 31);
    r.fr.start(p.frames, 3, filmstripFrames(0.5, 31, 30), canvases());
    expect(r.renders).toHaveLength(0);
    r.raf.runNext();
    expect(r.renders).toHaveLength(1);
    expect(r.renders[0]).toBeInstanceOf(THREE.WebGLRenderTarget);
    while (r.raf.runNext()) { /* rest */ }
    expect(r.renders).toHaveLength(8);
    expect(r.current()).toBeNull();
  });
  it('restores the live pose and the hidden objects, and leaves the main camera alone', () => {
    const r = rig();
    r.camera.updateMatrixWorld();
    const before = r.camera.matrixWorld.clone();
    const pos = r.camera.position.clone();
    r.fr.start(synthPoses(3, 31).frames, 3, filmstripFrames(0.5, 31, 30), canvases());
    r.raf.runNext();
    expect(r.restored()).toBe(1);
    expect(r.groups[1]!.position.toArray()).toEqual([9, 9, 9]);
    expect(r.ghosts.visible).toBe(true);
    expect(r.camera.position.equals(pos)).toBe(true);
    expect(r.camera.matrixWorld.equals(before)).toBe(true);
  });
  it('draws nothing further after an abort', () => {
    const r = rig();
    const stop = r.fr.start(synthPoses(3, 31).frames, 3, filmstripFrames(0.5, 31, 30), canvases());
    r.raf.runNext();
    stop();
    while (r.raf.runNext()) { /* none */ }
    expect(r.renders).toHaveLength(1);
  });
  it('labels a frame with its time and the body height', () => {
    expect(frameLabel(0.35, 'pelvis', 0.3149)).toBe('Frame at 0.35 s after the push: pelvis 0.31 m above the floor');
  });
});

const ce: Counterexample = { reqId: '1.1', scenario: { 'push.force': 168, 'push.angle': 2.35 }, seed: 7, robustness: -0.04, shrunk: true, foundAfter: 37 };
const broken = (id: string): LineModel => ({ ...compiledLine(id, GOOD_LINE), status: 'broken', counterexample: { ...ce, reqId: id }, summary: 'falls from 168 N' });
const reelData = (): ReelData => ({ poses: synthPoses(3, 31), worstTau: 0.5, entries: filmstripFrames(0.5, 31, 30), labels: Array(8).fill('Frame') });

describe('Reel', () => {
  it('shows the empty message without a broken selected line', () => {
    render(<Reel store={syncStore({ lines: [compiledLine('1.1', GOOD_LINE)], selectedId: '1.1' })} actions={fakeActions()} />);
    expect(screen.getByText(NO_CE_TEXT)).toBeTruthy();
  });
  it('shows the JSON in a selectable field when the clipboard fails', async () => {
    const actions = fakeActions({ copySeed: async () => false, loadReplay: async () => reelData(), summaryOf: () => 'falls from 168 N' });
    render(<Reel store={syncStore({ lines: [broken('1.1')], selectedId: '1.1' })} actions={actions} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy seed' })); await Promise.resolve(); });
    const field = screen.getByRole('textbox', { name: 'Seed JSON' }) as HTMLTextAreaElement;
    expect(JSON.parse(field.value)).toEqual({ ...ce });
  });
  it('stores a pinned seed once when pinned twice', async () => {
    const pins = new PinnedSeedStore(new FakeStorage(), () => {});
    const actions = fakeActions({
      loadReplay: async () => reelData(), summaryOf: () => 'falls',
      pin: (c) => { pins.pin('test', c); }, pinsOf: (id) => pins.read('test', id),
    });
    render(<Reel store={syncStore({ lines: [broken('1.1')], selectedId: '1.1' })} actions={actions} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: 'Pin this seed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pin this seed' }));
    expect(pins.read('test', '1.1')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Remove pin' })).toHaveLength(1);
  });
  it('aborts the pending replay when another line is selected', async () => {
    const signals: AbortSignal[] = [];
    const actions = fakeActions({ loadReplay: (_id, s) => { signals.push(s); return new Promise(() => {}); }, summaryOf: () => 'x' });
    const store = syncStore({ lines: [broken('1.1'), broken('1.2')], selectedId: '1.1' });
    render(<Reel store={store} actions={actions} />);
    await act(async () => { store.update({ selectedId: '1.2' }); await Promise.resolve(); });
    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });
  it('keeps Copy seed and Pin this seed active when the replay trial fails', async () => {
    const actions = fakeActions({ loadReplay: async () => { throw new Error('Worker 1 crashed'); }, summaryOf: () => 'falls from 168 N' });
    render(<Reel store={syncStore({ lines: [broken('1.1')], selectedId: '1.1' })} actions={actions} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText('The replay trial failed: Worker 1 crashed')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Copy seed' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Pin this seed' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('falls from 168 N')).toBeTruthy();
  });
  it('exposes the scrubber as a slider, steps one frame with the arrow keys and goes back to live', () => {
    const actions = fakeActions({ summaryOf: () => 'x', loadReplay: () => new Promise(() => {}) });
    const store = syncStore({
      lines: [broken('1.1')], selectedId: '1.1',
      replay: { active: true, playing: true, t: 0.5, duration: 1, worstTau: 0.4, fps: 30, lineId: '1.1' },
    });
    render(<Reel store={store} actions={actions} />);
    const s = screen.getByRole('slider', { name: 'Replay time' });
    expect(s.getAttribute('aria-valuemin')).toBe('0');
    expect(s.getAttribute('aria-valuemax')).toBe('1');
    expect(s.getAttribute('aria-valuenow')).toBe('0.5');
    expect(s.getAttribute('aria-valuetext')).toBe('0.50 s after the push');
    fireEvent.keyDown(s, { key: 'ArrowRight' });
    fireEvent.keyDown(s, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to live' }));
    expect(actions.calls).toEqual(['stepFrame(1)', 'stepFrame(-1)', 'backToLive()']);
  });
});
