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

/** Applies a diagnostic's suggestion to the line: a phrase replaces the marked span, keeping the
 * quantities written there in slot order; a robot list gives its first name. */
export function applySuggestion(text: string, d: Pick<Diagnostic, 'kind' | 'start' | 'end' | 'suggestion'>): string | undefined {
  const s = d.suggestion;
  if (!s) return undefined;
  const start = Math.max(0, Math.min(text.length, d.start));
  const end = Math.max(start, Math.min(text.length, d.end));
  if (d.kind === 'UNKNOWN_ROBOT') {
    const name = s.split(',')[0]!.trim();
    return name ? text.slice(0, start) + name + text.slice(end) : undefined;
  }
  // A phrase replaces the whole clause the mark sits in, filling its slots with the clause's quantities
  // in order and keeping whatever follows the last used quantity (such as "for 3 s").
  const KW = /\b(WHEN|WHILE|IF|WHERE|SHALL)\b/g;
  let clauseStart = 0, opener = '';
  for (const m of text.matchAll(KW)) {
    const at = m.index as number;
    if (at + (m[1] as string).length <= start) { clauseStart = at + (m[1] as string).length; opener = m[1] as string; }
  }
  let clauseEnd = text.length;
  if (opener !== 'SHALL') {
    const close = /\b(THEN|THE)\b/g;
    close.lastIndex = Math.max(end, clauseStart);
    const m = close.exec(text);
    if (m) clauseEnd = m.index;
  }
  while (clauseStart < clauseEnd && /\s/.test(text[clauseStart] as string)) clauseStart++;
  let cEnd = clauseEnd;
  while (cEnd > clauseStart && /\s/.test(text[cEnd - 1] as string)) cEnd--;
  const clause = text.slice(clauseStart, cEnd);
  const re = /[+-]?\d+(?:\.\d+)?(?: ?(?:m\/s|cm\/s|kN|N|ms|s|mm|cm|m|deg|°|rad|kg|g|%))?(?![\w/])/g;
  const qty = [...clause.matchAll(re)];
  const slots = (s.match(/\{[^}]+\}/g) ?? []).length;
  let i = 0;
  const filled = s.replace(/\{[^}]+\}/g, (slot) => (i < qty.length ? (qty[i++]![0]) : slot));
  const used = qty[Math.min(slots, qty.length) - 1];
  const rest = slots > 0 && used ? clause.slice((used.index as number) + used[0].length) : '';
  return text.slice(0, clauseStart) + filled + rest + text.slice(cEnd);
}

/** "Line 3, column 12: MISSING_UNIT: message", for the message list. */
export function diagnosticLabel(d: Pick<Diagnostic, 'kind' | 'line' | 'column' | 'message'>, lineId?: string): string {
  const where = lineId ? `Line ${lineId}, column ${d.column}` : `Line ${d.line}, column ${d.column}`;
  return `${where}: ${d.kind}: ${d.message}`;
}
