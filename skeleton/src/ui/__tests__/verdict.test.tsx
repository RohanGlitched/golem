// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { NumberTween } from '../verdict/number-tween.js';
import { VerdictPanel } from '../verdict/verdict-panel.js';
import { verdictRows } from '../verdict/verdict-rows.js';
import { FakeClock, FakeRaf } from './fakes.js';
import { compiledLine, syncStore } from './generators/actions.js';
import { GOOD_LINE } from './generators/lexicon.js';
import type { Verdict } from '../types.js';

afterEach(cleanup);

const v: Verdict = {
  reqId: '1.1', status: 'held', trials: 480, randomTrials: 400, guidedTrials: 80,
  closest: { robustness: 0.1234, scenario: {}, seed: 1 }, failureRateUpper95: 0.00625, ms: 12345,
};

describe('NumberTween', () => {
  it('has the final value in the DOM text at once and tweens only the hidden copy', async () => {
    const raf = new FakeRaf(), clock = new FakeClock();
    const { container, rerender } = render(<NumberTween value={10} raf={raf.raf} caf={raf.caf} now={clock.now} />);
    rerender(<NumberTween value={110} raf={raf.raf} caf={raf.caf} now={clock.now} />);
    expect(container.querySelector('.golem-sr-only')!.textContent).toBe('110');
    clock.advance(125);
    act(() => { raf.runNext(); });
    const visual = Number(container.querySelector('[aria-hidden="true"]')!.textContent);
    expect(visual).toBeGreaterThan(10);
    expect(visual).toBeLessThan(110);
    clock.advance(200);
    act(() => { while (raf.runNext()) { /* finish */ } });
    expect(container.querySelector('[aria-hidden="true"]')!.textContent).toBe('110');
    expect(raf.pending).toBe(0);
  });
  it('shows the value at once under reduced motion', () => {
    const raf = new FakeRaf();
    const { container, rerender } = render(<NumberTween value={1} reduced raf={raf.raf} caf={raf.caf} />);
    rerender(<NumberTween value={99} reduced raf={raf.raf} caf={raf.caf} />);
    expect(container.querySelector('[aria-hidden="true"]')!.textContent).toBe('99');
    expect(raf.pending).toBe(0);
  });
});

describe('VerdictPanel', () => {
  const store = () => syncStore({ lines: [{ ...compiledLine('1.1', GOOD_LINE), status: 'held', verdict: v, unit: 'rad' }], selectedId: '1.1' });
  it('shows the rows of the verdict after formatting', () => {
    const { container } = render(<VerdictPanel store={store()} poolSize={4} budget={{ maxTrials: 240, maxMs: 30000 }} />);
    const want = verdictRows(v, 4, 'rad', { maxTrials: 240, maxMs: 30000 }).rows;
    const got = [...container.querySelectorAll('dl > div')].map((d) => [d.querySelector('dt')!.textContent, (d.querySelector('dd .golem-sr-only') ?? d.querySelector('dd .golem-num'))!.textContent]);
    expect(got).toEqual(want.map((r) => [r.label, r.value]));
    expect(screen.getByRole('region', { name: 'Verdict' })).toBeTruthy();
  });
  it('shows the aura summary as a text line and the held sentence without a proof claim', async () => {
    const s = store();
    const { container } = render(<VerdictPanel store={s} poolSize={4} budget={{ maxTrials: 240 }} />);
    await act(async () => { s.update({ aura: { total: 3, ignored: 0, summary: 'Weakest direction 135 deg: breaks at 168 N' } }); await Promise.resolve(); });
    expect(screen.getByText('Weakest direction 135 deg: breaks at 168 N')).toBeTruthy();
    expect(screen.getByText(/No counterexample found in 480 trials \(400 random, 80 guided\)/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/proved|verified/i);
  });
});
