import { readFileSync } from 'node:fs';
import { compileRequirementsFile, extractCriteria } from 'golem-spec';
import { describe, expect, it } from 'vitest';
import { lexicon } from '../lexicon';

const FILE = new URL('../.kiro/specs/candy-sorter/requirements.md', import.meta.url);
const text = readFileSync(FILE, 'utf8');
const criteria = extractCriteria(text).criteria;

describe('candy-sorter requirements file', () => {
  it('has an Introduction, a Glossary and numbered requirements, each with a user story and acceptance criteria', () => {
    expect(text).toMatch(/^## Introduction$/m);
    expect(text).toMatch(/^## Glossary$/m);
    const reqs = [...text.matchAll(/^### Requirement (\d+): /gm)].map((m) => Number(m[1]));
    expect(reqs).toEqual(reqs.map((_, i) => i + 1));
    expect((text.match(/^\*\*User Story:\*\* As an? .+, I want .+, so that .+$/gm) ?? []).length).toBe(reqs.length);
    expect((text.match(/^#### Acceptance Criteria$/gm) ?? []).length).toBe(reqs.length);
  });

  it('extracts every numbered criterion with its Kiro id first, one behaviour per line', () => {
    expect(extractCriteria(text).diagnostics).toEqual([]);
    expect(criteria.map((c) => c.id)).toEqual(['1.1', '2.1', '3.1', '4.1', '5.1', '6.1', '7.1', '8.1']);
    for (const c of criteria) {
      const line = text.split(/\r?\n/)[c.line - 1]!;
      expect(line).toMatch(/^1\. (WHEN|WHILE|IF|WHERE|THE) /);
      expect(c.segments).toHaveLength(1);
    }
  });

  it('compiles every acceptance criterion against the lexicon with no diagnostic', () => {
    const r = compileRequirementsFile(text, lexicon);
    expect(r.diagnostics).toEqual([]);
    expect(r.requirements.map((q) => q.id)).toEqual(criteria.map((c) => c.id));
  });

  it('gives every number a unit, except counts', () => {
    for (const c of criteria) {
      for (const m of c.text.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?:\s*)([A-Za-z%°/]*)/g)) {
        expect(m[2], `number ${m[1]} in ${c.id}`).not.toBe('');
      }
    }
  });

  it('puts the harshest believable values in the triggers', () => {
    const all = criteria.map((c) => c.text).join('\n');
    expect(all).toContain('up to 1.5 m/s');
    expect(all).toContain('0.005 kg to 0.060 kg');
    expect(all).toContain('50% to 100%');
    expect(all).toContain('up to 0.3 s');
  });

  it('marks 1.1 and 8.1 as the lines that are expected to break against SSM_v1, and says that a broken line is never edited away', () => {
    expect(text).toMatch(/\|\s*1\.1\s*\|[^|]*\|\s*Expected_Break\s*\|/);
    expect(text).toMatch(/\|\s*8\.1\s*\|[^|]*\|\s*Expected_Break\s*\|/);
    expect(text).toMatch(/Lines are never edited to make a failing run pass/);
    const sep = criteria.find((c) => c.id === '1.1')!;
    expect(sep.text).toBe('WHEN a hand reaches in from any direction at up to 1.5 m/s THE arm SHALL keep every link at least 0.10 m from the hand');
  });
});
