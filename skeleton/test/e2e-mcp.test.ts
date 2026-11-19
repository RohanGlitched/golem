// End to end over the MCP in-memory transport on the Tiny_Test_App.
import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../src/mcp/tool-schemas.js';
import { RED_REQUIREMENTS, createHarness } from './support/harness.js';
import { createMcpHarness } from './support/mcp-harness.js';

describe('MCP end to end', () => {
  it('answers all eight tools with two-block results, and leaves the requirements file untouched', async () => {
    const m = await createMcpHarness({ predicates: true });
    const reqPath = m.path('.kiro/specs/tiny/requirements.md');
    const before = m.fs.text(reqPath);
    const results = [
      await m.call('list_requirements'),
      await m.call('check_requirement', { text: 'WHEN the base is pushed with up to 120 N THE robot SHALL keep its tilt below 0.5 rad for 1 s' }),
      await m.call('falsify', { reqId: '1.2', budget: 24 }),
      await m.call('get_counterexample', { reqId: '1.2' }),
      await m.call('replay', { reqId: '1.2' }),
      await m.call('explain_margin', { reqId: '1.2' }),
      await m.call('propose_requirement', { text: 'WHEN the base is pushed with up to 180 N THE robot SHALL keep its tilt below 0.9 rad for 1 s', rationale: 'a person can lean on it' }),
      await m.call('run_requirement', { reqId: '1.1', budget: 12 }),
    ];
    for (const r of results) {
      expect(r.isError, r.summary).toBe(false);
      expect(r.raw.content).toHaveLength(2);
      expect(r.summary).not.toMatch(/[\r\n]/);
      expect(() => JSON.parse(r.raw.content[1].text)).not.toThrow();
    }
    expect(results[2]?.json.status).toBe('broken');
    expect(results[5]?.json.lowest.signal).toBe('height');
    expect(m.fs.text(reqPath)).toBe(before);
    expect([...TOOL_NAMES]).toHaveLength(8);
  });

  it('finds the same pinned counterexample as the CLI for the same seed and budget', async () => {
    const cli = createHarness({ requirements: RED_REQUIREMENTS });
    expect(await cli.run('falsify', '1.2', '--budget', '24', '--search-seed', '1')).toBe(2);
    const fromCli = (JSON.parse(cli.fs.text(cli.path('.golem/seeds/tiny/1.2.json')) as string) as Record<string, unknown>[])[0];

    const mcp = await createMcpHarness({ requirements: RED_REQUIREMENTS });
    const r = await mcp.call('falsify', { reqId: '1.2', budget: 24 });
    expect(r.json.status).toBe('broken');
    const fromMcp = (JSON.parse(mcp.fs.text(mcp.path('.golem/seeds/tiny/1.2.json')) as string) as Record<string, unknown>[])[0];
    expect(fromMcp?.['scenario']).toEqual(fromCli?.['scenario']);
    expect(fromMcp?.['seed']).toBe(fromCli?.['seed']);
    expect(fromMcp?.['robustness']).toBe(fromCli?.['robustness']);
  });
});
