import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { loadGuard, runGuard } from './support/guard.js';
import { propConfig } from './support/prop.js';

const guard = await loadGuard();

describe('Property 10: guard ignores everything except the payload', () => {
  // Feature: golem-kit, Property 10: Guard ignores everything except the payload
  it('exits 0 with a warning that names the cause for invalid or pathless stdin', () => {
    fc.assert(fc.property(fc.oneof(
      fc.string().filter((s) => { try { JSON.parse(s); return false; } catch { return true; } }),
      fc.jsonValue().map((v) => JSON.stringify({ tool_input: { command: v, note: 'no path here' } })),
      fc.constantFrom('', '{}', '[]', 'null', '{"tool_input":{"path":""}}', '{"tool_input":{"paths":[]}}'),
    ), (stdin) => {
      const r = guard.decide(stdin);
      expect(r.code).toBe(0);
      expect(r.stderr).toMatch(/not valid JSON|no path/);
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

  it('as a real child process gives the exit code of decide under two environments, within 500 ms', async () => {
    const payloads = [
      '{"tool_input":{"path":"a/requirements.md"}}', '{"tool_input":{"file_path":"x/Requirements.md"}}', '{"tool_input":{"paths":["a","b\\\\requirements.md"]}}',
      '{"tool_input":{"path":"a\\\\..\\\\requirements.md"}}', '{"tool_input":{"path":"my-requirements.md"}}', 'not json', '{"tool_input":{}}',
    ];
    const envs: Record<string, string>[] = [{ PATH: process.env['PATH'] ?? '' }, { PATH: process.env['PATH'] ?? '', GOLEM_AGENT: 'golem-tuner', HOME: '/nowhere' }];
    for (const p of payloads) {
      for (const env of envs) {
        // The latency of one invocation is the best of three runs, so that a busy machine does not hide the script's own speed.
        const runs = [await runGuard(p, env), await runGuard(p, env), await runGuard(p, env)];
        const r = runs[0] as (typeof runs)[number];
        expect(runs.every((x) => x.code === guard.decide(p).code)).toBe(true);
        expect(Math.min(...runs.map((x) => x.ms))).toBeLessThan(500);
        if (r.code === 2) expect(r.stderr.trim()).toBe(guard.BLOCK_MESSAGE);
      }
    }
  }, 30000);
});
