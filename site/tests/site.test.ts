import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, SITE_DIR, SiteDataError, loadSiteData, parseJsonl, validateMapCells } from '../src/build/data';
import { earsHtml, esc, slug } from '../src/build/html';
import { clip, excerpt, mcpCallBlock, parseTranscript } from '../src/build/transcript';
import { DEFAULT_SPEC, fromPolar, polarPoint, radiusOf } from '../src/figures/polar';
import { headlineNumbers } from '../src/pages/home';
import { parseNeedle, reportBullets } from '../src/pages/evidence';
import { renderPage } from '../src/pages';

const data = loadSiteData();

describe('polar geometry', () => {
  it('keeps every point inside the outer ring', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 360, noNaN: true }), fc.double({ min: 0, max: 5000, noNaN: true }), (deg, n) => {
      const p = polarPoint(DEFAULT_SPEC, deg, n);
      expect(Math.hypot(p.x - DEFAULT_SPEC.cx, p.y - DEFAULT_SPEC.cy)).toBeLessThanOrEqual(DEFAULT_SPEC.radius + 1e-9);
    }));
  });
  it('round-trips direction and force below the ring', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 359.9, noNaN: true }), fc.double({ min: 1, max: 300, noNaN: true }), (deg, n) => {
      const p = polarPoint(DEFAULT_SPEC, deg, n);
      const q = fromPolar(DEFAULT_SPEC, p.x, p.y);
      const dd = Math.abs(((q.dirDeg - deg + 540) % 360) - 180);
      expect(dd).toBeLessThan(1e-6);
      expect(Math.abs(q.forceN - n)).toBeLessThan(1e-6);
    }));
  });
  it('puts 0 deg at the top and 90 deg to the right', () => {
    expect(polarPoint(DEFAULT_SPEC, 0, 300).y).toBeLessThan(DEFAULT_SPEC.cy);
    expect(polarPoint(DEFAULT_SPEC, 90, 300).x).toBeLessThan(DEFAULT_SPEC.cx);
    expect(radiusOf(DEFAULT_SPEC, -5)).toBe(0);
  });
});

