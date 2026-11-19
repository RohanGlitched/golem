import { readFileSync } from 'node:fs';
import { compileRequirementsFile, extractCriteria } from 'golem-spec';
import { describe, expect, it } from 'vitest';
import { lexicon } from '../lexicon';

const text = readFileSync(new URL('../.kiro/specs/hover-hold/requirements.md', import.meta.url), 'utf8');
const criteria = extractCriteria(text).criteria;

describe('hover-hold requirements file', () => {
  it('has an Introduction, a Glossary and numbered requirements, each with a user story and acceptance criteria', () => {
    expect(text).toMatch(/^## Introduction$/m);
    expect(text).toMatch(/^## Glossary$/m);
    const reqs = [...text.matchAll(/^### Requirement (\d+): /gm)].map((m) => Number(m[1]));
    expect(reqs).toEqual(reqs.map((_, i) => i + 1));
    expect((text.match(/^\*\*User Story:\*\* As an? .+, I want .+, so that .+$/gm) ?? []).length).toBe(reqs.length);
    expect((text.match(/^#### Acceptance Criteria$/gm) ?? []).length).toBe(reqs.length);
  });

  it('extracts six numbered criteria with their Kiro ids, one behaviour per line', () => {
    expect(extractCriteria(text).diagnostics).toEqual([]);
    expect(criteria.map((c) => c.id)).toEqual(['1.1', '1.2', '1.3', '2.1', '3.1', '3.2']);
    for (const c of criteria) {
      expect(text.split(/\r?\n/)[c.line - 1]).toMatch(/^\d\. (WHEN|WHILE|IF|WHERE|THE) /);
      expect(c.segments).toHaveLength(1);
    }
  });

  it('compiles every acceptance criterion against the lexicon with no diagnostic', () => {
    const r = compileRequirementsFile(text, lexicon);
    expect(r.diagnostics).toEqual([]);
    expect(r.requirements.map((q) => q.id)).toEqual(criteria.map((c) => c.id));
  });

  it('gives every number a unit', () => {
    for (const c of criteria) {
      for (const m of c.text.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?:\s*)([A-Za-z%/]*)/g)) {
        expect(m[2], `number ${m[1]} in ${c.id}`).not.toBe('');
      }
    }
  });

  it('has an Expectation row for every criterion, and at least one line that is expected to break', () => {
    const rows = [...text.matchAll(/^\|\s*(\d\.\d)\s*\|[^|]*\|\s*(Expected_Hold|Expected_Break)\s*\|$/gm)].map((m) => [m[1], m[2]]);
    expect(rows.map((r) => r[0])).toEqual(criteria.map((c) => c.id));
    const broken = rows.filter((r) => r[1] === 'Expected_Break').map((r) => r[0]);
    expect(broken).toEqual(['1.3', '3.2']);
  });

  it('says that a broken line is never edited away', () => {
    expect(text).toMatch(/Lines are never edited to make a failing run pass/);
  });

  it('keeps the numbers the README reports: the harshest value in each trigger', () => {
    const all = Object.fromEntries(criteria.map((c) => [c.id, c.text]));
    expect(all['1.1']).toBe('WHEN a gust of up to 2 N hits it for 0.5 s from any direction THE drone SHALL stay within 0.25 m of its hover point for 4 s');
    expect(all['1.2']).toContain('up to 3 N');
    expect(all['1.3']).toContain('up to 20 N');
    expect(all['2.1']).toContain('60% to 100%');
    expect(all['3.1']).toContain('lags by up to 0.10 s');
    expect(all['3.2']).toContain('lags by up to 0.30 s');
  });

  it('measures the README table with the same lines: every line in the README is a line of the file', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    for (const c of criteria) expect(readme, c.id).toMatch(new RegExp(`^\\| ${c.id.replace('.', '\\.')} \\|`, 'm'));
  });
});
