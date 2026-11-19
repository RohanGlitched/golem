import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { loadGuard, runGuard } from './support/guard.js';
import { propConfig } from './support/prop.js';

const guard = await loadGuard();

describe('Property 10: guard ignores everything except the payload', () => {
  // Feature: golem-kit, Property 10: Guard ignores everything except the payload
  // This property used to expect exit 0 for invalid JSON and for non-object JSON (fail open). Both are unreadable calls and now exit 2.
  it('exits 2 with a reason for stdin that is not a JSON object', () => {
    fc.assert(fc.property(fc.oneof(
      fc.string().filter((s) => { try { JSON.parse(s); return false; } catch { return true; } }),
      fc.constantFrom('', '[]', 'null', '7', 'true', '"x"'),
    ), (stdin) => {
      const r = guard.decide(stdin);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('cannot read the tool call');
    }), propConfig);
  });

  it('exits 0 with a warning for an object that names no path and does not mention requirements.md', () => {
    fc.assert(fc.property(fc.oneof(
      fc.jsonValue().map((v) => JSON.stringify({ tool_input: { command: v, note: 'no path here' } })),
      fc.constantFrom('{}', '{"tool_input":{"path":""}}', '{"tool_input":{"paths":[]}}'),
    ).filter((s) => !guard.mentionsRequirements(JSON.parse(s))), (stdin) => {
      const r = guard.decide(stdin);
      expect(r.code).toBe(0);
      expect(r.stderr).toMatch(/no path/);
    }), propConfig);
  });
  it('gives the same result whatever the environment variables are (decide reads none)', () => {
    fc.assert(fc.property(fc.dictionary(fc.stringMatching(/^[A-Z_]{1,8}$/), fc.string({ maxLength: 8 }), { maxKeys: 4 }), fc.constantFrom('a/requirements.md', 'a/x.ts'), (env, path) => {
      const saved = { ...process.env };
      try {
        const before = guard.decide(JSON.stringify({ tool_input: { path } }));
        Object.assign(process.env, env);
        expect(guard.decide(JSON.stringify({ tool_input: { path } }))).toEqual(before);
      } finally {
        for (const k of Object.keys(env)) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
      }
    }), propConfig);
  });
});
