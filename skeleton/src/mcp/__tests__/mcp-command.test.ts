import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { parseArgs, type ParsedCommand } from '../../cli/args.js';
import { runStdioServer } from '../server.js';
import { GREEN_REQUIREMENTS, createHarness } from '../../../test/support/harness.js';

const parsed = (...a: string[]): ParsedCommand => parseArgs(['mcp', ...a]) as ParsedCommand;

async function connect(h: ReturnType<typeof createHarness>, p: ParsedCommand) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const done = runStdioServer(p, h.io, h.deps, { transport: serverSide });
  const client = new Client({ name: 't', version: '0' }, { capabilities: {} });
  await client.connect(clientSide);
  return { client, done };
}

describe('golem mcp', () => {
  it('exits 1 naming the field and value when toolTimeCapS is not a positive finite number', async () => {
    const h = createHarness({ seed: false });
    h.fs.put(h.path('golem.config.json'), '{"app":"./a.js","requirements":[],"toolTimeCapS":0}');
    expect(await h.run('mcp')).toBe(1);
    expect(h.io.stderrText()).toContain('toolTimeCapS');
    expect(h.io.stderrText()).toContain('0');
  });

  it('starts without a config and answers each call with an error, then exits 0 when the client side closes', async () => {
    const h = createHarness({ seed: false });
    const { client, done } = await connect(h, parsed());
    const r = (await client.callTool({ name: 'list_requirements', arguments: {} })) as { isError?: boolean; content: { text: string }[] };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('golem init');
    const t0 = performance.now();
    await client.close();
    expect(await done).toBe(0);
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('closes the pool and exits 0 when stdin closes', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    const { client, done } = await connect(h, parsed());
    await client.callTool({ name: 'run_requirement', arguments: { reqId: '1.1', budget: 4 } });
    expect(h.spies.createPool).toBe(1);
    await client.close();
    expect(await done).toBe(0);
    expect(h.spies.poolClose).toBe(1);
    expect(h.io.stdoutText()).toBe('');
  });

  it('answers with the config error for an invalid config and uses the configured cap otherwise', async () => {
    const h = createHarness({ seed: false });
    h.fs.put(h.path('golem.config.json'), '{"app":5,"requirements":[]}');
    const { client, done } = await connect(h, parsed());
    const r = (await client.callTool({ name: 'list_requirements', arguments: {} })) as { content: { text: string }[] };
    expect(r.content[0]?.text).toContain('field "app"');
    await client.close();
    await done;
  });
});
