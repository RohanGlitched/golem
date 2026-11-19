import fc from 'fast-check';

export const UNITS = ['N', 'kN', 's', 'ms', 'm', 'cm', 'mm', 'm/s', 'cm/s', 'deg', 'rad', 'kg', 'g', '%'] as const;

const arbNumber = fc.oneof(
  fc.integer({ min: 0, max: 999 }).map(String),
  fc.tuple(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 99 })).map(([a, b]) => `${a}.${b}`),
);

export type Piece =
  | { t: 'kw'; text: string }
  | { t: 'word'; text: string }
  | { t: 'q'; text: string }
  | { t: 'bare'; text: string }
  | { t: 'comma'; text: string };

const arbPiece: fc.Arbitrary<Piece> = fc.oneof(
  fc.constantFrom('WHEN', 'WHILE', 'IF', 'THEN', 'WHERE', 'THE', 'SHALL').map((text) => ({ t: 'kw' as const, text })),
  fc.constantFrom('robot', 'pushed', 'with', 'up', 'for', 'stay', 'upright', 'pelvis', 'from', 'any', 'direction').map((text) => ({ t: 'word' as const, text })),
  fc.tuple(arbNumber, fc.constantFrom('', ' '), fc.constantFrom(...UNITS)).map(([n, g, u]) => ({ t: 'q' as const, text: `${n}${g}${u}` })),
  arbNumber.map((text) => ({ t: 'bare' as const, text })),
  fc.constant({ t: 'comma' as const, text: ',' }),
);

/** EARS-like lines from keyword, word and quantity pieces separated by single spaces. */
export const arbLinePieces = fc.array(arbPiece, { minLength: 1, maxLength: 14 });
export const piecesToLine = (ps: Piece[]): string => ps.map((p) => p.text).join(' ');
export const arbLine = arbLinePieces.map(piecesToLine);
