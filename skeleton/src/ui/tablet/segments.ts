// Splits a requirement line into keyword, quantity and plain segments. Pure.
import { parseQuantity, tokenize } from '../../ears/index.js';
import type { Kind } from '../types.js';

export interface QuantityInfo {
  kind: Kind;
  /** Unit as written (or inherited from the end of a range). */
  unit: string;
  /** Characters between the number and the unit ('' or ' '). '' when inherited. */
  gap: string;
  numberText: string;
  inheritedUnit: boolean;
  /** Value in the written unit. */
  value: number;
  /** Decimal places as written. */
  decimals: number;
}

export interface Segment {
  kind: 'keyword' | 'quantity' | 'plain';
  text: string;
  start: number;
  end: number;
  q?: QuantityInfo;
}

const KEYWORDS: ReadonlySet<string> = new Set(['WHEN', 'WHILE', 'IF', 'THEN', 'WHERE', 'THE', 'SHALL']);

export const writtenDecimals = (numberText: string): number => {
  const m = /\.(\d+)/.exec(numberText);
  return m ? (m[1] as string).length : 0;
};

/** Concatenating segment texts gives `text` back. */
export function segmentLine(text: string): Segment[] {
  const { tokens } = tokenize(text);
  const marks: Segment[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === 'keyword' && KEYWORDS.has(t.text)) {
      marks.push({ kind: 'keyword', text: t.text, start: t.start, end: t.end });
      continue;
    }
    if (t.type !== 'number') continue;
    const u = tokens[i + 1];
    if (u && u.type === 'unit' && u.start - t.end <= 1) {
      const span = text.slice(t.start, u.end);
      const q = parseQuantity(span).quantity;
      if (q) {
        marks.push({
          kind: 'quantity', text: span, start: t.start, end: u.end,
          q: {
            kind: q.kind, unit: u.text, gap: text.slice(t.end, u.start), numberText: t.text, inheritedUnit: false,
            value: Number(t.text), decimals: writtenDecimals(t.text),
          },
        });
      }
      i++;
      continue;
    }
    // `150 to 250 N`: the first number inherits the unit of the second.
    const to = tokens[i + 1], n2 = tokens[i + 2], u2 = tokens[i + 3];
    if (to && to.type === 'word' && to.text.toLowerCase() === 'to' && n2 && n2.type === 'number'
      && u2 && u2.type === 'unit' && u2.start - n2.end <= 1) {
      const q = parseQuantity(`${t.text} ${u2.text}`).quantity;
      if (q) {
        marks.push({
          kind: 'quantity', text: t.text, start: t.start, end: t.end,
          q: {
            kind: q.kind, unit: u2.text, gap: '', numberText: t.text, inheritedUnit: true,
            value: Number(t.text), decimals: writtenDecimals(t.text),
          },
        });
      }
    }
  }
  const out: Segment[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start > pos) out.push({ kind: 'plain', text: text.slice(pos, m.start), start: pos, end: m.start });
    out.push(m);
    pos = m.end;
  }
  if (pos < text.length) out.push({ kind: 'plain', text: text.slice(pos), start: pos, end: text.length });
  return out;
}