describe('html helpers', () => {
  it('escapes markup in any text', () => {
    fc.assert(fc.property(fc.string(), (s) => { expect(esc(s)).not.toMatch(/[<>"']/); }));
  });
  it('never emits an unescaped tag from an EARS line', () => {
    fc.assert(fc.property(fc.string(), (s) => { expect(earsHtml(s).replace(/<\/?span[^>]*>/g, '')).not.toMatch(/</); }));
  });
  it('makes a non-empty ASCII slug', () => {
    fc.assert(fc.property(fc.string(), (s) => { expect(slug(s)).toMatch(/^[a-z0-9-]+$/); }));
  });
});

describe('transcript and excerpts', () => {
  const sections = parseTranscript(data.transcriptMd);
  it('finds the recorded commands in the transcript', () => {
    expect(sections.map((s) => s.command)).toEqual(expect.arrayContaining(['golem check', 'golem gate']));
  });
  it('records both gate runs, the default one red and the reflex one green', () => {
    const red = sections.find((s) => s.command === 'golem gate');
    const green = sections.find((s) => s.command === 'GOLEM_REFLEX=kiro golem gate');
    expect(red?.title).toMatch(/\(exit 2, \d+ s\)/);
    expect(red?.code).toMatch(/gate RED: \d+ of \d+/);
    expect(green?.title).toMatch(/\(exit 0, \d+ s\)/);
    expect(green?.code).toContain('gate GREEN');
  });
  it('has a golem mcp section whose falsify call has a summary and a JSON line', () => {
    const mcp = sections.find((s) => s.command === 'golem mcp');
    const call = mcpCallBlock(mcp?.code ?? '', 'falsify', 400).split('\n');
    expect(call).toHaveLength(3);
    expect(call[0]).toMatch(/^> tools\/call falsify /);
    expect(call[2]).toMatch(/^\{/);
  });
  it('mcpCallBlock is empty for a tool that was not called and never longer than 3 lines', () => {
    expect(mcpCallBlock('> tools/list\n  a: b', 'falsify', 100)).toBe('');
    fc.assert(fc.property(fc.array(fc.string({ maxLength: 30 }).filter((l) => !l.includes('\n')), { maxLength: 8 }), (lines) => {
      expect(mcpCallBlock(['> tools/call falsify {}', ...lines].join('\n'), 'falsify', 20).split('\n').length).toBeLessThanOrEqual(3);
    }));
  });  it('never cuts a line and counts what it left out', () => {
    fc.assert(fc.property(fc.array(fc.string({ maxLength: 20 }).filter((l) => !l.includes('\n')), { minLength: 1, maxLength: 30 }), fc.integer({ min: 1, max: 40 }), (lines, max) => {
      const ex = excerpt(lines.join('\n'), max);
      expect(ex.text.split('\n').length + ex.omitted).toBe(lines.length);
    }));
  });
  it('marks a clipped line with its omitted length', () => {
    expect(clip('x'.repeat(30), 10)).toContain('[20 more characters not shown]');
    expect(clip('short', 10)).toBe('short');
  });
});

describe('evidence data', () => {
  it('names the file when a row is malformed', () => {
    expect(() => parseJsonl('{"a":1}\nnope', 'f.jsonl')).toThrow(/f\.jsonl: line 2/);
    expect(() => validateMapCells([{ dirDeg: 0, phase: 0, seed: 1, heldN: 10, brokeN: 5, trials: 9 }], 'm.jsonl')).toThrow(SiteDataError);
  });
  it('draws the home headline numbers from the summary files', () => {
    const h = headlineNumbers(data);
    expect(h.weakN).toBe(data.map.meta.weakest.minHeldN);
    expect(h.weakDir).toBe(80);
    expect(h.weakN).toBe(62.5);
    expect(h.strongN).toBeCloseTo(240.6, 1);
    expect(h.candyBroken).toBe(data.candy.broken);
  });
  it('draws the hover numbers from site/data/hover.json, which is read from the committed CLI output', () => {
    const h = headlineNumbers(data).hover;
    const l13 = data.hover.lines.find((l) => l.id === '1.3')!;
    expect(h.lines).toBe(data.hover.lines.length);
    expect(h.expectedBreaks).toBe(data.hover.lines.filter((l) => l.expectation === 'Expected_Break').length);
    expect(h.expectedBreaks).toBeGreaterThan(0);
    // the smallest gust that broke line 1.3 is below the gust that line 1.3 asks the drone to survive
    expect(h.breakN).toBeLessThan(h.askN);
    expect(l13.counterexamples.some((c) => c.includes(String(h.breakN)))).toBe(true);
    expect(h.lagBreakS).toBeLessThan(h.lagAskS);
    expect(h.smallMarginM).toBeGreaterThan(0);
    expect(data.hover.lines.every((l) => l.expectationMet)).toBe(true);
  });
  it('has a hover.json that matches the transcript and the spec it names', () => {
    const transcript = readFileSync(path.join(REPO_ROOT, data.hover.source.transcript), 'utf8');
    const spec = readFileSync(path.join(REPO_ROOT, data.hover.source.spec), 'utf8');
    for (const l of data.hover.lines) {
      expect(spec).toContain(l.source);
      expect(spec).toContain(`| ${l.id} |`);
      expect(spec).toMatch(new RegExp(`\\|\\s*${l.id.replace('.', '\\.')}\\s*\\|[^|]*\\|\\s*${l.expectation}\\s*\\|`));
      for (const r of data.hover.runs) {
        const res = r.results[l.id]!;
        // the verdict line of that run, in the transcript, carries the same status and margin
        const text = `margin ${res.margin > 0 ? '+' : ''}${res.margin} ${res.unit} `;
        expect(transcript.split('\n').some((row) => row.startsWith(`${l.id}  ${res.status.toUpperCase()}  `) && row.includes(text)), `${l.id} ${text}`).toBe(true);
      }
    }
  });
  it('reports the hover numbers that the repository README quotes', () => {
    const readme = readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
    const row = readme.split('\n').find((l) => l.startsWith('| [`apps/hover`]'));
    expect(row).toBeDefined();
    const h = headlineNumbers(data).hover;
    expect(row).toContain(String(h.breakN) + ' N');
    expect(row).toContain(String(h.askN) + ' N');
  });
  it('reads the needle rows: GOLEM 30/30 against random 7/30 at 0.11 %', () => {
    const rows = parseNeedle(data.needleRuns);
    const hard = rows.find((r) => r.margin === 'graded' && r.budget === 400);
    expect(hard).toMatchObject({ randomFound: 7, fullFound: 30, n: 30 });
  });
  it('reads the limits bullets of the report', () => {
    expect(reportBullets(data.reportMd, 'Limits').length).toBeGreaterThan(3);
  });
});

describe('pages', () => {
  it('shows a real MCP call on the kit page', () => {
    const html = renderPage('kit', data).body;
    const after = html.slice(html.indexOf('A call, as recorded in the transcript'));
    expect(after).toContain('tools/call falsify');
    expect(after).toMatch(/Expected_(Hold|Break)/);
  });
  const ids = ['home', 'kit', 'evidence', 'how-kiro', 'notfound', 'stagger', 'candy', 'hover'];
  it.each(ids)('renders %s with one h1 and no stray placeholder', (id) => {
    const html = renderPage(id, data).body;
    expect((html.match(/<h1[ >]/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(/undefined|NaN|\[object/);
  });
});

// The link check needs a build: it is skipped, with a reason, when site/dist does not exist.
const dist = path.join(SITE_DIR, 'dist');
describe.skipIf(!existsSync(path.join(dist, 'index.html')))('built site', () => {
  const htmlFiles = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? htmlFiles(p) : p.endsWith('.html') ? [p] : [];
  });
  const resolves = (url: string): boolean => {
    const clean = url.split('#')[0]!.split('?')[0]!;
    if (clean === '') return true;
    const p = path.join(dist, clean);
    return existsSync(p) && (!statSync(p).isDirectory() || existsSync(path.join(p, 'index.html')));
  };
  it('has every internal href and src resolve to a file, and no foreign origin loads', () => {
    for (const f of htmlFiles(dist)) {
      const html = readFileSync(f, 'utf8');
      for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const url = m[1] as string;
        if (/^(https?:|mailto:|#|data:)/.test(url)) continue;
        expect(resolves(url), `${path.relative(dist, f)} -> ${url}`).toBe(true);
      }
      // rel="canonical" names the page's own public URL; it loads nothing
      for (const m of html.replace(/<link rel="canonical"[^>]*>/g, '').matchAll(/<(?:script|link|img)[^>]+(?:src|href)="(https?:[^"]+)"/g)) {
        expect.fail(`${path.relative(dist, f)} loads a foreign resource ${m[1]}`);
      }
    }
  });
  it('ships both studios and the 404 page', () => {
    for (const f of ['stagger/index.html', 'candy/index.html', 'hover/index.html', 'hover/robot/scene.xml', 'hover/robot/LICENSE.txt', '404.html', 'og.png', 'favicon.svg', 'fonts/Gloock-Regular.ttf']) expect(existsSync(path.join(dist, f)), f).toBe(true);
    void REPO_ROOT;
  });
});
