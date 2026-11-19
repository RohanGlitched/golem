// Underline ranges for diagnostics: clamped, sorted, disjoint. Pure.
import type { Diagnostic } from '../types.js';

export interface UnderlineRange { start: number; end: number }

export function underlineRanges(text: string, diags: readonly Pick<Diagnostic, 'start' | 'end'>[]): UnderlineRange[] {
  const n = text.length;
  const raw: UnderlineRange[] = [];
  for (const d of diags) {
    let s = Math.max(0, Math.min(n, Number.isFinite(d.start) ? d.start : 0));
    let e = Math.max(0, Math.min(n, Number.isFinite(d.end) ? d.end : 0));
    if (e < s) e = s;
    if (e === s) {
      // Widen a zero-width mark to one code unit; at the very end, onto the last character.
      if (s < n) e = s + 1;
      else if (n > 0) s = n - 1;
      else continue;
    }
    raw.push({ start: s, end: e });
  }
  raw.sort((a, b) => a.start - b.start || a.end - b.end);
  const out: UnderlineRange[] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r.start < last.end) {
      if (r.end > last.end) last.end = r.end; // merge overlap so coverage is kept
    } else out.push({ ...r });
  }
  return out;
}

/** "Line 3, column 12: MISSING_UNIT: message", for the message list. */
export function diagnosticLabel(d: Pick<Diagnostic, 'kind' | 'line' | 'column' | 'message'>, lineId?: string): string {
  const where = lineId ? `Line ${lineId}, column ${d.column}` : `Line ${d.line}, column ${d.column}`;
  return `${where}: ${d.kind}: ${d.message}`;
}
