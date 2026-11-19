import { describe, expect, it } from 'vitest';
import { loadGuard } from './support/guard.js';

const guard = await loadGuard();
const pay = (o: unknown) => JSON.stringify(o);

describe('guard decide', () => {
  it.each([
    ['path', { tool_input: { path: 'a/requirements.md' } }],
    ['file_path', { tool_input: { file_path: '.kiro/specs/x/requirements.md' } }],
    ['paths array', { tool_input: { paths: ['a.ts', 'b/requirements.md'] } }],
    ['top-level path', { path: 'requirements.md' }],
    ['upper case', { tool_input: { path: 'Requirements.md' } }],
    ['dot segments and backslashes', { tool_input: { path: 'a\\..\\requirements.md' } }],
    ['trailing slash', { tool_input: { path: 'x/requirements.md/' } }],
  ])('exits 2 with the exact message for %s', (_n, p) => {
    expect(guard.decide(pay(p))).toEqual({ code: 2, stderr: 'golem-tuner may not edit requirements. Propose changes with propose_requirement.' });
  });

  it.each([
    ['my-requirements.md', 'a/my-requirements.md'],
    ['requirements.md.bak', 'a/requirements.md.bak'],
    ['a directory named requirements.md resolved away', 'x/requirements.md/..'],
    ['controller file', 'controller/gait.ts'],
  ])('exits 0 for %s', (_n, path) => {
    expect(guard.decide(pay({ tool_input: { path } })).code).toBe(0);
  });

  it('exits 0 with a warning that names the cause for invalid JSON and for no path', () => {
    const bad = guard.decide('not json');
    expect(bad.code).toBe(0);
    expect(bad.stderr).toContain('not valid JSON');
    const none = guard.decide(pay({ tool_input: { command: 'ls' } }));
    expect(none.code).toBe(0);
    expect(none.stderr).toContain('no path');
    expect(guard.decide(pay({ tool_input: { path: '' } })).stderr).toContain('no path');
  });

  it('normalises paths as documented', () => {
    expect(guard.normalise('A\\B\\..\\.\\Requirements.MD')).toBe('a/requirements.md');
    expect(guard.isRequirementsPath('my-requirements.md')).toBe(false);
  });
});
