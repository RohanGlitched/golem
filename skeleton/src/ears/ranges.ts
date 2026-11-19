import { makeDiagnostic, type Diagnostic } from './diagnostics.js';
import type { Dimension, Kind, Span, Token } from './types.js';
import { quantityFromTokens } from './units.js';
import type { Quantity } from './types.js';

export interface RangePhrase {
  kind: Kind;
  /** SI. */
  min: number;
  max: number;
  wrap: boolean;
  /** min === max. */
  fixed: boolean;
  span: Span;
  text: string;
}

export interface RangeParseResult {
  range?: RangePhrase;
  /** Index of the first token after the consumed ones (equals `at` when nothing was consumed). */
  next: number;
  diagnostics: Diagnostic[];
}

const NON_NEGATIVE: ReadonlySet<Kind> = new Set<Kind>(['force', 'duration', 'length', 'speed', 'mass']);

const TWO_PI = 2 * Math.PI;
const BEHIND_MIN = (3 * Math.PI) / 4;
const BEHIND_MAX = (5 * Math.PI) / 4;

function lower(t: Token | undefined): string {
  return t === undefined ? '' : t.text.toLowerCase();
}

function isWord(t: Token | undefined, w: string): boolean {
  return t !== undefined && t.type === 'word' && lower(t) === w;
}

function posOf(t: Token) {
  return { start: t.start, end: t.end, line: t.line, column: t.column };
}

function buildSpan(first: Token, last: Token): Span {
  return { start: first.start, end: last.end, line: first.line, column: first.column };
}

function buildText(tokens: readonly Token[]): string {
  let s = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (i > 0) s += ' '.repeat(Math.max(0, t.start - tokens[i - 1]!.end));
    s += t.text;
  }
  return s;
}

function make(
  kind: Kind, min: number, max: number, wrap: boolean, tokens: readonly Token[],
): RangePhrase {
  // A borrowed unit reuses the number token as the quantity's last token: drop the repeat.
  const used = tokens.filter((t, i) => i === 0 || t !== tokens[i - 1]);
  return {
    kind, min, max, wrap, fixed: min === max,
    span: buildSpan(used[0]!, used[used.length - 1]!),
    text: buildText(used),
  };
}

interface QuantityAt { q?: Quantity; first: Token; last: Token; next: number; diagnostics: Diagnostic[] }

function readQuantity(tokens: readonly Token[], i: number): QuantityAt | undefined {
  const num = tokens[i];
  if (num === undefined || num.type !== 'number') return undefined;
  const nxt = tokens[i + 1];
  const hasUnit = nxt !== undefined && nxt.type === 'unit';
  const r = quantityFromTokens(num, hasUnit ? nxt : undefined, 'length');
  const used = hasUnit ? 2 : 1;
  const out: QuantityAt = {
    first: num, last: hasUnit ? nxt! : num, next: i + used, diagnostics: r.diagnostics,
  };
  if (r.quantity) out.q = r.quantity;
  return out;
}

function negativeDiagnostic(q: Quantity, at: Token): Diagnostic {
  return makeDiagnostic(
    'BAD_RANGE',
    `A ${q.kind} cannot be negative, found '${q.text}'`,
    posOf(at),
  );
}

/**
 * Parses a range phrase starting at tokens[at]. Recognised forms:
 * `up to <q>`, `<q> to <q>`, `from any direction`, `from behind`,
 * `at any point in its stride`, and a lone fixed quantity.
 * When no range phrase starts at `at`, returns no range, next === at and no diagnostics.
 */
