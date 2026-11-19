// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuantityControl } from '../tablet/quantity-control.js';
import { LineEditor } from '../tablet/line-editor.js';
import { RequirementLine } from '../tablet/requirement-line.js';
import { EMPTY_TEXT, NO_POOL_TEXT, Tablet } from '../tablet/tablet.js';
import { segmentLine } from '../tablet/segments.js';
import { compiledLine, fakeActions, syncStore } from './generators/actions.js';
import { GOOD_LINE } from './generators/lexicon.js';
import type { LineModel, Verdict } from '../types.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

// jsdom has no PointerEvent; a MouseEvent with a pointerId is enough for these handlers.
if (typeof window !== 'undefined' && !('PointerEvent' in window)) {
  class PE extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PE;
}

const force = segmentLine('with 200 N')[1]!.q!;
const verdict = (status: Verdict['status']): Verdict => ({
  reqId: '1.1', status, trials: 480, randomTrials: 400, guidedTrials: 80, closest: { robustness: 0.12, scenario: {}, seed: 1 }, ms: 1000,
});

describe('QuantityControl', () => {
  it('exposes spinbutton ARIA attributes', () => {
    render(<QuantityControl info={force} label="Force of the push" onCommit={() => {}} />);
    const sb = screen.getByRole('spinbutton', { name: 'Force of the push' });
    expect(sb.getAttribute('aria-valuenow')).toBe('200');
    expect(sb.getAttribute('aria-valuemin')).toBe('0');
    expect(sb.getAttribute('aria-valuemax')).toBeNull();
    expect(sb.getAttribute('aria-valuetext')).toBe('200 N');
    expect(sb.getAttribute('tabindex')).toBe('0');
  });
  it('steps with ArrowUp and ArrowDown, times 10 with Shift, and commits after 80 ms', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(<QuantityControl info={force} label="Force" onCommit={onCommit} />);
    const sb = screen.getByRole('spinbutton');
    fireEvent.keyDown(sb, { key: 'ArrowUp' });
    expect(sb.textContent).toBe('201 N');
    fireEvent.keyDown(sb, { key: 'ArrowDown', shiftKey: true });
    expect(sb.textContent).toBe('191 N');
    expect(onCommit).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(80); });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('191 N', 191);
  });
  it('drags one step per 4 px', () => {
    render(<QuantityControl info={force} label="Force" onCommit={() => {}} />);
    const sb = screen.getByRole('spinbutton');
    fireEvent.pointerDown(sb, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(sb, { pointerId: 1, clientX: 141 });
    expect(sb.textContent).toBe('210 N');
    fireEvent.pointerUp(sb, { pointerId: 1, clientX: 141 });
  });
  it('rejects a force typed with a time unit', () => {
    const onCommit = vi.fn();
    render(<QuantityControl info={force} label="Force" onCommit={onCommit} />);
    fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' });
    const input = screen.getByRole('textbox', { name: 'Force' });
    fireEvent.change(input, { target: { value: '200 s' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('status').textContent).toBe('Write a force: 200 N, not 200 s');
    expect(screen.getByRole('spinbutton').textContent).toBe('200 N');
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('LineEditor', () => {
  const compile = fakeActions().compile;
  it('restores the previous text on Escape', () => {
    const onCancel = vi.fn(), onCommit = vi.fn();
    render(<LineEditor lineId="1.1" text={GOOD_LINE} compile={(t) => compile('1.1', t)} onCommit={onCommit} onCancel={onCancel} />);
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: 'garbage' } });
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
  it('sets aria-invalid while an error diagnostic exists and replaces the line with the suggestion', () => {
    const bad = GOOD_LINE.replace('keep the bob within', 'keep the bobb within');
    const onCommit = vi.fn();
    render(<LineEditor lineId="1.1" text={bad} compile={(t) => compile('1.1', t)} onCommit={onCommit} onCancel={() => {}} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.getAttribute('aria-invalid')).toBe('true');
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Use suggestion/ }));
    expect(ta.value).toBe(GOOD_LINE);
    expect(ta.getAttribute('aria-invalid')).toBe('false');
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(GOOD_LINE);
  });
  it('writes nothing to disk', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.resolve(__dirname, '../tablet');
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/node:fs|writeFile|showSaveFilePicker|createWritable/);
    }
    const onCommit = vi.fn();
    render(<LineEditor lineId="1.1" text={GOOD_LINE} compile={(t) => compile('1.1', t)} onCommit={onCommit} onCancel={() => {}} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(GOOD_LINE);
  });
});

