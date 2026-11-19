import { describe, expect, it } from 'vitest';
import { limitJson, makeToolResult, oneLine } from '../result.js';

describe('oneLine', () => {
  it('collapses line breaks and cuts a long summary to 200 characters', () => {
    expect(oneLine('a\n\n b\r\n c')).toBe('a b c');
    expect(oneLine('x'.repeat(500))).toHaveLength(200);
    expect(oneLine('   ')).toBe('(no summary)');
  });

  it('does not split a surrogate pair at the cut', () => {
    const s = `${'a'.repeat(199)}😀`;
    const t = oneLine(s);
    expect(t).toBe('a'.repeat(199));
  });
});

describe('limitJson', () => {
  it('returns small values unchanged', () => {
    expect(limitJson({ a: [1, 2, 3] })).toEqual({ text: '{"a":[1,2,3]}' });
  });

  it('halves the longest array, keeps leading elements and records the counts', () => {
    const big = { samples: Array.from({ length: 5000 }, (_, i) => ({ t: i, v: i * 1.5 })), note: 'x' };
    const r = limitJson(big, 4000);
    expect(new TextEncoder().encode(r.text).length).toBeLessThanOrEqual(4000);
    const j = JSON.parse(r.text) as { samples: { t: number }[]; truncated: Record<string, { original: number; kept: number }> };
    expect(j.samples.map((s) => s.t)).toEqual(Array.from({ length: j.samples.length }, (_, i) => i));
    expect(j.truncated['samples']).toEqual({ original: 5000, kept: j.samples.length });
  });

  it('cuts a long string when no array exists', () => {
    const r = limitJson({ log: 'y'.repeat(100000) }, 2000);
    const j = JSON.parse(r.text) as { log: string; truncated: Record<string, { original: number }> };
    expect(j.log.length).toBeLessThan(2000);
    expect(j.truncated['log']?.original).toBe(100000);
  });

  it('wraps a top-level array that has to be cut', () => {
    const r = limitJson(Array.from({ length: 4000 }, (_, i) => i), 1000);
    const j = JSON.parse(r.text) as { value: number[]; truncated: Record<string, unknown> };
    expect(j.value[0]).toBe(0);
    expect(Object.keys(j.truncated)).toEqual(['$']);
  });

  it('copes with dotted keys in the path of a cut array', () => {
    const r = limitJson({ 'push.force': Array.from({ length: 3000 }, (_, i) => i) }, 1000);
    expect((JSON.parse(r.text) as { 'push.force': number[] })['push.force'].length).toBeLessThan(3000);
  });
});

describe('makeToolResult', () => {
  it('has two text blocks and sets isError only when asked', () => {
    const ok = makeToolResult('one\ntwo', { a: 1 });
    expect(ok.content).toHaveLength(2);
    expect(ok.content[0].text).toBe('one two');
    expect(JSON.parse(ok.content[1].text)).toEqual({ a: 1 });
    expect('isError' in ok).toBe(false);
    expect(makeToolResult('bad', {}, true).isError).toBe(true);
  });
});
