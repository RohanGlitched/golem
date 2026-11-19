import { describe, expect, it } from 'vitest';
import { loadGuard, runGuard } from './support/guard.js';

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

  // The earlier version of this test expected exit 0 for invalid JSON (fail open). That let a call the guard could not read
  // edit requirements.md, so the expectation is now exit 2; the no-path case that clearly touches no requirements file stays exit 0.
  it.each([
    ['invalid JSON', 'not json'],
    ['an empty payload', ''],
    ['a truncated payload', '{"tool_input":{"path":"a/requirem'],
    ['JSON null', 'null'],
    ['a JSON array', '[{"path":"requirements.md"}]'],
    ['a JSON string', '"requirements.md"'],
    ['a JSON number', '7'],
  ])('fails closed with exit 2 and a reason for %s', (_n, stdin) => {
    const r = guard.decide(stdin);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('cannot read the tool call');
  });

  it('exits 0 with a warning for a call that names no path and does not mention requirements.md', () => {
    const none = guard.decide(pay({ tool_input: { command: 'ls' } }));
    expect(none.code).toBe(0);
    expect(none.stderr).toContain('no path');
    expect(guard.decide(pay({ tool_input: { path: '' } })).stderr).toContain('no path');
    expect(guard.decide(pay({ tool_input: { command: 'cat my-requirements.md requirements.md.bak' } })).code).toBe(0);
  });

  it('blocks a call with no recognised path field that names requirements.md anywhere', () => {
    for (const p of [
      { tool_input: { command: 'echo x > .kiro/specs/a/requirements.md' } },
      { tool_input: { edits: [{ target: 'a\\Requirements.MD', text: 'x' }] } },
      { tool_input: { 'requirements.md': 'x' } },
    ]) {
      const r = guard.decide(pay(p));
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(guard.BLOCK_MESSAGE);
    }
  });

  it('still decides from the path fields when the content mentions requirements.md', () => {
    expect(guard.decide(pay({ tool_input: { path: 'README.md', content: 'see requirements.md' } })).code).toBe(0);
  });
  it('normalises paths as documented', () => {
    expect(guard.normalise('A\\B\\..\\.\\Requirements.MD')).toBe('a/requirements.md');
    expect(guard.isRequirementsPath('my-requirements.md')).toBe(false);
  });
});

describe('guard as a process', () => {
  const env = { PATH: process.env['PATH'] ?? '' };
  it('exits 2 on a payload that is not JSON, on empty stdin, and 0 on a call that touches no requirements file', async () => {
    expect((await runGuard('not json', env)).code).toBe(2);
    expect((await runGuard('', env)).code).toBe(2);
    expect((await runGuard(pay({ tool_input: { path: 'controller/gait.ts' } }), env)).code).toBe(0);
  });
});

describe('guard with a large payload', () => {
  it('decides within 500 ms on a payload of about 1 MiB (best of three runs)', async () => {
    const big = JSON.stringify({ tool_input: { path: 'a/requirements.md', content: 'x'.repeat(1024 * 1024 - 200) } });
    const runs = [await runGuard(big, { PATH: process.env['PATH'] ?? '' }), await runGuard(big, { PATH: process.env['PATH'] ?? '' }), await runGuard(big, { PATH: process.env['PATH'] ?? '' })];
    expect(runs.every((r) => r.code === 2)).toBe(true);
    expect(Math.min(...runs.map((r) => r.ms))).toBeLessThan(500);
  }, 30000);
});