const lineWith = (over: Partial<LineModel>): LineModel => ({ ...compiledLine('1.1', GOOD_LINE), ...over });

describe('RequirementLine', () => {
  const renderLine = (line: LineModel, running = false) =>
    render(<ul><RequirementLine line={line} selected running={running} canSummon actions={fakeActions()} /></ul>);
  it('shows the status text of each state', () => {
    const cases: [Partial<LineModel>, string][] = [
      [{ status: 'untested' }, 'Not tested yet'],
      [{ status: 'running', progress: { trials: 37 } }, 'Running: 37 trials'],
      [{ status: 'held', verdict: verdict('held'), unit: 'm' }, 'Held: no counterexample found in 480 trials, closest call 0.12 m'],
      [{ status: 'broken', summary: 'falls from 168 N at 135 deg' }, 'Broken: falls from 168 N at 135 deg'],
      [{ status: 'error', error: 'Worker 2 crashed' }, 'Error: Worker 2 crashed'],
    ];
    for (const [over, text] of cases) {
      const { container, unmount } = renderLine(lineWith(over));
      expect(container.querySelector('.golem-status-text')!.textContent).toBe(text);
      expect(container.querySelector('.golem-status-shape')!.textContent).not.toBe('');
      unmount();
    }
  });
  it('draws the fracture only when broken and no check mark when held', () => {
    const b = renderLine(lineWith({ status: 'broken', summary: 'x' }));
    expect(b.container.querySelectorAll('.golem-fracture')).toHaveLength(1);
    b.unmount();
    const h = renderLine(lineWith({ status: 'held', verdict: verdict('held') }));
    expect(h.container.querySelectorAll('.golem-fracture')).toHaveLength(0);
    expect(h.container.textContent).not.toMatch(/✓|✔|proved|verified/);
  });
  it('names the line by ID and text and marks the selected one', () => {
    const { container } = renderLine(lineWith({}));
    const li = container.querySelector('li')!;
    expect(li.getAttribute('aria-current')).toBe('true');
    expect(document.getElementById(li.getAttribute('aria-labelledby')!)!.textContent).toBe(`1.1 ${GOOD_LINE}`);
    expect(document.getElementById(li.getAttribute('aria-describedby')!)!.textContent).toContain('Not tested yet');
  });
  it('says "Stop the run" while its run is active', () => {
    renderLine(lineWith({ status: 'running' }), true);
    expect(screen.getByRole('button', { name: 'Stop the run' })).toBeTruthy();
  });
});

describe('Tablet', () => {
  it('lists lines in file order with their group headings', () => {
    const store = syncStore({ lines: [compiledLine('2.1', GOOD_LINE, 'Requirement 2: Bob'), compiledLine('1.4', GOOD_LINE, 'Requirement 2: Bob'), compiledLine('3.1', GOOD_LINE, 'Requirement 3')] });
    const { container } = render(<Tablet store={store} actions={fakeActions()} />);
    expect([...container.querySelectorAll('.golem-line-id')].map((b) => b.textContent)).toEqual(['2.1', '1.4', '3.1']);
    expect([...container.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Requirement 2: Bob', 'Requirement 3']);
    expect(screen.getByRole('complementary', { name: 'Requirements' })).toBeTruthy();
  });
  it('shows the empty message', () => {
    render(<Tablet store={syncStore({ lines: [] })} actions={fakeActions()} />);
    expect(screen.getByText(EMPTY_TEXT)).toBeTruthy();
  });
  it('disables Summon with a message when no pool is configured', () => {
    render(<Tablet store={syncStore({ lines: [compiledLine('1.1', GOOD_LINE)], poolConfigured: false })} actions={fakeActions()} />);
    expect(screen.getByText(NO_POOL_TEXT)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Summon 64 ghosts for every line' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Summon 64 ghosts' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('re-renders a status change from the store', async () => {
    const store = syncStore({ lines: [compiledLine('1.1', GOOD_LINE)] });
    const { container } = render(<Tablet store={store} actions={fakeActions()} />);
    await act(async () => { store.setLine('1.1', { status: 'running', progress: { trials: 5 } }); await Promise.resolve(); });
    expect(container.querySelector('.golem-status-text')!.textContent).toBe('Running: 5 trials');
  });
});
