import { describe, expect, it } from 'vitest';
import { appendProposal, findDuplicate, formatEntry, normaliseLine, parseEntries } from '../proposals.js';
import { tmpCounter } from '../../cli/store.js';
import { createMemoryFs } from '../../../test/support/memory-fs.js';

const e1 = { timestamp: '2026-10-31T04:00:00.000Z', text: 'WHEN the base is pushed with up to 250 N THE robot SHALL keep its height above 0.4 m for 1 s', rationale: 'a crowd member can lean on the robot' };

describe('proposal entries', () => {
  it('formats the documented list entry', () => {
    expect(formatEntry(e1)).toBe(`- 2026-10-31T04:00:00.000Z\n  EARS: ${e1.text}\n  Rationale: ${e1.rationale}\n`);
  });

  it('parses entries with their line numbers and optional rationale', () => {
    const file = `# Proposals\n\n${formatEntry(e1)}\n${formatEntry({ timestamp: '2026-11-01T00:00:00.000Z', text: 'x' })}`;
    const { entries } = parseEntries(file);
    expect(entries).toEqual([{ ...e1, line: 3 }, { timestamp: '2026-11-01T00:00:00.000Z', text: 'x', line: 7 }]);
  });

  it('collapses whitespace for comparison', () => {
    expect(normaliseLine('  a \t b\n c ')).toBe('a b c');
  });
});

describe('findDuplicate', () => {
  const req = { path: '/r/requirements.md', content: '# R\n\n1. WHEN the base is pushed   with up to 250 N THE robot SHALL keep its height above 0.4 m for 1 s\n' };

  it('finds a requirement line ignoring whitespace and the leading id, naming file and line', () => {
    expect(findDuplicate(e1.text, [req])).toEqual({ path: '/r/requirements.md', line: 3 });
    expect(findDuplicate(`R9. ${e1.text}`, [req])).toEqual({ path: '/r/requirements.md', line: 3 });
  });

  it('finds an earlier proposal', () => {
    const prop = { path: '/r/proposals.md', content: `# P\n\n${formatEntry(e1)}` };
    expect(findDuplicate(e1.text, [prop])).toEqual({ path: '/r/proposals.md', line: 4 });
  });

  it('returns undefined for a new line', () => {
    expect(findDuplicate('THE robot SHALL keep its tilt below 0.2 rad', [req])).toBeUndefined();
  });
});

describe('appendProposal', () => {
  it('creates the directory and the file for the first proposal', async () => {
    const fs = createMemoryFs();
    await appendProposal(fs, '/s/r/proposals.md', e1, tmpCounter());
    const t = fs.text('/s/r/proposals.md') as string;
    expect(t.startsWith('# Proposed requirements')).toBe(true);
    expect(parseEntries(t).entries).toHaveLength(1);
  });

  it('keeps earlier entries and adds one', async () => {
    const fs = createMemoryFs();
    await appendProposal(fs, '/p.md', e1, tmpCounter());
    await appendProposal(fs, '/p.md', { ...e1, text: 'second' }, tmpCounter('b'));
    expect(parseEntries(fs.text('/p.md') as string).entries.map((x) => x.text)).toEqual([e1.text, 'second']);
  });

  it('leaves the old file and removes the temp file when the write fails', async () => {
    const fs = createMemoryFs({ '/p.md': 'old\n' });
    fs.failOn('rename', 'p.md');
    await expect(appendProposal(fs, '/p.md', e1, tmpCounter())).rejects.toThrow('/p.md');
    expect(fs.text('/p.md')).toBe('old\n');
    expect(fs.list()).toEqual(['/p.md']);
  });
});
