// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { FOCUS_RING_PX, studioCss } from '../layout/styles.js';
import { THEME_KEY, ThemeController } from '../layout/theme.js';
import { PanelErrorBoundary, RELOAD_PANEL } from '../layout/boundary.js';
import { FakeMatchMedia, FakeStorage } from './fakes.js';
import type { ThemeName } from '../types.js';

afterEach(cleanup);

describe('studio CSS', () => {
  const css = studioCss('/fonts/');
  it('has no gradient outside the stage vignette, no box-shadow, and Gloock only on the selected response clause', () => {
    // The only gradient is the stage's lighting vignette (design-language.md, Layout).
    const withoutVignette = css.replace(/\.golem-stage::after\{[^}]*\}/g, '');
    expect(withoutVignette).not.toMatch(/gradient/i);
    expect(css).toMatch(/\.golem-stage::after\{[^}]*radial-gradient/);
    expect(css).not.toMatch(/box-shadow/i);
    // experience.md 1 (binding) supersedes "Gloock for headlines only": the response clause of the selected
    // requirement is set in Gloock at 39 to 61 px. No other rule uses it.
    const rules = css.split('}').filter((r) => /Gloock/.test(r)).map((r) => r.trim().split('{')[0]);
    expect(rules).toEqual(['@font-face', '.golem-line-selected .golem-response']);
    expect(css).toMatch(/\.golem-line-selected \.golem-response\{[^}]*font-size:clamp\(39px,[^,]+,61px\)/);
  });
  it('makes the stage 56vh in the narrow layout and the tablet 380 px wide otherwise', () => {
    const narrow = css.slice(css.indexOf('@media (max-width:1023.98px)'));
    expect(narrow).toMatch(/\.golem-stage\{grid-area:stage;height:56vh\}/);
    expect(narrow).toMatch(/min-height:44px;min-width:44px/);
    expect(css).toMatch(/grid-template-columns:380px/);
  });
  it('draws a focus ring of at least 2 px', () => {
    expect(FOCUS_RING_PX).toBeGreaterThanOrEqual(2);
    expect(css).toMatch(/:focus-visible\{outline:2px solid var\(--ink\)/);
  });
  it('loads B612 and B612 Mono from the font base URL', () => {
    expect(css).toContain("url('/fonts/B612-Regular.ttf')");
    expect(css).toContain("font-family:'B612 Mono'");
  });
});

function theme(opts: { saved?: string; light?: boolean; dark?: boolean; initial?: ThemeName; storage?: Storage | undefined } = {}) {
  const storage = 'storage' in opts ? opts.storage : new FakeStorage();
  if (opts.saved && storage) storage.setItem(THEME_KEY, opts.saved);
  const mm = new FakeMatchMedia();
  mm.matches['(prefers-color-scheme: light)'] = !!opts.light;
  mm.matches['(prefers-color-scheme: dark)'] = !!opts.dark;
  const applied: ThemeName[] = [];
  const c = new ThemeController({ storage, matchMedia: mm.fn, initial: opts.initial, apply: (t) => applied.push(t) });
  return { c, mm, applied, storage };
}

describe('ThemeController', () => {
  it('prefers the saved choice over the system', () => {
    expect(theme({ saved: 'dark', light: true }).c.theme).toBe('dark');
    expect(theme({ light: true }).c.theme).toBe('light');
    expect(theme({ initial: 'light' }).c.theme).toBe('light');
    expect(theme({}).c.theme).toBe('dark');
  });
  it('follows a system change only while nothing is saved', () => {
    const t = theme({ dark: true });
    t.mm.set('(prefers-color-scheme: light)', true);
    expect(t.c.theme).toBe('light');
    t.c.toggle();
    expect(t.c.theme).toBe('dark');
    expect(t.storage!.getItem(THEME_KEY)).toBe('dark');
    t.mm.set('(prefers-color-scheme: light)', true);
    expect(t.c.theme).toBe('dark');
  });
  it('keeps the choice in memory without storage', () => {
    const t = theme({ storage: undefined });
    expect(t.c.toggle()).toBe('light');
    expect(t.c.toggle()).toBe('dark');
    expect(t.applied).toEqual(['dark', 'light', 'dark']);
  });
});

function Bomb({ boom }: { boom: boolean }): JSX.Element {
  if (boom) throw new Error('kaboom');
  return <p>fine</p>;
}

describe('PanelErrorBoundary', () => {
  it('shows the message and a reload button, remounts only that panel', () => {
    let mounts = 0;
    function Counter() { useEffect(() => { mounts++; }, []); return <p>other panel</p>; }
    let boom = true;
    function Flaky() { return <Bomb boom={boom} />; }
    const orig = console.error; console.error = () => {};
    render(<div>
      <PanelErrorBoundary name="tablet"><Flaky /></PanelErrorBoundary>
      <PanelErrorBoundary name="reel"><Counter /></PanelErrorBoundary>
    </div>);
    console.error = orig;
    expect(screen.getByText('This panel failed to draw: kaboom')).toBeTruthy();
    expect(screen.getByText('other panel')).toBeTruthy();
    boom = false;
    fireEvent.click(screen.getByRole('button', { name: RELOAD_PANEL }));
    expect(screen.getByText('fine')).toBeTruthy();
    expect(mounts).toBe(1);
  });
});
