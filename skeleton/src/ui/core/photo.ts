// The photograph's corner text: the requirement id and sentence, wrapped, set in the lower-left corner. Pure.
export interface PhotoLine { text: string; x: number; y: number; font: string; ink: 'ink' | 'ink2' }

export interface PhotoLayoutIn {
  width: number;
  height: number;
  /** Output pixels per CSS pixel (2 for the 2× photograph). */
  scale: number;
  id: string;
  text: string;
  /** A quiet last line, such as "480 trials, 31 broken". */
  note?: string;
  /** Width in output pixels of `text` set in `font`. */
  measure(text: string, font: string): number;
}

/** The share of the photograph's width the text may use. */
export const PHOTO_MEASURE = 0.46;

export function photoFonts(scale: number): { id: string; body: string; note: string; lineHeight: number; margin: number } {
  return {
    id: `${Math.round(13 * scale)}px 'B612 Mono', ui-monospace, monospace`,
    body: `${Math.round(16 * scale)}px 'B612', system-ui, sans-serif`,
    note: `${Math.round(13 * scale)}px 'B612', system-ui, sans-serif`,
    lineHeight: Math.round(16 * 1.45 * scale),
    margin: Math.round(24 * scale),
  };
}

/** Greedy word wrap to `maxWidth`; a single word wider than the measure gets its own line. A number and its unit stay together. */
export function wrap(text: string, font: string, maxWidth: number, measure: (t: string, f: string) => number): string[] {
  const words = text.replace(/(\d) (?=[A-Za-z%°µ/])/g, '$1\u00a0').split(/[ \t\r\n]+/).filter((w) => w.length > 0);
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && measure(next, font) > maxWidth) { out.push(line); line = w; } else line = next;
  }
  if (line) out.push(line);
  return out.map((l) => l.replace(/\u00a0/g, ' '));
}

/** Lines from top to bottom, with baselines; the last line sits one margin above the bottom edge. */
export function photoLayout(p: PhotoLayoutIn): PhotoLine[] {
  const f = photoFonts(p.scale);
  const maxW = Math.max(1, PHOTO_MEASURE * p.width);
  const body = wrap(p.text, f.body, maxW, p.measure);
  const rows: { text: string; font: string; ink: 'ink' | 'ink2' }[] = [
    { text: p.id, font: f.id, ink: 'ink2' },
    ...body.map((t) => ({ text: t, font: f.body, ink: 'ink' as const })),
    ...(p.note ? [{ text: p.note, font: f.note, ink: 'ink2' as const }] : []),
  ];
  const bottom = p.height - f.margin;
  return rows.map((r, i) => ({ ...r, x: f.margin, y: bottom - (rows.length - 1 - i) * f.lineHeight }));
}
