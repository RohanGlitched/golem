import { describe, expect, it } from 'vitest';
import { loadGuard, runGuard } from './support/guard.js';

// Wall-clock test: it runs in the serial `test:latency` pass (see package.json), not beside 290 other files.
const guard = await loadGuard();

describe('Property 10: guard ignores everything except the payload (latency)', () => {
  // Feature: golem-kit, Property 10: Guard ignores everything except the payload
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