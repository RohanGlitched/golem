// Hand-written tokenizer for one EARS line. Pure: no I/O, no clock, no randomness.
import { makeDiagnostic, type Diagnostic } from './diagnostics.js';
import type { Token, TokenType } from './types.js';
import { ACCEPTED_UNITS, NUMBER_SOURCE } from './units.js';

export type { Token, TokenType };

const KEYWORD = /^(?:when|while|if|then|where|the|shall)$/i;
// Sticky regexes, so each is anchored at lastIndex without slicing the input.
const ID_R = /R\d+\.(?=\s|$)/y;
const ID_NUM = /\d+\.\d*(?=\s|$)/y;
const NUMBER = new RegExp(NUMBER_SOURCE, 'y');
const WORD = /\p{L}[\p{L}\p{N}_'-]*/uy;
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Accepted units, longest spelling first, so `m/s` is tried before `m`. */
const UNITS_LONGEST_FIRST: readonly string[] = [...ACCEPTED_UNITS].sort(
  (a, b) => b.length - a.length,
);

function isWhitespace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0a;
}

function matchAt(re: RegExp, input: string, pos: number): string | undefined {
  re.lastIndex = pos;
  const m = re.exec(input);
  return m ? m[0] : undefined;
}

/** Longest accepted unit at `pos` that ends at a word boundary, or undefined. */
function unitAt(input: string, pos: number): string | undefined {
  for (const u of UNITS_LONGEST_FIRST) {
    if (!input.startsWith(u, pos)) continue;
    const next = input.codePointAt(pos + u.length);
    if (next !== undefined && WORD_CHAR.test(String.fromCodePoint(next))) continue;
    return u;
  }
  return undefined;
}

export function tokenize(input: string): { tokens: Token[]; diagnostics: Diagnostic[] } {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  const n = input.length;
  let pos = 0;
  let line = 1;
  let lineStart = 0;
  let atStart = true; // no token or error yet, so an ID is still allowed

  const emit = (type: TokenType, text: string, start: number): void => {
    tokens.push({ type, text, start, end: start + text.length, line, column: start - lineStart + 1 });
  };

  while (pos < n) {
    const c = input.charCodeAt(pos);
    if (isWhitespace(c)) {
      if (c === 0x0a) {
        line++;
        lineStart = pos + 1;
      }
      pos++;
      continue;
    }

    if (atStart) {
      atStart = false;
      const id = matchAt(ID_R, input, pos) ?? matchAt(ID_NUM, input, pos);
      if (id !== undefined) {
        emit('requirementId', id, pos);
        pos += id.length;
        continue;
      }
    }

    const num = matchAt(NUMBER, input, pos);
    if (num !== undefined) {
      emit('number', num, pos);
      pos += num.length;
      // Unit: directly after the number, or after exactly one space.
      let up = pos;
      if (input.charCodeAt(up) === 0x20) up++;
      const unit = unitAt(input, up);
      if (unit !== undefined) {
        // A unit never contains a break, so line and column stay valid.
        emit('unit', unit, up);
        pos = up + unit.length;
      }
      continue;
    }

    const word = matchAt(WORD, input, pos);
    if (word !== undefined) {
      emit(KEYWORD.test(word) ? 'keyword' : 'word', word, pos);
      pos += word.length;
      continue;
    }

    if (c === 0x2c) {
      emit('comma', ',', pos);
      pos++;
      continue;
    }

    // Illegal character: one code point (a surrogate pair is one character).
    const ch = String.fromCodePoint(input.codePointAt(pos) as number);
    diagnostics.push(
      makeDiagnostic(
        'PATTERN_MISMATCH',
        `Unexpected character '${ch}' (U+${(ch.codePointAt(0) as number)
          .toString(16)
          .toUpperCase()
          .padStart(4, '0')})`,
        { start: pos, end: pos + ch.length, line, column: pos - lineStart + 1 },
      ),
    );
    pos += ch.length;
  }

  return { tokens, diagnostics };
}
