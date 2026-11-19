import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseConfirmCheck } from '../src/build/data';

describe('parseConfirmCheck', () => {
  it('reads the rebuilt rows of the committed re-check and skips the rest', () => {
    const md = readFileSync(new URL('../../evidence/results/agent-gate-hard/confirm-check.md', import.meta.url), 'utf8');
    const rows = parseConfirmCheck(md);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.stream).toMatch(/^[AB]-\d+$/);
    expect(new Set(rows.map((r) => r.stream)).size).toBe(rows.length);
  });

  it('keeps only rows with three verdicts', () => {
    const md = [
      '| Stream | Role | Files rebuilt | `gate --no-confirm` | `gate` (new) | independent gate, seed 7919 | recorded |',
      '|---|---|---|---|---|---|---|',
      '| A-1 | claimed success | x.ts | GREEN (exit 0), 3 s | RED (exit 2), 4 s | RED (exit 2), 3 s | RED (exit 2) |',
      '| B-3 | claimed success | not rebuilt | skipped | skipped | skipped | RED (exit 2) |',
      '| A-4 | control (no claim) | x.ts | GREEN (exit 0) | GREEN (exit 0) | GREEN (exit 0) | GREEN (exit 0) |',
    ].join('\r\n');
    expect(parseConfirmCheck(md)).toEqual([
      { stream: 'A-1', claimed: true, quick: 'GREEN', confirmed: 'RED', independent: 'RED' },
      { stream: 'A-4', claimed: false, quick: 'GREEN', confirmed: 'GREEN', independent: 'GREEN' },
    ]);
  });
});
