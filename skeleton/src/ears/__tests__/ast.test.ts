import { describe, expect, it } from 'vitest';
import { stripOffsets, type ParsedRequirement } from '../ast.js';
import type { Token } from '../types.js';

function tok(type: Token['type'], text: string, at: number, line = 1): Token {
  return { type, text, start: at, end: at + text.length, line, column: at + 1 };
}

function make(shift: number, line: number, kw = 'WHEN'): ParsedRequirement {
  const t1 = tok('keyword', kw, shift, line);
  const t2 = tok('word', 'fall', shift + 5, line);
  const span = { start: shift + 5, end: shift + 9, line, column: shift + 6 };
  return {
    id: 'R1',
    pattern: 'event',
    condition: { text: 'fall', tokens: [t2], span },
    robot: { name: 'robot', span },
    response: { text: 'x', tokens: [t1], span },
  };
}

describe('stripOffsets', () => {
  it('makes two ASTs that differ only in offsets equal', () => {
    expect(stripOffsets(make(0, 1))).toEqual(stripOffsets(make(17, 4)));
  });

  it('upper-cases keyword tokens', () => {
    expect(stripOffsets(make(0, 1, 'when'))).toEqual(stripOffsets(make(3, 2, 'WHEN')));
  });

  it('keeps differing content unequal', () => {
    const b = make(0, 1);
    b.pattern = 'state';
    expect(stripOffsets(make(0, 1))).not.toEqual(stripOffsets(b));
  });

  it('does not mutate its input', () => {
    const ast = make(5, 2, 'when');
    const copy = structuredClone(ast);
    stripOffsets(ast);
    expect(ast).toEqual(copy);
  });
});
