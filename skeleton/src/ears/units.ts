import { makeDiagnostic, type Diagnostic } from './diagnostics.js';
import type { Kind, Quantity, SlotKind, Token } from './types.js';

/** The one number pattern of the ears module: optional sign, digits, optional fraction and exponent. */
export const NUMBER_SOURCE = String.raw`[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?`;

export interface UnitSpec { spelling: string; kind: Kind; factor: number }

const DEG = Math.PI / 180;

/** Accepted unit spellings with kind and factor to SI. Matching is case-sensitive. */
export const UNIT_TABLE: readonly UnitSpec[] = Object.freeze([
  { spelling: 'N', kind: 'force', factor: 1 },
  { spelling: 'kN', kind: 'force', factor: 1000 },
  { spelling: 's', kind: 'duration', factor: 1 },
  { spelling: 'ms', kind: 'duration', factor: 0.001 },
  { spelling: 'm', kind: 'length', factor: 1 },
  { spelling: 'cm', kind: 'length', factor: 0.01 },
  { spelling: 'mm', kind: 'length', factor: 0.001 },
  { spelling: 'm/s', kind: 'speed', factor: 1 },
  { spelling: 'cm/s', kind: 'speed', factor: 0.01 },
  { spelling: 'deg', kind: 'angle', factor: DEG },
  { spelling: '°', kind: 'angle', factor: DEG },
  { spelling: 'rad', kind: 'angle', factor: 1 },
  { spelling: 'kg', kind: 'mass', factor: 1 },
  { spelling: 'g', kind: 'mass', factor: 0.001 },
  { spelling: '%', kind: 'ratio', factor: 0.01 },
] as UnitSpec[]);

export const ACCEPTED_UNITS: readonly string[] = Object.freeze(UNIT_TABLE.map((u) => u.spelling));

const BY_SPELLING: ReadonlyMap<string, UnitSpec> = new Map(UNIT_TABLE.map((u) => [u.spelling, u]));

/** The table entry for a spelling (case-sensitive), or undefined. */
export function lookupUnit(unit: string): UnitSpec | undefined {
  return BY_SPELLING.get(unit);
}

function need(unit: string): UnitSpec {
  const spec = BY_SPELLING.get(unit);
  if (!spec) throw new Error(`Unknown unit "${unit}". Accepted units: ${ACCEPTED_UNITS.join(', ')}`);
  return spec;
}

/** Multiply by the unit factor. Throws on an unknown unit. */
export function toSI(value: number, unit: string): number {
  return value * need(unit).factor;
}

/** Divide by the unit factor. 0 returns exactly 0. Throws on an unknown unit. */
export function fromSI(si: number, unit: string): number {
  const spec = need(unit);
  if (si === 0) return 0;
  return si / spec.factor;
}

export interface QuantityResult { quantity?: Quantity; diagnostics: Diagnostic[] }

function posOf(t: Token) {
  return { start: t.start, end: t.end, line: t.line, column: t.column };
}

/**
 * Builds a Quantity from a number token and the token after it (if any).
 * `unit` of type 'unit' gives a quantity of the unit's kind. A 'word' unit gives UNKNOWN_PHRASE.
 * Any other token, or undefined, means no unit follows: bare-number rules for `slot` apply.
 * Kind mismatch against the slot is the matcher's job, not reported here.
 * `text` is rebuilt as number + the gap between the tokens + unit.
 */
export function quantityFromTokens(
  num: Token,
  unit: Token | undefined,
  slot: SlotKind,
): QuantityResult {
  const value = Number(num.text);
  if (!Number.isFinite(value)) {
    return {
      diagnostics: [
        makeDiagnostic('BAD_RANGE', `Number '${num.text}' is not a finite value`, posOf(num)),
      ],
    };
  }

  if (unit !== undefined && (unit.type === 'word' || unit.type === 'unit')) {
    // A word, or a unit token that is not in the table, is an unknown unit.
    const spec = unit.type === 'unit' ? BY_SPELLING.get(unit.text) : undefined;
    if (!spec) {
      return {
        diagnostics: [
          makeDiagnostic(
            'UNKNOWN_PHRASE',
            `Unknown unit '${unit.text}'. Accepted units: ${ACCEPTED_UNITS.join(', ')}`,
            posOf(unit),
          ),
        ],
      };
    }
    const gap = Math.max(0, unit.start - num.end);
    return {
      quantity: {
        kind: spec.kind,
        si: value * spec.factor,
        text: num.text + ' '.repeat(gap) + unit.text,
      },
      diagnostics: [],
    };
  }

  // Bare number.
  if (slot === 'count') {
    if (/^\d+$/.test(num.text)) {
      return { quantity: { kind: 'count', si: value, text: num.text }, diagnostics: [] };
    }
    return {
      diagnostics: [
        makeDiagnostic(
          'BAD_RANGE',
          `A count must be an unsigned integer, found '${num.text}'`,
          posOf(num),
        ),
      ],
    };
  }
  if (slot === 'ratio') {
    if (value >= 0 && value <= 1) {
      return { quantity: { kind: 'ratio', si: value, text: num.text }, diagnostics: [] };
    }
    return {
      diagnostics: [
        makeDiagnostic(
          'BAD_RANGE',
          `A bare ratio must be in the interval [0, 1], found '${num.text}'. Use % for percentages`,
          posOf(num),
        ),
      ],
    };
  }
  return {
    diagnostics: [
      makeDiagnostic(
        'MISSING_UNIT',
        `Number '${num.text}' has no unit. Accepted units: ${ACCEPTED_UNITS.join(', ')}`,
        posOf(num),
      ),
    ],
  };
}

const QUANTITY_TEXT = new RegExp(String.raw`^(\s*)(${NUMBER_SOURCE})( ?)(\S.*?)?(\s*)$`, 's');

/**
 * Parses text such as `200 N` or `0.20s` into a Quantity. `slot` selects the
 * bare-number rules ('count', 'ratio'); without it a bare number is MISSING_UNIT.
 * Positions are relative to `text` (line 1, column 1 is its first character).
 */
export function parseQuantity(text: string, slot?: SlotKind): QuantityResult {
  const m = QUANTITY_TEXT.exec(text);
  const s: SlotKind = slot ?? 'length';
  if (!m) {
    return {
      diagnostics: [
        makeDiagnostic(
          'PATTERN_MISMATCH',
          `Expected a number followed by a unit, found '${text}'`,
          { start: 0, end: text.length, line: 1, column: 1 },
        ),
      ],
    };
  }
  const lead = m[1]!.length;
  const numText = m[2]!;
  const space = m[3]!;
  const rest = m[4];
  const numStart = lead;
  const num: Token = {
    type: 'number',
    text: numText,
    start: numStart,
    end: numStart + numText.length,
    line: 1,
    column: numStart + 1,
  };
  if (rest === undefined) return quantityFromTokens(num, undefined, s);
  // A unit directly after a number may be glued to it only if the number ended the match
  // (regex is greedy on the number), so `rest` starts right after `space`.
  const rStart = num.end + space.length;
  const isUnit = BY_SPELLING.has(rest);
  const tok: Token = {
    type: isUnit ? 'unit' : 'word',
    text: rest,
    start: rStart,
    end: rStart + rest.length,
    line: 1,
    column: rStart + 1,
  };
  return quantityFromTokens(num, tok, s);
}
