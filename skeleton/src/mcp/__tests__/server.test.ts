import { describe, expect, it } from 'vitest';
import { makeToolResult } from '../result.js';
import type { ToolDef } from '../schema.js';
import { TOOL_NAMES } from '../tool-schemas.js';
import { createMcpHarness } from '../../../test/support/mcp-harness.js';
import { GREEN_REQUIREMENTS } from '../../../test/support/harness.js';

const dummy: ToolDef[] = [
  {
    name: 'needs_pool', description: 'asks for the pool', inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_a, ctx) => { await ctx.getPool(); return makeToolResult('pool ready', {}); },
  },
  {
    name: 'no_pool', description: 'does not', inputSchema: { type: 'object', properties: { n: { type: 'integer', minimum: 1, maximum: 5, description: 'n' } }, additionalProperties: false },
    handler: async () => makeToolResult('fine', { ok: true }),
  },
];

describe('server factory', () => {
  it('does not create the pool until a tool asks for it, then reuses it', async () => {
    const m = await createMcpHarness({ tools: dummy });
    await m.call('no_pool');
    expect(m.server.poolCreated()).toBe(false);
    expect(m.spies.createPool).toBe(0);
    await m.call('needs_pool');
    await m.call('needs_pool');
    expect(m.spies.createPool).toBe(1);
    expect(m.server.poolCreated()).toBe(true);
    await m.close();
    expect(m.spies.poolClose).toBe(1);
  });

  it('answers a failed pool creation with an error result and retries at the next call', async () => {
    const m = await createMcpHarness({ tools: dummy });
    const real = m.deps.createPool;
    let fail = true;
    m.deps.createPool = async (o) => { if (fail) { fail = false; throw new Error('no workers available'); } return real(o); };
    const first = await m.call('needs_pool');
    expect(first.isError).toBe(true);
    expect(first.summary).toContain('no workers available');
    const second = await m.call('needs_pool');
    expect(second.isError).toBe(false);
    expect(m.server.poolCreated()).toBe(true);
  });

  it('starts without a config and answers every call with an error naming the cause', async () => {
    const m = await createMcpHarness({ tools: dummy, seed: false });
    const r = await m.call('no_pool');
    expect(r.isError).toBe(true);
    expect(r.summary).toContain('golem init');
    expect(m.spies.createPool).toBe(0);
  });

  it('answers with the config error for an invalid config', async () => {
    const m = await createMcpHarness({ tools: dummy, seed: false, mcpApp: { located: { error: '/p/golem.config.json: field "app" is missing' } } });
    expect((await m.call('no_pool')).summary).toContain('field "app" is missing');
  });

  it('rejects an invalid argument naming the field and never calls the handler', async () => {
    const m = await createMcpHarness({ tools: dummy });
    const r = await m.call('no_pool', { n: 9 });
    expect(r).toMatchObject({ isError: true, json: { field: 'n' } });
    expect((await m.call('no_pool', { extra: 1 })).json.field).toBe('extra');
    expect((await m.call('nope')).summary).toContain('unknown tool');
  });

  it('lists name, description and input schema of each tool', async () => {
    const m = await createMcpHarness({ tools: dummy });
    const { tools } = await m.client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['needs_pool', 'no_pool']);
    expect(tools[1]?.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it('logs only through the log callback', async () => {
    const m = await createMcpHarness({ tools: [{ ...(dummy[0] as ToolDef), handler: async () => { throw new Error('kaboom'); } }] });
    const r = await m.call('needs_pool');
    expect(r.isError).toBe(true);
    expect(m.logs.join('\n')).toContain('kaboom');
    expect(m.io.stderrText()).toBe('');
  });
});

describe('the default registry of eight tools', () => {
  it('lists exactly the eight tools, each with a name, a description and a JSON input schema', async () => {
    const m = await createMcpHarness({ requirements: GREEN_REQUIREMENTS });
    const { tools } = await m.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of tools) {
      expect(t.description?.length).toBeGreaterThan(20);
      expect(t.inputSchema.type).toBe('object');
    }
  });

  it('answers each tool once with valid arguments: no error flag, a one-line first block and a JSON second block', async () => {
    const m = await createMcpHarness({ predicates: true });
    await m.call('falsify', { reqId: '1.2', budget: 24 });
    const calls: [string, Record<string, unknown>][] = [
      ['list_requirements', {}], ['check_requirement', { text: 'WHEN the base is pushed with up to 100 N THE robot SHALL keep its height above 0.4 m for 1 s' }],
      ['run_requirement', { reqId: '1.1', budget: 6 }], ['falsify', { reqId: '1.2', budget: 6 }], ['get_counterexample', { reqId: '1.2' }],
      ['replay', { reqId: '1.2' }], ['explain_margin', { reqId: '1.2' }],
      ['propose_requirement', { text: 'WHEN the base is pushed with up to 90 N THE robot SHALL keep its tilt below 0.3 rad for 1 s', rationale: 'a crowd member leans on it' }],
    ];
    for (const [name, args] of calls) {
      const r = await m.call(name, args);
      expect(r.isError, `${name}: ${r.summary}`).toBe(false);
      expect(r.raw.content).toHaveLength(2);
      expect(r.summary).not.toMatch(/[\r\n]/);
      expect(r.summary.length).toBeLessThanOrEqual(200);
      expect(typeof r.json).toBe('object');
    }
  });

  it('runs no trial and writes nothing for a schema mismatch', async () => {
    const m = await createMcpHarness();
    const before = JSON.stringify([...m.fs.files.keys()]);
    for (const [name, args] of [['run_requirement', { reqId: '1.2', budget: 0 }], ['falsify', { reqId: '1.2', budget: 1025 }], ['replay', { reqId: '1.2', seed: -1 }]] as const) {
      const r = await m.call(name, args);
      expect(r.isError).toBe(true);
    }
    expect(m.spies.createPool).toBe(0);
    expect(JSON.stringify([...m.fs.files.keys()])).toBe(before);
  });

  it('leaves the seed database and report unchanged after a failed call', async () => {
    const m = await createMcpHarness({ falsifyImpl: async () => { throw new Error('pool exploded'); } });
    const before = JSON.stringify([...m.fs.files.keys()]);
    const r = await m.call('falsify', { reqId: '1.2' });
    expect(r.isError).toBe(true);
    expect(r.summary).toContain('pool exploded');
    expect(JSON.stringify([...m.fs.files.keys()])).toBe(before);
  });
});
