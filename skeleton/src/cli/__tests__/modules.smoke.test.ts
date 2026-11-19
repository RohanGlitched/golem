import { describe, expect, it } from 'vitest';
import * as deps from '../deps.js';
import * as paths from '../paths.js';
import * as sibling from '../sibling-types.js';
import * as types from '../types.js';

describe('kit module entries', () => {
  it('imports every new module', () => {
    expect(typeof deps.TraceUnavailableError).toBe('function');
    expect(typeof paths.resolve).toBe('function');
    expect(sibling).toBeDefined();
    expect(types).toBeDefined();
  });

  it('names the missing golem-sim capability in TraceUnavailableError', () => {
    expect(new deps.TraceUnavailableError().message).toContain('golem-sim');
  });
});

describe('paths', () => {
  it('resolves relative and absolute paths on posix and drive forms', () => {
    expect(paths.resolve('/a/b', '../c')).toBe('/a/c');
    expect(paths.resolve('/a/b', '/x/y')).toBe('/x/y');
    expect(paths.resolve('C:\\proj\\app', '.kiro\\x.md')).toBe('C:/proj/app/.kiro/x.md');
    expect(paths.dirname('C:/a/b.txt')).toBe('C:/a');
    expect(paths.dirname('/a')).toBe('/');
    expect(paths.isAbsolute('D:\\x')).toBe(true);
    expect(paths.isAbsolute('x/y')).toBe(false);
  });

  it('computes relative paths and containment', () => {
    expect(paths.relative('/a/b', '/a/c/d')).toBe('../c/d');
    expect(paths.isInside('/a/b', '/a/b/c')).toBe(true);
    expect(paths.isInside('/a/b', '/a/bc')).toBe(false);
  });
});
