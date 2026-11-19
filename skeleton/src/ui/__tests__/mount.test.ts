// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { mountStudio } from '../index.js';
import { NOT_ELEMENT } from '../mount.js';
import { EMPTY_TEXT } from '../tablet/tablet.js';
import { NO_WEBGL_TEXT } from '../stage/stage.js';
import { FakeMj, FakePool, FakeRaf, FakeStorage, synthResult } from './fakes.js';
import { GOOD_LINE, lexApp } from './generators/lexicon.js';
import type { RobotApp, StudioOptions } from '../types.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.innerHTML = ''; window.location.hash = ''; });

const MD = `# Requirements

### Requirement 1: Bob

#### Acceptance Criteria

1. ${GOOD_LINE}
2. WHEN the bob is pushed with up to 20 for 0.2 s from any direction THE robot SHALL keep the bob within 0.3 rad
`;

function fakeMjModule(f: FakeMj) {
  return {
    FS: { mkdirTree() {}, writeFile() {} },
    MjModel: { from_xml_path: () => f.model },
    MjData: function MjData() { return f.data; },
    mj_name2id: () => -1, mjtObj: {},
  };
}

const app: RobotApp = { ...lexApp, names: {}, initState: () => {}, makeController: () => ({ step() {} }) };

function fakeRenderer() {
  return { disposed: 0, setPixelRatio() {}, setSize() {}, render() {}, dispose() { this.disposed++; }, info: { render: { calls: 0 } } };
}

async function mount(md = MD, over: StudioOptions = {}, webgl = true) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const raf = new FakeRaf();
  const mj = new FakeMj(3);
  const r = fakeRenderer();
  let h!: ReturnType<typeof mountStudio>;
  await act(async () => {
    h = mountStudio(el, app, md, {
      ...over,
      testHooks: {
        raf: raf.raf, caf: raf.caf, storage: new FakeStorage(), webgl,
        ...(webgl ? { createRenderer: () => r } : {}), loadHero: async () => fakeMjModule(mj),
        ...(over.testHooks ?? {}),
      },
    });
    await Promise.resolve();
  });
  return { el, h, raf, mj, r };
}

describe('mountStudio', () => {
  it('throws a TypeError for a non-element', () => {
    expect(() => mountStudio({} as HTMLElement, app, MD)).toThrow(new TypeError(NOT_ELEMENT));
  });
  it('mounts the empty tablet for markdown with no criterion', async () => {
    const { el, h } = await mount('# Nothing here\n');
    expect(el.textContent).toContain(EMPTY_TEXT);
    act(() => h.dispose());
  });
  it('compiles each criterion and renders the tablet, reel and verdict panel', async () => {
    const { el, h } = await mount();
    const s = h.getState();
    expect(s.lines.map((l) => l.id)).toEqual(['1.1', '1.2']);
    expect(s.lines[0]!.compiled).toBeDefined();
    expect(s.lines[1]!.status).toBe('error');
    expect(el.querySelector('aside[aria-label="Requirements"]')).toBeTruthy();
    expect(el.querySelector('section[aria-label="Counterexample reel"]')).toBeTruthy();
    expect(el.querySelector('section[aria-label="Verdict"]')).toBeTruthy();
    expect(el.querySelector('main')).toBeTruthy();
    act(() => h.dispose());
  });
  it('mounts the panels with a message when WebGL is missing', async () => {
    const { el, h } = await mount(MD, {}, false);
    expect(el.textContent).toContain(NO_WEBGL_TEXT);
    expect(el.querySelector('aside')).toBeTruthy();
    expect(h.getState().hero).toBe('no-webgl');
    await h.ready;
    act(() => h.dispose());
  });
  it('loads the hero, draws a first frame and deletes MuJoCo handles once on dispose', async () => {
    const { h, raf, mj, r, el } = await mount();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(h.getState().hero).toBe('running');
    raf.runNext();
    await h.ready;
    expect(h.getState().stageFrames).toBeGreaterThan(0);
    expect(el.dataset['firstFrame']).toBeDefined();
    act(() => h.dispose());
    act(() => h.dispose());
    expect(mj.deleted).toBe(2);
    expect(r.disposed).toBe(1);
    expect(el.children).toHaveLength(0);
  });
  it('does not close an injected pool and closes a pool it built from workerUrl', async () => {
    const injected = new FakePool((s) => synthResult(s));
    const a = await mount(MD, { pool: injected });
    act(() => a.h.dispose());
    expect(injected.closed).toBe(false);
    const built = new FakePool((s) => synthResult(s));
    const b = await mount(MD, { workerUrl: '/worker.js', testHooks: { createPool: () => built } });
    expect(b.h.getState().poolConfigured).toBe(true);
    act(() => b.h.dispose());
    expect(built.closed).toBe(true);
  });
  it('applies a valid share hash and reports what it ignored', async () => {
    const { shareFragment } = await import('../run/share-hash.js');
    const edited = GOOD_LINE.replace('0.3 rad', '0.25 rad');
    window.location.hash = shareFragment({ lines: { '1.1': edited, '9.9': 'nope' } });
    const { h } = await mount();
    expect(h.getState().lines[0]!.text).toBe(edited);
    expect(h.getState().messages.map((m) => m.text)).toContain('Ignored the shared link: line 9.9, which is not in this file');
    act(() => h.dispose());
  });
});
