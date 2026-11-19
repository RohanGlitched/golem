// AST for one parsed EARS line. Pattern, Span and Token live in types.ts.
import type { Pattern, Span, Token } from './types.js';

export type { Pattern, Span };

export interface Clause {
  /** Exact source substring from the first to the last token. */
  text: string;
  tokens: Token[];
  span: Span;
}

export interface ParsedRequirement {
  /** Requirement ID without its trailing period. */
  id?: string;
  pattern: Pattern;
  /** Trigger, state, fault or feature clause. */
  condition?: Clause;
  robot: { name: string; span: Span };
  response: Clause;
}

const POSITION_KEYS: ReadonlySet<string> = new Set(['start', 'end', 'line', 'column', 'span']);

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value === null || typeof value !== 'object') return value;
  const src = value as Record<string, unknown>;
  const isKeyword = src.type === 'keyword';
  const isClause = typeof src.text === 'string' && Array.isArray(src.tokens);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    if (POSITION_KEYS.has(key)) continue;
    const v = src[key];
    out[key] = isKeyword && key === 'text' && typeof v === 'string' ? v.toUpperCase() : strip(v);
  }
  if (isClause) out.text = layoutText(out.tokens as { type?: unknown; text?: unknown }[]);
  return out;
}

/** Token texts joined by one space, commas attached to the previous token (as format.ts prints). */
function layoutText(tokens: { type?: unknown; text?: unknown }[]): string {
  let s = '';
  for (const t of tokens) {
    if (t.type === 'comma') s += ',';
    else s += (s === '' ? '' : ' ') + String(t.text);
  }
  return s;
}

/**
 * Returns a deep copy without start, end, line, column and span, with keyword
 * tokens upper-cased, so ASTs can be compared ignoring source positions.
 * Decision (Property 31 / req 10.8): equality ignores source offsets AND source
 * layout, so `Clause.text` (exact source substring, req 3.14) is replaced by its
 * tokens' texts joined with one space, commas attached to the previous token,
 * the way format.ts prints clauses (req 10.1). Tokens are still compared exactly.
 * Does not mutate its input.
 */
export function stripOffsets(ast: ParsedRequirement): unknown {
  return strip(ast);
}