export function parseRangePhrase(tokens: readonly Token[], at: number): RangeParseResult {
  const t0 = tokens[at];
  if (t0 === undefined) return { next: at, diagnostics: [] };

  // from any direction / from behind
  if (isWord(t0, 'from')) {
    if (isWord(tokens[at + 1], 'any') && isWord(tokens[at + 2], 'direction')) {
      const used = tokens.slice(at, at + 3);
      return { range: make('angle', 0, TWO_PI, true, used), next: at + 3, diagnostics: [] };
    }
    if (isWord(tokens[at + 1], 'behind')) {
      const used = tokens.slice(at, at + 2);
      return { range: make('angle', BEHIND_MIN, BEHIND_MAX, true, used), next: at + 2, diagnostics: [] };
    }
    return { next: at, diagnostics: [] };
  }

  // at any point in its stride
  if (
    isWord(t0, 'at') && isWord(tokens[at + 1], 'any') && isWord(tokens[at + 2], 'point') &&
    isWord(tokens[at + 3], 'in') && isWord(tokens[at + 4], 'its') && isWord(tokens[at + 5], 'stride')
  ) {
    const used = tokens.slice(at, at + 6);
    return { range: make('phase', 0, 1, true, used), next: at + 6, diagnostics: [] };
  }

  // up to <q>
  if (isWord(t0, 'up') && isWord(tokens[at + 1], 'to')) {
    const r = readQuantity(tokens, at + 2);
    if (r === undefined) return { next: at, diagnostics: [] };
    if (!r.q) return { next: r.next, diagnostics: r.diagnostics };
    if (NON_NEGATIVE.has(r.q.kind) && r.q.si < 0) {
      return { next: r.next, diagnostics: [negativeDiagnostic(r.q, r.first)] };
    }
    const max = r.q.si;
    if (max < 0) {
      // Signed kinds (angle) below zero: min 0 > max is out of order.
      return {
        next: r.next,
        diagnostics: [
          makeDiagnostic(
            'BAD_RANGE',
            `Range minimum 0 is greater than maximum '${r.q.text}'`,
            posOf(r.first),
          ),
        ],
      };
    }
    return {
      range: make(r.q.kind, 0, max, false, [t0, tokens[at + 1]!, r.first, r.last]),
      next: r.next,
      diagnostics: [],
    };
  }

  // <q> to <q>  or lone <q>
  let a = readQuantity(tokens, at);
  if (a === undefined) return { next: at, diagnostics: [] };
  if (!a.q) {
    // `150 to 250 N`: a bare first number borrows the unit of the second quantity.
    const unitTok = tokens[a.next + 2];
    const missing = a.diagnostics.length === 1 && a.diagnostics[0]!.kind === 'MISSING_UNIT';
    if (
      missing && isWord(tokens[a.next], 'to') && tokens[a.next + 1]?.type === 'number' &&
      unitTok !== undefined && unitTok.type === 'unit'
    ) {
      const borrowed = quantityFromTokens(a.first, unitTok, 'length');
      if (borrowed.quantity) {
        a = {
          q: { ...borrowed.quantity, text: a.first.text },
          first: a.first, last: a.first, next: a.next, diagnostics: [],
        };
      }
    }
    if (!a.q) return { next: a.next, diagnostics: a.diagnostics };
  }

  if (isWord(tokens[a.next], 'to')) {
    const b = readQuantity(tokens, a.next + 1);
    if (b !== undefined) {
      const diagnostics: Diagnostic[] = [];
      const bq = b.q;
      if (!bq) return { next: b.next, diagnostics: b.diagnostics };
      if (a.q.kind !== bq.kind) {
        diagnostics.push(
          makeDiagnostic(
            'BAD_RANGE',
            `Range mixes kinds: ${a.q.kind} ('${a.q.text}') and ${bq.kind} ('${bq.text}')`,
            posOf(b.first),
          ),
        );
        return { next: b.next, diagnostics };
      }
      if (NON_NEGATIVE.has(a.q.kind)) {
        if (a.q.si < 0) diagnostics.push(negativeDiagnostic(a.q, a.first));
        if (bq.si < 0) diagnostics.push(negativeDiagnostic(bq, b.first));
      }
      if (diagnostics.length === 0 && a.q.si > bq.si) {
        diagnostics.push(
          makeDiagnostic(
            'BAD_RANGE',
            `Range minimum '${a.q.text}' is greater than maximum '${bq.text}'`,
            posOf(b.first),
          ),
        );
      }
      if (diagnostics.length > 0) return { next: b.next, diagnostics };
      return {
        range: make(a.q.kind, a.q.si, bq.si, false, [a.first, a.last, tokens[a.next]!, b.first, b.last]),
        next: b.next,
        diagnostics: [],
      };
    }
    // `<q> to` without a second quantity: treat as lone quantity, caller sees `to`.
  }

  if (NON_NEGATIVE.has(a.q.kind) && a.q.si < 0) {
    return { next: a.next, diagnostics: [negativeDiagnostic(a.q, a.first)] };
  }
  return {
    range: make(a.q.kind, a.q.si, a.q.si, false, [a.first, a.last]),
    next: a.next,
    diagnostics: [],
  };
}

/** One Dimension per Range_Phrase. A fixed phrase gives min === max. `wrap` is set only when true. */
export function rangeToDimension(
  name: string, range: RangePhrase, severity: Dimension['severity'],
): Dimension {
  const d: Dimension = { name, kind: range.kind, min: range.min, max: range.max, severity };
  if (range.wrap) d.wrap = true;
  return d;
}

/** BAD_RANGE at the second range bound to the same slot (Requirement 4.10). */
export function duplicateRangeDiagnostic(slotName: string, second: RangePhrase): Diagnostic {
  return makeDiagnostic(
    'BAD_RANGE',
    `Slot '${slotName}' already has a range; found a second range '${second.text}'`,
    second.span,
  );
}
