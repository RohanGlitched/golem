// Small HTML helpers shared by the page renderers.
export function esc(v: unknown): string {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const KEYWORDS = /\b(WHEN|WHILE|IF|THEN|WHERE|THE|SHALL)\b/g;
const QUANTITY = /(\d+(?:\.\d+)?)(?:\s*(?:to|-)\s*\d+(?:\.\d+)?)?\s?(N|kN|ms|s|m\/s|cm\/s|deg|rad|kg|g|mm|cm|m|%)(?![A-Za-z])/g;

/** Sets an EARS line: keywords in small capitals-sized caps, quantities in the mono face. Input is escaped first. */
export function earsHtml(line: string): string {
  return esc(line)
    .replace(KEYWORDS, '<span class="kw">$1</span>')
    .replace(QUANTITY, (m) => `<span class="qty">${m}</span>`);
}

/** Slug for anchors: lower case, ASCII, hyphens. Never empty. */
export function slug(text: string): string {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s === '' ? 'section' : s;
}

export const fmt = (n: number, digits = 1): string => n.toFixed(digits).replace(/\.0+$/, '');
export const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** A table that scrolls inside its own box, so the page never scrolls sideways. */
export function table(head: string[], rows: string[][], opts: { caption?: string; num?: number[]; cls?: string } = {}): string {
  const num = new Set(opts.num ?? []);
  const th = head.map((h, i) => `<th scope="col"${num.has(i) ? ' class="num"' : ''}>${esc(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c, i) => `<td${num.has(i) ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(opts.caption ?? 'Table')}"><table${opts.cls ? ` class="${opts.cls}"` : ''}>${opts.caption ? `<caption>${esc(opts.caption)}</caption>` : ''}<thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** A code block with a copy button (the copy script reads the block's text). */
export function codeBlock(text: string, label: string): string {
  return `<div class="code"><button class="copy" type="button" aria-label="Copy ${esc(label)}">Copy</button><pre tabindex="0"><code>${esc(text)}</code></pre></div>`;
}
