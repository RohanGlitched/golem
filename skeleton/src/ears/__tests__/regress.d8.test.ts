// Regression test for defect 8: "WHEN x THEN the robot SHALL" gave a misleading matcher error.
import { describe, expect, it } from 'vitest';
import { format } from '../format.js';
import { parse } from '../parser.js';
import { tokenize } from '../tokenizer.js';

const names = ['golem'];
const parseLine = (line: string) => parse(tokenize(line).tokens, names, line);

describe('defect 8: THEN before THE in WHEN, WHILE and WHERE lines', () => {
  it.each([
    ['WHEN the pelvis is pushed THEN the golem SHALL stay upright', 'event', 'the pelvis is pushed'],
    ['WHEN the pelvis is pushed, THEN the golem SHALL stay upright', 'event', 'the pelvis is pushed'],
    ['WHEN the pelvis is pushed THEN, the golem SHALL stay upright', 'event', 'the pelvis is pushed'],
    ['WHILE walking THEN THE golem SHALL stay upright', 'state', 'walking'],
    ['WHERE the payload kit is fitted THEN THE golem SHALL stay upright', 'optional', 'the payload kit is fitted'],
  ])('accepts %s and drops THEN', (line, pattern, condition) => {
    const { ast, diagnostics } = parseLine(line);
    expect(diagnostics).toEqual([]);
    expect(ast!.pattern).toBe(pattern);
    expect(ast!.condition!.text).toBe(condition);
    expect(ast!.condition!.tokens.some((t) => t.text === 'THEN')).toBe(false);
    expect(format(ast!)).not.toContain('THEN');
  });

  it('still requires THEN in an IF line', () => {
    const { ast, diagnostics } = parseLine('IF the pelvis is pushed, THE golem SHALL stay upright');
    expect(ast).toBeUndefined();
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Closest pattern is unwanted (IF ... THEN THE <robot> SHALL ...); expected THEN before THE',
    ]);
  });

  it('reports a condition that is only THEN as missing', () => {
    const { ast, diagnostics } = parseLine('WHEN THEN THE golem SHALL stay upright');
    expect(ast).toBeUndefined();
    expect(diagnostics[0]!.message).toBe('Missing trigger clause after WHEN; closest pattern is event');
  });
});
