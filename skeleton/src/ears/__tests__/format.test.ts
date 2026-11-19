import { describe, expect, it } from 'vitest';
import { stripOffsets, type ParsedRequirement } from '../ast.js';
import { format } from '../format.js';
import { parse } from '../parser.js';
import { tokenize } from '../tokenizer.js';

const ROBOTS = ['robot', 'golem', 'G1'];
const ast = (line: string): ParsedRequirement => {
  const r = parse(tokenize(line).tokens, ROBOTS, line);
  expect(r.diagnostics).toEqual([]);
  return r.ast!;
};

describe('format', () => {
  it('prints the ubiquitous shape', () => {
    expect(format(ast('the robot shall stay upright'))).toBe('THE robot SHALL stay upright');
  });

  it('prints the event shape with a comma before THE', () => {
    expect(format(ast('when x is pushed with up to 200 N the G1 shall stay upright for 3 s'))).toBe(
      'WHEN x is pushed with up to 200 N, THE G1 SHALL stay upright for 3 s',
    );
  });

  it('prints the state shape with a comma before THE', () => {
    expect(format(ast('while walking, the golem shall keep x'))).toBe('WHILE walking, THE golem SHALL keep x');
  });

  it('prints the unwanted shape with a comma before THEN and none after', () => {
    expect(format(ast('if a fault then, the robot shall stop'))).toBe('IF a fault, THEN THE robot SHALL stop');
  });

  it('prints the optional shape with a comma before THE', () => {
    expect(format(ast('where payload the robot shall hold'))).toBe('WHERE payload, THE robot SHALL hold');
  });

  it('prints an ID followed by one space, restoring the period', () => {
    expect(format(ast('R2.   the robot shall stay'))).toBe('R2. THE robot SHALL stay');
    expect(format(ast('3. the robot shall stay'))).toBe('3. THE robot SHALL stay');
    expect(format(ast('1.2 the robot shall stay'))).toBe('1.2 THE robot SHALL stay');
  });

  it('keeps 0.20 s as written', () => {
    expect(format(ast('WHEN pushed for 0.20 s THE robot SHALL stay'))).toContain('0.20 s');
  });

  it('never prints 200 N as 0.2 kN', () => {
    const out = format(ast('WHEN pushed with 200 N THE robot SHALL stay'));
    expect(out).toContain('200 N');
    expect(out).not.toContain('kN');
  });

  it('keeps inner commas attached and collapses whitespace and newlines', () => {
    expect(format(ast('the robot shall  stay ,\n and go'))).toBe('THE robot SHALL stay, and go');
  });

  it('re-parses to an equal AST', () => {
    const a = ast('R4. WHEN pushed with up to 200 N for 0.20 s from any direction, THE G1 SHALL stay upright for 3 s');
    expect(stripOffsets(ast(format(a)))).toEqual(stripOffsets(a));
  });

  it('throws naming pattern when it is missing or unknown', () => {
    const a = ast('the robot shall stay');
    const missing = { ...a } as Record<string, unknown>;
    delete missing.pattern;
    expect(() => format(missing as unknown as ParsedRequirement)).toThrow(/pattern/);
    expect(() => format({ ...a, pattern: 'bogus' } as unknown as ParsedRequirement)).toThrow(/pattern/);
  });

  it('does not mutate the AST', () => {
    const a = ast('R1. WHEN x THE robot SHALL y');
    const before = JSON.stringify(a);
    format(a);
    expect(JSON.stringify(a)).toBe(before);
  });
});
