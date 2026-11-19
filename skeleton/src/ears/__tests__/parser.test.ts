import { describe, expect, it } from 'vitest';
import { stripOffsets } from '../ast.js';
import { parse } from '../parser.js';
import { tokenize } from '../tokenizer.js';

const ROBOTS = ['robot', 'golem', 'G1'];
const run = (line: string) => parse(tokenize(line).tokens, ROBOTS, line);

describe('parse', () => {
  it('parses a ubiquitous line with no condition', () => {
    const { ast, diagnostics } = run('the robot shall stay upright');
    expect(diagnostics).toEqual([]);
    expect(ast?.pattern).toBe('ubiquitous');
    expect(ast?.condition).toBeUndefined();
    expect(ast?.id).toBeUndefined();
    expect(ast?.response.text).toBe('stay upright');
  });

  it('parses an event line and strips the ID period', () => {
    const line = 'R2. WHEN the pelvis is pushed with up to 200 N THE G1 SHALL stay upright for 3 s';
    const { ast, diagnostics } = run(line);
    expect(diagnostics).toEqual([]);
    expect(ast?.id).toBe('R2');
    expect(ast?.pattern).toBe('event');
    expect(ast?.robot.name).toBe('G1');
    expect(ast?.condition?.text).toBe('the pelvis is pushed with up to 200 N');
    expect(line.slice(ast!.condition!.span.start, ast!.condition!.span.end)).toBe(ast!.condition!.text);
    expect(ast?.response.text).toBe('stay upright for 3 s');
  });

  it('parses a state line with a 1.2 style ID', () => {
    const { ast } = run('1.2 WHILE walking THE robot SHALL keep x');
    expect(ast?.id).toBe('1.2');
    expect(ast?.pattern).toBe('state');
    expect(ast?.condition?.text).toBe('walking');
  });

  it('parses an unwanted line', () => {
    const { ast } = run('IF the sensor drops out THEN THE robot SHALL stop');
    expect(ast?.pattern).toBe('unwanted');
    expect(ast?.condition?.text).toBe('the sensor drops out');
    expect(ast?.response.text).toBe('stop');
  });

  it('parses an optional line', () => {
    const { ast } = run('WHERE payload is enabled THE robot SHALL carry it');
    expect(ast?.pattern).toBe('optional');
    expect(ast?.condition?.text).toBe('payload is enabled');
  });

  it('stores keywords in upper case and the robot name as written', () => {
    const { ast } = run('when x the Golem shall y');
    expect(ast?.robot.name).toBe('Golem');
    expect(ast?.condition?.tokens.map((t) => t.text)).toEqual(['x']);
    expect(stripOffsets(ast!)).toBeDefined();
  });

  it('gives equal ASTs with and without the comma before THE', () => {
    const a = run('WHEN x, THE robot SHALL y').ast!;
    const b = run('WHEN x THE robot SHALL y').ast!;
    expect(stripOffsets(a)).toEqual(stripOffsets(b));
  });

  it('gives equal ASTs with and without the comma after THEN', () => {
    const a = run('IF x, THEN, THE robot SHALL y').ast!;
    const b = run('IF x, THEN THE robot SHALL y').ast!;
    expect(stripOffsets(a)).toEqual(stripOffsets(b));
  });

  it('reports an empty condition clause at the expected position', () => {
    const { ast, diagnostics } = run('WHEN THE robot SHALL y');
    expect(ast).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ kind: 'PATTERN_MISMATCH', start: 5, column: 6 });
    expect(diagnostics[0]!.message).toContain('trigger');
  });

  it('reports an empty response clause at the end of the line', () => {
    const line = 'WHEN x THE robot SHALL';
    const { ast, diagnostics } = run(line);
    expect(ast).toBeUndefined();
    expect(diagnostics[0]).toMatchObject({ kind: 'PATTERN_MISMATCH', start: line.length });
    expect(diagnostics[0]!.message).toContain('response');
  });

  it('reports the second SHALL and returns no AST', () => {
    const line = 'THE robot SHALL stay SHALL fall';
    const { ast, diagnostics } = run(line);
    expect(ast).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ kind: 'PATTERN_MISMATCH', start: line.indexOf('SHALL', 16) });
  });

  it('reports an unknown robot with the allowed names in suggestion', () => {
    const { ast, diagnostics } = run('THE human SHALL stay');
    expect(ast).toBeUndefined();
    expect(diagnostics[0]).toMatchObject({ kind: 'UNKNOWN_ROBOT', start: 4 });
    expect(diagnostics[0]!.suggestion).toBe('robot, golem, G1');
    expect(diagnostics[0]!.message).toContain('golem');
  });

  it('names the closest pattern when a line does not match any', () => {
    const { diagnostics } = run('stay upright');
    expect(diagnostics[0]!.kind).toBe('PATTERN_MISMATCH');
    expect(diagnostics[0]!.message).toContain('ubiquitous');
  });

  it('names THEN as expected when an IF line lacks it', () => {
    const { diagnostics } = run('IF x THE robot SHALL y');
    expect(diagnostics[0]!.message).toContain('THEN');
  });

  it('is deterministic', () => {
    expect(run('WHEN x THE robot SHALL y')).toEqual(run('WHEN x THE robot SHALL y'));
  });
});
