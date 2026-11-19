import { readFileSync } from 'node:fs';
import { compileRequirement, compileRequirementsFile, extractCriteria, tokenize } from 'golem-spec';
import { describe, expect, it } from 'vitest';
import { lexicon } from '../lexicon';

const FILE = new URL('../.kiro/specs/g1-walking/requirements.md', import.meta.url);
const text = readFileSync(FILE, 'utf8');
const criteria = extractCriteria(text).criteria;
const byId = Object.fromEntries(criteria.map((c) => [c.id, c.text]));

/** Expected_Hold / Expected_Break marks from the Glossary table, by criterion id. */
function marks(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/^\|\s*(\d+\.\d+)\s*\|[^|]*\|\s*(Expected_Hold|Expected_Break)\s*\|/gm)) out[m[1]!] = m[2]!;
  return out;
}

describe('g1-walking requirements file', () => {
  it('has an Introduction, a Glossary and numbered requirements with user stories', () => {
    expect(text).toMatch(/^## Introduction$/m);
    expect(text).toMatch(/^## Glossary$/m);
    const reqs = [...text.matchAll(/^### Requirement (\d+): /gm)].map((m) => Number(m[1]));
    expect(reqs).toEqual(reqs.map((_, i) => i + 1));
    expect(reqs.length).toBeGreaterThanOrEqual(6);
    const stories = text.match(/^\*\*User Story:\*\* As an? .+, I want .+, so that .+$/gm) ?? [];
    expect(stories.length).toBe(reqs.length);
    expect((text.match(/^#### Acceptance Criteria$/gm) ?? []).length).toBe(reqs.length);
  });

  it('extracts every numbered criterion as an EARS line with its Kiro id first', () => {
    expect(extractCriteria(text).diagnostics).toEqual([]);
    expect(criteria.map((c) => c.id)).toEqual(['1.1', '1.2', '1.3', '2.1', '2.2', '3.1', '4.1', '4.2', '5.1', '6.1', '6.2']);
    for (const c of criteria) {
      const line = text.split(/\r?\n/)[c.line - 1]!;
      expect(line).toMatch(new RegExp(`^${c.id.split('.')[1]}\\. (WHEN|WHILE|IF|WHERE|THE) `));
    }
  });

  it('covers push recovery, speed tracking, slopes, payload, slipping and sensor latency', () => {
    const all = criteria.map((c) => c.text).join('\n');
    for (const phrase of ['is pushed with', 'track the commanded speed', 'slope of', 'payload of', 'floor friction drops to', 'sensor latency rises to']) {
      expect([phrase, all.includes(phrase)]).toEqual([phrase, true]);
    }
  });

  it('gives every number in an EARS line a unit', () => {
    for (const c of criteria) {
      const toks = tokenize(c.text).tokens;
      toks.forEach((t, i) => {
        if (t.type !== 'number') return;
        expect([c.id, t.text, toks[i + 1]?.type]).toEqual([c.id, t.text, 'unit']);
      });
    }
  });

  it('marks every criterion Expected_Hold or Expected_Break outside the EARS lines', () => {
    const m = marks();
    expect(Object.keys(m).sort()).toEqual(criteria.map((c) => c.id).sort());
    for (const c of criteria) expect(c.text).not.toMatch(/Expected|hold|break/i);
    const breaks = Object.values(m).filter((v) => v === 'Expected_Break').length;
    expect(breaks).toBeGreaterThanOrEqual(2);
  });

  it('holds a push-recovery Expected_Hold line and a speed-tracking Expected_Hold line on level ground', () => {
    const m = marks();
    expect(m['1.1']).toBe('Expected_Hold');
    expect(byId['1.1']).toMatch(/^WHEN the pelvis is pushed with up to \d+ N for 0\.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s$/);
    expect(m['2.1']).toBe('Expected_Hold');
    expect(byId['2.1']).toMatch(/^THE robot SHALL track the commanded speed within [\d.]+ m\/s$/);
  });

  it('expects a 250 N push from behind for 0.2 s to break the stay-upright line', () => {
    expect(marks()['1.2']).toBe('Expected_Break');
    expect(byId['1.2']).toBe('WHEN the pelvis is pushed with up to 250 N for 0.2 s from behind at any point in its stride THE robot SHALL stay upright for 3 s');
  });

  it('compiles every line against the lexicon', () => {
    for (const c of criteria) {
      const r = compileRequirement(c.text, lexicon, { id: c.id });
      const why = r.diagnostics.map((d) => `${d.message}${d.suggestion ? ` (suggestion: ${d.suggestion})` : ''}`).join('; ');
      expect(r.requirement, `${c.id}: ${c.text}\n  ${why}`).toBeDefined();
    }
    const file = compileRequirementsFile(text, lexicon);
    expect(file.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(file.requirements.map((r) => r.id)).toEqual(criteria.map((c) => c.id));
  });

  it('gives each compiled line perturbations or a ubiquitous pattern, a finite positive horizon and ordered ranges', () => {
    for (const r of compileRequirementsFile(text, lexicon).requirements) {
      expect([r.id, r.perturbations.length > 0 || r.pattern === 'ubiquitous']).toEqual([r.id, true]);
      expect([r.id, Number.isFinite(r.horizon) && r.horizon > 0]).toEqual([r.id, true]);
      for (const d of r.space.dims) expect([r.id, d.name, d.min <= d.max]).toEqual([r.id, d.name, true]);
    }
  });
});
