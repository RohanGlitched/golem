// golem-gate-hardening task 11 (defect 11): source that parses but that nobody reads, and the committed Expectation tables.
import fc from 'fast-check';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GREEN_REQUIREMENTS, RED_REQUIREMENTS, createHarness } from '../../../test/support/harness.js';
import { TINY_IDS, tableText } from '../../../test/support/table-gen.js';
import { readExpectations } from '../expectation.js';

const SRC = fileURLToPath(new URL('../..', import.meta.url));
const REPO = fileURLToPath(new URL('../../../..', import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__') out.push(...sources(p)); } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('source hygiene of the gate', () => {
  it('has no line that closes a block, leaves two spaces and goes on with another closer or an else (`}  } else if`)', () => {
    const bad: string[] = [];
    for (const dir of [join(SRC, 'cli'), join(SRC, 'mcp')]) {
      for (const f of sources(dir)) {
        readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          if (/^\s*\}\s{2,}(?:\}|else\b|catch\b|finally\b)/.test(line)) bad.push(`${relative(SRC, f)}:${i + 1}`);
        });
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('the Expectation tables of the committed requirements files', () => {
  const files: [string, string, string[]][] = [
    ['apps/stagger/.kiro/specs/g1-walking/requirements.md', 'stagger', ['1.2', '4.2', '6.2']],
    ['apps/candy/.kiro/specs/candy-sorter/requirements.md', 'candy', ['1.1', '8.1']],
  ];

  it.each(files)('%s: every row is a criterion, every criterion has a row, and the Expected_Break lines are the documented ones', (rel, _app, breaks) => {
    const path = join(REPO, rel);
    expect(existsSync(path), `${rel} is part of the repository`).toBe(true);
    const text = readFileSync(path, 'utf8');
    const t = readExpectations({ [rel]: text }, [rel]);
    expect(t.issues).toEqual([]);
    expect(t.tables).toBe(1);
    expect([...t.byId].filter(([, v]) => v === 'Expected_Break').map(([k]) => k)).toEqual(breaks);
    const ids = new Set(t.rows.map((r) => r.id));
    expect(ids.size).toBe(t.rows.length);
  });
});

describe('an explicit Expected_Hold row equals no row (property)', () => {
  const strip = (v: { ms?: number }[]): unknown[] => v.map(({ ms: _ms, ...rest }) => rest);

  it('changes neither the exit code, nor the output, nor the verdict list', async () => {
    await fc.assert(fc.asyncProperty(fc.constantFrom(RED_REQUIREMENTS, GREEN_REQUIREMENTS), fc.subarray([...TINY_IDS]), async (requirements, some) => {
      const plain = createHarness({ requirements });
      const a = await plain.run('gate', '--budget', '12');
      const rows = [...TINY_IDS].map((id) => [id, 'Expected_Hold'] as const).filter(([id]) => some.length === 0 || some.includes(id));
      fc.pre(rows.length > 0);
      const marked = createHarness({ requirements: requirements.replace('### Requirement 1', `${tableText(rows as never)}\n### Requirement 1`) });
      const b = await marked.run('gate', '--budget', '12');
      expect(b).toBe(a);
      expect(marked.io.stdoutText()).toBe(plain.io.stdoutText());
      expect(strip(marked.report().verdicts)).toEqual(strip(plain.report().verdicts));
      expect(marked.report().meta.lastGateExitCode).toBe(plain.report().meta.lastGateExitCode);
    }), { numRuns: 100 });
  });
});
