// The yard page: the stance rose drawing and the page read from apps/yard/board.json.
import { describe, expect, it } from 'vitest';
import { crosscheckSection, findings, roseSvg, sideName, yardPage, yardStudioPage, type YardBoard, type YardRow } from '../src/pages/yard';
import { readRepoJson } from '../src/build/repo';
import { PAGE_ENTRIES, YARD_IDS } from '../src/build/pages-plugin';
import { SITEMAP, countWord } from '../src/build/layout';

const row = (rose: YardRow['rose'], weakest: YardRow['weakest']): YardRow => ({
  id: 'x', name: 'Test Dog', kind: 'quadruped', folder: 'x', lines: [], rose, weakest, strongestBreak: null, seconds: { verdicts: 1, rose: 1 },
});

describe('sideName', () => {
  it('names the eight sides, 0 the front and 90 the left', () => {
    expect(sideName(0)).toBe('the front');
    expect(sideName(90)).toBe('the left');
    expect(sideName(180)).toBe('behind');
    expect(sideName(270)).toBe('the right');
    expect(sideName(315)).toBe('front right');
    expect(sideName(-90)).toBe('the right');
    expect(sideName(352)).toBe('the front');
  });
});

describe('roseSvg', () => {
  it('draws one point per direction and says the weakest push in its label', () => {
    const svg = roseSvg(row([{ deg: 0, breaks: 1 }, { deg: 90, breaks: 0.5 }, { deg: 180, breaks: null }, { deg: 270, breaks: 0.6 }], { deg: 90, breaks: 0.5 }));
    expect(svg.match(/class="dot/g)).toHaveLength(4);
    expect(svg).toContain('aria-label="Test Dog: the smallest push that topples it is 50% of its weight from the left."');
    expect(svg).toContain('class="dot held-dot"');
    expect(svg).toContain('class="weak-ray"');
    // the front is up: the 100% point straight ahead sits at the top of the outer ring
    expect(svg).toMatch(/<circle class="dot" cx="130\.0" cy="26\.0"/);
  });

  it('draws a fallen robot as a dot at the centre, with no rose', () => {
    const svg = roseSvg(row([{ deg: 0, breaks: 0 }, { deg: 90, breaks: 0 }], { deg: 0, breaks: 0 }));
    expect(svg).toContain('class="fallen"');
    expect(svg).not.toContain('class="rose"');
    expect(svg).toContain('falls with no push at all');
  });
});

describe('the yard pages', () => {
  it('registers one studio page per yard robot', () => {
    expect(YARD_IDS.length).toBeGreaterThanOrEqual(7);
    for (const id of YARD_IDS) expect(PAGE_ENTRIES.some((e) => e.file === `yard/${id}/index.html`)).toBe(true);
  });

  it('renders the board, the roses and the five lines from the committed board.json', () => {
    const p = yardPage();
    expect(p.path).toBe('/yard/');
    expect(p.body).toContain('id="board"');
    expect(p.body.match(/class="rose-card"/g)?.length).toBeGreaterThanOrEqual(1);
    expect(p.body.match(/<li><span class="mono muted">/g)).toHaveLength(5);
  });

  it('says the robot count from robots.json, not a number typed into the text', () => {
    const n = readRepoJson<{ robots: unknown[] }>('apps/yard/robots.json').robots.length;
    const p = yardPage();
    expect(n).toBeGreaterThanOrEqual(8);
    expect(countWord(n)).toBe('eight');
    expect(p.title).toBe('The yard: one spec, ' + countWord(n) + ' robots');
    expect(p.body).toContain('One requirements file, ' + countWord(n) + ' robots. GOLEM fetched ' + countWord(n) + ' models');
    expect(p.body).toContain('<b>' + n + '</b><span>Menagerie robots');
    expect(SITEMAP.find((s) => s.href === '/yard/')?.note).toBe('One spec on ' + countWord(n) + ' Menagerie robots');
    expect(YARD_IDS).toHaveLength(n);
    expect(YARD_IDS).toContain('apollo');
  });

  it('gives each studio page its robot and a switcher with the current robot marked', () => {
    const p = yardStudioPage('go1');
    expect(p.body).toContain('data-studio="yard" data-robot="go1"');
    expect(p.body).toMatch(/href="\/yard\/go1\/" aria-current="page"/);
    expect(p.modules).toEqual(['/src/studio/load.ts']);
  });
});

describe('the findings and the search-versus-rose table', () => {
  const board = readRepoJson<YardBoard>('apps/yard/board.json');

  it('are computed from the committed board', () => {
    const f = findings(board.robots);
    expect(f).toContain('Dogs fall sideways');
    expect(f).toContain('cannot stand on stock servos');
    const g1 = board.robots.find((r) => r.id === 'g1')!;
    expect(f).toContain(`topples at ${Math.round(g1.weakest!.breaks * 1000) / 10}% of its weight`);
  });

  it('lists a counterexample and the weakest push for every robot that stands', () => {
    const html = crosscheckSection(board.robots);
    const standing = board.robots.filter((r) => r.weakest && r.weakest.breaks > 0).length;
    expect((html.match(/<tr>/g) ?? []).length).toBe(standing + 1);
    expect(html).toContain('An independent re-measurement');
    expect(html).toMatch(/within \d+(\.\d)?% of the weight/);
  });

  it('falls back to no findings for an empty board', () => {
    expect(findings([])).toBe('');
    expect(row([], null).rose).toEqual([]);
  });
});
